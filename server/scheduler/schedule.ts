/**
 * Javora — sync schedule configuration.
 *
 * Separated from the worker so the API can report whether automatic
 * synchronisation is actually operational without importing the worker.
 *
 * WHAT "OPERATIONAL" MEANS HERE. A schedule is operational only when a
 * source has a positive interval configured AND a connector exists for it.
 * A configured interval for a source nobody can read is not automation; it
 * is a plan. `isAutomaticSyncOperational()` therefore checks both, and the
 * UI and API report its answer rather than asserting anything.
 *
 * Intervals are read from the environment so deployments can tune them
 * without a code change. The defaults are OFF (0) — enabling automatic
 * retrieval of a government website should be a deliberate act by whoever
 * runs the deployment, not a side effect of installing the software.
 */

/** Source ids that have a real, working connector. */
export const IMPLEMENTED_CONNECTORS = new Set(["S001", "S006"]);

export interface SourceSchedule {
  sourceId: string;
  label: string;
  /** Minutes between checks. 0 or negative disables the schedule. */
  intervalMinutes: number;
  /** Politeness floor between requests within a run. */
  minRequestIntervalMs: number;
  /** Whether a connector exists at all. */
  connectorImplemented: boolean;
}

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const minutes = numberFromEnv;

/**
 * Fetch timeout, retry and stale-run settings — shared across every source,
 * because the failure modes they guard against (a hung connection, a
 * transient drop, a crashed worker leaving a run unfinished) are properties
 * of fetching over HTTP and running as a long-lived process, not of any one
 * government site's publishing habits.
 */
export function loadSyncRuntimeConfig() {
  return {
    fetchTimeoutMs: numberFromEnv("SYNC_FETCH_TIMEOUT_MS", 30_000),
    fetchRetryAttempts: numberFromEnv("SYNC_RETRY_ATTEMPTS", 3),
    fetchRetryBackoffMs: numberFromEnv("SYNC_RETRY_BACKOFF_MS", 2_000),
    // A run older than this with no finished_at is presumed abandoned by a
    // worker that no longer exists, rather than genuinely still in flight.
    maxRunMinutes: numberFromEnv("SYNC_MAX_RUN_MINUTES", 30),
  };
}

/**
 * The schedule table.
 *
 * Cadences reflect how often each record genuinely moves, not a single
 * default reused everywhere:
 *
 *   PARLIAMENT — every 6 hours (360 min) when enabled. Membership changes on
 *   election results and occasional by-elections/resignations, essentially
 *   never between sessions. Six hours is not "how fast this needs to be
 *   caught" — a same-day correction would be plenty — it is a deliberately
 *   short leash anyway, so that the rare membership change is reflected the
 *   same day rather than sitting stale for a week.
 *
 *   CABINET — every 3 hours (180 min) when enabled, i.e. twice as often as
 *   Parliament. A reshuffle is rarer than a parliamentary session but far
 *   more consequential to get right quickly: it changes who the Current
 *   Government page shows as holding a ministry, which is the single most
 *   time-sensitive fact this site publishes. The shorter interval buys
 *   faster correction of exactly that, at negligible cost — the Cabinet
 *   Office page is one fetch, not a 225-profile crawl.
 *
 * Both are recommendations, not defaults: every interval below still
 * defaults to 0 (disabled). Turning one on is a deployment's decision.
 */
export function loadSchedules(): SourceSchedule[] {
  return [
    {
      sourceId: "S001",
      label: "Parliament of Sri Lanka — Members Directory",
      intervalMinutes: minutes("PARLIAMENT_SYNC_INTERVAL", 0), // recommended when enabled: 360 (6h)
      minRequestIntervalMs: minutes("PARLIAMENT_REQUEST_DELAY_MS", 500),
      connectorImplemented: IMPLEMENTED_CONNECTORS.has("S001"),
    },
    {
      sourceId: "S006",
      label: "Cabinet Office — Decisions and Portfolios",
      intervalMinutes: minutes("CABINET_SYNC_INTERVAL", 0), // recommended when enabled: 180 (3h)
      minRequestIntervalMs: minutes("CABINET_REQUEST_DELAY_MS", 1000),
      connectorImplemented: IMPLEMENTED_CONNECTORS.has("S006"),
    },
    {
      sourceId: "S002",
      label: "Election Commission — Official Results",
      intervalMinutes: minutes("ELECTION_SYNC_INTERVAL", 0),
      minRequestIntervalMs: minutes("ELECTION_REQUEST_DELAY_MS", 1000),
      connectorImplemented: IMPLEMENTED_CONNECTORS.has("S002"),
    },
    {
      sourceId: "S005",
      label: "Department of Government Printing — Gazette",
      intervalMinutes: minutes("GAZETTE_SYNC_INTERVAL", 0),
      minRequestIntervalMs: minutes("GAZETTE_REQUEST_DELAY_MS", 1000),
      connectorImplemented: IMPLEMENTED_CONNECTORS.has("S005"),
    },
  ];
}

/** Schedules that will actually run: enabled AND backed by a connector. */
export function activeSchedules(): SourceSchedule[] {
  return loadSchedules().filter((s) => s.intervalMinutes > 0 && s.connectorImplemented);
}

/**
 * Whether automatic synchronisation is genuinely operational.
 *
 * The UI must not claim "live" data unless this is true.
 */
export function isAutomaticSyncOperational(): boolean {
  return activeSchedules().length > 0;
}
