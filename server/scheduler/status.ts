/**
 * Javora — per-source synchronisation status.
 *
 * Derives "last successful run", "last failed run" and "currently running"
 * from `sync_run` rows that `syncSource()` already writes — no new storage,
 * just a read shaped for an operator (or the worker's own startup log) rather
 * than the raw row-per-attempt table.
 */

import type { CanonicalStore } from "../db/store.ts";
import type { SourceLock } from "./lock.ts";
import type { SourceSchedule } from "./schedule.ts";

export interface RunSummary {
  runId: string;
  trigger: string;
  outcome: string;
  startedAt: string;
  finishedAt: string | null;
  seenCount: number;
  createdCount: number;
  updatedCount: number;
  errorMessage: string | null;
}

export interface SourceSyncStatus {
  sourceId: string;
  label: string;
  enabled: boolean;
  connectorImplemented: boolean;
  intervalMinutes: number;
  /** True only while THIS process holds the in-process lock for it. */
  runningInThisProcess: boolean;
  lastRun: RunSummary | null;
  lastSuccessfulRun: RunSummary | null;
  lastFailedRun: RunSummary | null;
}

interface RunRow {
  id: string;
  trigger: string;
  outcome: string;
  started_at: string;
  finished_at: string | null;
  seen_count: number;
  created_count: number;
  updated_count: number;
  error_message: string | null;
}

function toSummary(row: RunRow): RunSummary {
  return {
    runId: row.id,
    trigger: row.trigger,
    outcome: row.outcome,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    seenCount: row.seen_count,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    errorMessage: row.error_message,
  };
}

/** Status for one source, scanning its recent run history. */
export function sourceSyncStatus(store: CanonicalStore, schedule: SourceSchedule, lock: SourceLock): SourceSyncStatus {
  // 50 is generous headroom: even a source syncing every 10 minutes takes
  // over 8 hours to produce that many runs, comfortably more than enough to
  // find the last success and the last failure among recent attempts.
  const runs = store.listRuns(schedule.sourceId, 50) as unknown as RunRow[];

  return {
    sourceId: schedule.sourceId,
    label: schedule.label,
    enabled: schedule.intervalMinutes > 0,
    connectorImplemented: schedule.connectorImplemented,
    intervalMinutes: schedule.intervalMinutes,
    runningInThisProcess: lock.isRunning(schedule.sourceId),
    lastRun: runs[0] ? toSummary(runs[0]) : null,
    lastSuccessfulRun: (() => {
      const row = runs.find((r) => r.outcome === "applied" || r.outcome === "unchanged");
      return row ? toSummary(row) : null;
    })(),
    lastFailedRun: (() => {
      const row = runs.find((r) => r.outcome === "failed");
      return row ? toSummary(row) : null;
    })(),
  };
}

/** One human-readable line per source, for the worker's own log. */
export function formatStatusLine(status: SourceSyncStatus): string {
  if (!status.connectorImplemented) return `${status.sourceId}  no connector implemented — ${status.label}`;
  if (!status.enabled) return `${status.sourceId}  disabled (interval 0) — ${status.label}`;

  const last = status.lastRun
    ? `last=${status.lastRun.outcome}@${status.lastRun.startedAt}`
    : "never run";
  const success = status.lastSuccessfulRun ? `lastOk=${status.lastSuccessfulRun.startedAt}` : "lastOk=never";
  const failed = status.lastFailedRun
    ? `lastFailed=${status.lastFailedRun.startedAt} (${status.lastFailedRun.errorMessage ?? "no message"})`
    : "lastFailed=never";
  const running = status.runningInThisProcess ? " RUNNING NOW" : "";

  return `${status.sourceId}  every ${status.intervalMinutes}min — ${last}  ${success}  ${failed}${running}`;
}
