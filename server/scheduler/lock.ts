/**
 * Javora — overlapping-run protection.
 *
 * DEPLOYMENT ARCHITECTURE THIS IS BUILT FOR. The sync worker is documented
 * (see worker.ts's header) as ONE long-running Node process — not a fleet of
 * worker replicas behind a queue. That is the actual shipped architecture, so
 * the lock appropriate to it is an IN-PROCESS one: a `Set` guarding each
 * source, checked before a scheduled tick starts and released when it ends.
 * That is enough to guarantee two `syncSource()` calls for the same source
 * are never in flight at once within this process, which is the only way
 * they otherwise could be — `setInterval` fires on a fixed clock with no
 * awareness of whether the previous tick has finished, and a Cabinet Office
 * fetch under retry can legitimately take longer than a short interval.
 *
 * WHAT THIS DOES NOT COVER. If a deployment ever runs more than one worker
 * process against the same database — which nothing here does, and nothing
 * here should be read as endorsing — this in-process lock cannot see across
 * processes. `staleRunGuard()` below adds a second, DB-visible check for
 * exactly that gap: it will not let a NEW run start while the database still
 * shows a run for that source with no `finished_at`, whether that unfinished
 * run belongs to this process or a different one. That is a best-effort
 * safety net, not a real distributed lock (no expiry-with-heartbeat, no
 * fencing token) — a genuine multi-worker deployment needs a proper
 * distributed lock (e.g. a PostgreSQL advisory lock), which is out of scope
 * for an architecture that runs exactly one worker.
 */

import type { CanonicalStore } from "../db/store.ts";

export class SourceLock {
  private readonly running = new Set<string>();

  /** Returns true and marks the source busy, or false if it already is. */
  tryAcquire(sourceId: string): boolean {
    if (this.running.has(sourceId)) return false;
    this.running.add(sourceId);
    return true;
  }

  release(sourceId: string): void {
    this.running.delete(sourceId);
  }

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId);
  }
}

export interface StaleRunCheck {
  /** A run for this source is already in flight (started, not finished) and young enough to trust. */
  blocked: boolean;
  /** An unfinished run exists but is older than the abandonment threshold — a crashed process, most likely. */
  staleRunId: string | null;
}

/**
 * Whether the database shows a run for `sourceId` still in progress.
 *
 * A run older than `maxRunMinutes` with no `finished_at` is treated as
 * abandoned rather than a permanent lock: a worker that was killed mid-run
 * (a deploy, an OOM) must not leave that source unsyncable forever. The
 * abandoned run is left exactly as it is in `sync_run` — evidence of what
 * happened — while a new run is allowed to proceed.
 */
export function staleRunGuard(store: CanonicalStore, sourceId: string, maxRunMinutes: number): StaleRunCheck {
  const runs = store.listRuns(sourceId, 1) as Array<{ id: string; started_at: string; finished_at: string | null }>;
  const latest = runs[0];
  if (!latest || latest.finished_at !== null) return { blocked: false, staleRunId: null };

  const ageMinutes = (Date.now() - new Date(latest.started_at).getTime()) / 60_000;
  if (ageMinutes < maxRunMinutes) return { blocked: true, staleRunId: null };

  return { blocked: false, staleRunId: latest.id };
}
