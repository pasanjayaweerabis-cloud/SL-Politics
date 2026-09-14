#!/usr/bin/env node
/**
 * Javora — sync worker.
 *
 *   node server/scheduler/worker.ts            run on the configured schedule
 *   node server/scheduler/worker.ts --once     run every enabled source once
 *   node server/scheduler/worker.ts --status   print status and exit, no sync
 *
 * A long-running server process, deliberately NOT part of the React app.
 * A browser tab is the wrong place to synchronise official records: it cannot
 * hold credentials, runs only while someone has the page open, would issue
 * one set of requests per visitor (turning ordinary traffic into an
 * accidental denial-of-service against a government website), and leaves no
 * single audit trail of who fetched what and when.
 *
 * "Automatically checked", not "real-time". This polls on an interval. The
 * sources publish no change feed, so nothing here can be — or is described
 * as — real-time.
 *
 * ONE PROCESS. This worker is designed to run as a single long-lived
 * instance, and `server/scheduler/lock.ts` explains exactly what that does
 * and does not protect against if that assumption is ever broken.
 */

import { openMigrated } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { syncSource } from "../sync/syncSource.ts";
import { createParliamentConnector } from "../fetchers/parliamentConnector.ts";
import { createCabinetConnector } from "../fetchers/cabinetConnector.ts";
import { createCabinetResolver } from "../sync/resolveCabinetIdentity.ts";
import { activeSchedules, loadSchedules, loadSyncRuntimeConfig, type SourceSchedule } from "./schedule.ts";
import { SourceLock, staleRunGuard } from "./lock.ts";
import { sourceSyncStatus, formatStatusLine } from "./status.ts";

type ConnectorFactory = (schedule: SourceSchedule, store: CanonicalStore) => ReturnType<typeof createParliamentConnector>;

/** Only sources with a real connector appear here. */
const CONNECTORS: Record<string, ConnectorFactory> = {
  S001: (schedule) =>
    createParliamentConnector({
      delayMs: schedule.minRequestIntervalMs,
      withProfiles: process.env.PARLIAMENT_SYNC_PROFILES === "true",
    }),

  // The Cabinet Office publishes no person identifiers, so the connector is
  // handed a resolver backed by the canonical store. Without it, every
  // minister who is already in the database as an MP would be created a
  // second time under a Cabinet-derived id.
  S006: (_schedule, store) =>
    createCabinetConnector({ resolvePerson: createCabinetResolver(store) }),
};

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

const lock = new SourceLock();

async function runOne(store: CanonicalStore, schedule: SourceSchedule, trigger: "scheduled" | "manual") {
  const factory = CONNECTORS[schedule.sourceId];
  if (!factory) {
    log(`skip ${schedule.sourceId}: no connector implemented`);
    return;
  }

  // ---- OVERLAP PROTECTION -------------------------------------------------
  // In-process first: cheap, exact, and enough on its own for the single-
  // worker architecture this ships. See lock.ts for why a distributed lock
  // is deliberately not built for an architecture that does not need one.
  if (!lock.tryAcquire(schedule.sourceId)) {
    log(`skip ${schedule.sourceId}: previous run still in progress in this process`);
    return;
  }

  try {
    // Second, DB-visible check: catches a run left unfinished by a worker
    // process that no longer exists (a crash, a redeploy mid-run).
    const config = loadSyncRuntimeConfig();
    const stale = staleRunGuard(store, schedule.sourceId, config.maxRunMinutes);
    if (stale.blocked) {
      log(`skip ${schedule.sourceId}: an unfinished run is already recorded and still within the ${config.maxRunMinutes}min window`);
      return;
    }
    if (stale.staleRunId) {
      log(`${schedule.sourceId}: reclaiming abandoned run ${stale.staleRunId} (unfinished past ${config.maxRunMinutes}min — treating as a crashed worker)`);
      store.finishRun(stale.staleRunId, {
        outcome: "failed",
        finishedAt: new Date().toISOString(),
        errorMessage: `abandoned: no finished_at recorded within ${config.maxRunMinutes} minutes`,
      });
    }

    log(`sync ${schedule.sourceId} (${schedule.label}) starting`);
    try {
      const result = await syncSource(store, factory(schedule, store), {
        trigger,
        retry: {
          timeoutMs: config.fetchTimeoutMs,
          attempts: config.fetchRetryAttempts,
          backoffMs: config.fetchRetryBackoffMs,
        },
        onFetchAttempt: (attempt, error) => {
          if (error) {
            log(`sync ${schedule.sourceId} fetch attempt ${attempt}/${config.fetchRetryAttempts} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      });
      log(
        `sync ${schedule.sourceId} ${result.outcome}` +
          ` changed=${result.changed}` +
          ` seen=${result.counts.seen} created=${result.counts.created} updated=${result.counts.updated}` +
          ` opened=${result.positionsOpened} closed=${result.positionsClosed}` +
          ` events=${result.changeEventIds.length}` +
          (result.skipped > 0 ? ` skipped=${result.skipped}` : "") +
          (result.error ? ` error=${result.error}` : ""),
      );
      if (result.skipped > 0) {
        for (const problem of result.problems) {
          log(`sync ${schedule.sourceId} REJECTED [${problem.code}] ${problem.subject ?? "?"}: ${problem.message}`);
        }
      }
    } catch (error) {
      // A crash in one source must not stop the worker or touch canonical data.
      log(`sync ${schedule.sourceId} FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    lock.release(schedule.sourceId);
  }
}

function printStatus(store: CanonicalStore) {
  const all = loadSchedules();
  log("SL Politics sync status");
  for (const schedule of all) {
    log(`  ${formatStatusLine(sourceSyncStatus(store, schedule, lock))}`);
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const statusOnly = process.argv.includes("--status");
  const db = openMigrated();
  const store = new CanonicalStore(db);

  const all = loadSchedules();
  const active = activeSchedules();

  if (statusOnly) {
    printStatus(store);
    db.close();
    return;
  }

  log("SL Politics sync worker starting");
  for (const schedule of all) {
    const state = !schedule.connectorImplemented
      ? "no connector implemented"
      : schedule.intervalMinutes > 0
        ? `every ${schedule.intervalMinutes} min`
        : "disabled (interval 0)";
    log(`  ${schedule.sourceId}  ${state}  — ${schedule.label}`);
  }

  if (!active.length) {
    log("No source is both enabled and implemented; automatic synchronisation is NOT operational.");
    log("Set e.g. PARLIAMENT_SYNC_INTERVAL=360 to enable a schedule.");
    if (once) {
      db.close();
      return;
    }
  }

  if (once) {
    for (const schedule of active) await runOne(store, schedule, "manual");
    printStatus(store);
    db.close();
    return;
  }

  const timers: NodeJS.Timeout[] = [];
  for (const schedule of active) {
    // Run once at startup so a fresh deployment does not wait a full cycle.
    void runOne(store, schedule, "scheduled");
    timers.push(setInterval(() => void runOne(store, schedule, "scheduled"), schedule.intervalMinutes * 60_000));
  }

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${signal})`);
    timers.forEach(clearInterval);
    // A run already in flight is left to finish inside syncSource's own
    // transaction rather than interrupted mid-write; this only stops new
    // ones from being scheduled.
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (!active.length) {
    // Nothing scheduled: exit rather than idling and looking operational.
    db.close();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Worker failed:", error);
  process.exit(1);
});
