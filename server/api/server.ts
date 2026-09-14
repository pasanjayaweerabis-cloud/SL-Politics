/**
 * Javora — HTTP API.
 *
 *   GET /health, /api/health              liveness + database reachability
 *   GET /api/people?q=&party=&district=&role=&status=&limit=&offset=
 *   GET /api/search?q=&limit=             typeahead suggestions
 *   GET /api/people/:idOrSlug
 *   GET /api/people/:idOrSlug/positions
 *   GET /api/people/:idOrSlug/timeline
 *   GET /api/people/:idOrSlug/evidence
 *   GET /api/facets
 *   GET /api/sources
 *   GET /api/status                       what the database holds + sync state
 *  POST /api/corrections                  file a correction report
 *
 * Built on `node:http` with no framework: the routing surface is ten
 * read endpoints and one write, and a dependency would be more code to audit
 * than the routing it replaces.
 *
 * Every endpoint that reads is READ-ONLY, and nothing here writes canonical
 * data — that is the sync worker's job alone, so a web request can never
 * mutate a public record. `POST /api/corrections` is the single exception to
 * "GET only", and only in the narrowest sense: it appends one row to
 * `correction_report` with `review_status='open'` and can reach no other
 * table, because the handle it holds (`CorrectionIntake`, opened on its own
 * connection) exposes exactly that one insert and nothing else. Turning an
 * approved report into an actual record change stays a separate, human
 * triggered action through `CanonicalStore`. See
 * docs/corrections-security-design.md and server/api/corrections.ts.
 *
 * PRODUCTION HARDENING (this file). Five endpoints — health, people, a single
 * person, search, facets — are the public surface a launch depends on, and
 * are hardened as follows:
 *
 *   - PostgreSQL with connection pooling, when `DATABASE_URL` is set (see
 *     "Which database" below) — falls back to the bundled SQLite store
 *     otherwise, so a deployment with no Postgres configured still runs.
 *   - Every query parameter is validated (server/api/validation.ts) and
 *     rejected with 400 rather than silently coerced — an invalid `limit`
 *     must not reach SQL as `NaN`.
 *   - No error response ever includes a stack trace, a SQL fragment, or a
 *     connection string; `logError` writes those to the server's own log only.
 *   - Per-request and per-query timeouts, so one slow or stuck query cannot
 *     hold a connection (or a client) open indefinitely.
 *   - A process-local rate limiter. Documented as process-local because it
 *     is one: behind a load balancer with N instances, each instance enforces
 *     the limit independently, which is a real limitation of not using a
 *     shared store (Redis, etc.) and worth knowing before relying on it.
 *   - Graceful shutdown on SIGTERM/SIGINT: stop accepting connections, let
 *     in-flight requests finish, close the database pool, then exit.
 *   - Structured (one-JSON-object-per-line) request logging.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { openMigrated, openDatabase, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { withTimeout } from "../lib/withTimeout.ts";
import { listPeople, suggestPeople, getPerson, getFacets, parseListOptions, type Queryable } from "./queries.ts";
import { parseIdOrSlug, parseSearchTerm, parsePagination, decodePathSegment, ValidationError } from "./validation.ts";
import { getCurrentGovernment } from "./currentGovernment.ts";
import { isAutomaticSyncOperational } from "../scheduler/schedule.ts";
import { openPostgres, type AsyncDatabase } from "../db/postgres.ts";
import { TtlCache } from "./cache.ts";
import { parseTrustedProxies, resolveClientIp } from "./trustedProxies.ts";
import {
  readJsonBody, fileCorrection, openCorrectionIntake, PayloadTooLarge,
  type CorrectionIntake,
} from "./corrections.ts";

const DEFAULT_PORT = Number(process.env.JAVORA_API_PORT ?? 4000);

/** Origins allowed to call the API from a browser. */
const allowedOrigins = (process.env.JAVORA_CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ==========================================================================
   Structured logging
   ========================================================================== */

/**
 * One JSON object per line, to stdout/stderr. No framework: this is ten
 * fields, and a logging library would be more surface to audit for exactly
 * the thing it must never do here — print a secret or a connection string.
 */
function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

/**
 * Server-side detail for a failure. NEVER sent to the client — `sendJson`'s
 * caller always sends a fixed, safe message alongside this.
 */
function logError(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const detail = error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) };
  log("error", event, { ...fields, ...detail });
}

/* ==========================================================================
   Response helpers
   ========================================================================== */

/**
 * `cacheMaxAgeSeconds`, when given, adds a `Cache-Control` header so a CDN or
 * browser can skip re-requesting within that window — on top of, not instead
 * of, the server-side TtlCache in cache.ts. The two numbers are meant to
 * agree: a client-side max-age longer than the server's own TTL would let a
 * browser hold a response the server itself has already discarded as stale.
 * Omitted entirely for endpoints with no cache (the default, unchanged
 * behaviour), rather than defaulting to some blanket value every route would
 * have to remember to override.
 */
/**
 * L-3. `HEAD` requests are routed through exactly the same handling as the
 * matching `GET` would get (§4.1 lists it among the expected public
 * methods; monitors, CDNs and link checkers use it), populated here once
 * per response rather than threaded as a parameter through every one of
 * `sendJson`'s call sites — a `WeakSet` keyed on the response object itself
 * is what lets `sendJson` know to withhold the body without every caller
 * needing to say so.
 */
const HEAD_RESPONSES = new WeakSet<ServerResponse>();

function sendJson(res: ServerResponse, status: number, body: unknown, origin?: string, cacheMaxAgeSeconds?: number): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    // Content-Length reflects what a GET would have sent, per RFC 7231
    // §4.3.2, even when the body itself is withheld below for HEAD.
    "content-length": String(Buffer.byteLength(payload)),
    // The API serves public records; it is not an origin for active content.
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (cacheMaxAgeSeconds !== undefined) {
    headers["cache-control"] = `public, max-age=${cacheMaxAgeSeconds}`;
  }
  // Echo the origin only when it is on the allow-list; never reflect blindly.
  if (origin && allowedOrigins.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(HEAD_RESPONSES.has(res) ? undefined : payload);
}

/**
 * A client-facing error. The `code` is a stable machine-readable string; the
 * optional `message` is safe, specific text (a `ValidationError`'s message,
 * for instance) — never an exception's own `.message`, which can embed SQL or
 * a file path depending on where in the stack it was thrown.
 */
function sendError(res: ServerResponse, status: number, code: string, message: string | undefined, origin?: string): void {
  sendJson(res, status, message ? { error: code, message } : { error: code }, origin);
}

/** The one path that accepts a write. */
const CORRECTIONS_PATH = "/api/corrections";

/**
 * A request's path, normalised the same way the read router normalises it
 * (trailing slashes stripped, query discarded) so `/api/corrections/` and
 * `/api/corrections?x=1` cannot reach a different decision than
 * `/api/corrections` does. Returns null for a URL that will not parse; the
 * caller then falls through to the ordinary malformed-URL handling.
 */
function pathOf(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

const list = (params: URLSearchParams, key: string): string[] =>
  params.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

/* ==========================================================================
   Public response shapes for /api/status and /api/sources (M-1)
   ========================================================================== */

/**
 * `store.listRuns()` is `SELECT * FROM sync_run`, and `sync_run.error_message`
 * holds raw connector exception text — whatever `fetch`, the DNS resolver, the
 * TLS stack or the parser produced, which can include internal hostnames,
 * upstream URLs and file paths. This maps to an explicit public shape instead
 * of forwarding the row, so `error_message` (and any column a future
 * migration adds) is never published by default.
 */
function toPublicSyncRun(row: Record<string, unknown>) {
  return {
    sourceId: row.source_id as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    outcome: row.outcome as string,
    seenCount: Number(row.seen_count ?? 0),
    createdCount: Number(row.created_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    unchangedCount: Number(row.unchanged_count ?? 0),
  };
}

/**
 * `store.listSources()` is `SELECT * FROM source` — whole rows, including
 * whatever internal/operational columns a future migration adds. This mirrors
 * the same intentionally-public field set the bundled frontend already shows
 * for a source (`InstitutionalSource` in src/types/models.ts), rather than
 * whatever happens to be in the table.
 */
function toPublicSource(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    institution: row.institution as string,
    sourceType: row.source_type as string,
    category: row.category as string,
    url: row.url as string,
    description: row.description as string,
    syncState: row.sync_state as string,
    lastCheckedAt: (row.last_checked_at as string | null) ?? null,
    lastSuccessfulSyncAt: (row.last_successful_sync_at as string | null) ?? null,
  };
}

/* ==========================================================================
   Timeouts
   ========================================================================== */

const QUERY_TIMEOUT_MS = Number(process.env.API_QUERY_TIMEOUT_MS ?? 8_000);

/**
 * Race a query against a timeout so a stuck connection (a network partition
 * to Postgres, a pool exhausted under load) fails the ONE request waiting on
 * it after a bound, rather than hanging it — and everything downstream of
 * it — indefinitely.
 */
/* ==========================================================================
   Rate limiting
   ========================================================================== */

/**
 * A fixed-window counter per client IP, held in process memory.
 *
 * NOT a substitute for a shared limiter (Redis, a gateway) once the API runs
 * as more than one instance — each process enforces this independently, so
 * the effective limit across N instances is N times what is configured here.
 * For a single-instance deployment, which is what this project ships, it is
 * the difference between "one script can loop a few hundred requests a
 * second at this API" and not.
 */
const RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX ?? 120);

/**
 * L-2. `OPTIONS` preflights and the non-GET/HEAD methods answered with 405
 * used to bypass rate limiting entirely — deliberately, per the comment this
 * replaced, since gating them behind the GET/HEAD budget would let a client
 * exhaust another client's real quota with junk methods. But "no limit at
 * all" has its own cost: each one still parses a URL, allocates a response
 * and writes a log line, and an unauthenticated client could issue an
 * unbounded stream of either. This is that middle ground — its own budget,
 * looser than the GET/HEAD one because a real browser can legitimately fire
 * many CORS preflights per page (one per distinct method/header combination
 * the browser has not already cached), so a tight limit here risks blocking
 * ordinary use.
 */
const OTHER_METHOD_RATE_LIMIT_MAX = Number(process.env.API_OTHER_METHOD_RATE_LIMIT_MAX ?? RATE_LIMIT_MAX * 10);

/**
 * The corrections budget — a third, much tighter one, on its own window.
 *
 * A real reporter files one correction at a time, by hand, occasionally, so
 * the per-IP ceiling is hours-scaled rather than minutes-scaled: five an hour
 * is generous for the honest case and useless for a script. The numbers are
 * docs/corrections-security-design.md's starting points, environment-tunable
 * because that document says they should be revisited against real usage.
 *
 * The GLOBAL ceiling is the one that is easy to leave out and matters most.
 * A per-IP limit alone is defeated by spreading submissions across a pool of
 * addresses, which is exactly the shape of the attack this feature actually
 * has to survive — not a corrupted database, but a queue flooded past the
 * point where a human can review it carefully. Past the global ceiling the
 * endpoint answers 429 regardless of who is asking.
 */
const CORRECTION_RATE_LIMIT_WINDOW_MS = Number(process.env.API_CORRECTION_RATE_LIMIT_WINDOW_MS ?? 3_600_000);
const CORRECTION_RATE_LIMIT_MAX = Number(process.env.API_CORRECTION_RATE_LIMIT_MAX ?? 5);
const CORRECTION_GLOBAL_RATE_LIMIT_MAX = Number(process.env.API_CORRECTION_GLOBAL_RATE_LIMIT_MAX ?? 200);

/*
 * Cache TTLs for the two endpoints worth caching — chosen to reflect the rule
 * this file was built around: current government data gets the SHORTEST
 * freshness window on the API, deliberately shorter than anything else here.
 *
 *   GOVERNMENT_CACHE_TTL_MS   who currently holds office. The one fact where
 *                             staleness has the highest cost — a reshuffle
 *                             already recorded in the database would
 *                             otherwise keep showing the outgoing minister
 *                             for as long as the cache lives.
 *   FACETS_CACHE_TTL_MS       party/district/role COUNTS. Nobody makes a
 *                             decision based on a count being briefly old;
 *                             this can safely be an order of magnitude
 *                             longer.
 *
 * cache.test.ts asserts GOVERNMENT_CACHE_TTL_MS < FACETS_CACHE_TTL_MS as a
 * standing invariant, not just a comment that can drift out of sync with the
 * numbers below.
 */
const GOVERNMENT_CACHE_TTL_MS = Number(process.env.API_GOVERNMENT_CACHE_TTL_MS ?? 15_000);
const FACETS_CACHE_TTL_MS = Number(process.env.API_FACETS_CACHE_TTL_MS ?? 300_000);

const governmentCache = new TtlCache<ReturnType<typeof getCurrentGovernment>>(GOVERNMENT_CACHE_TTL_MS);
const facetsCache = new TtlCache<Awaited<ReturnType<typeof getFacets>>>(FACETS_CACHE_TTL_MS);

/**
 * H-1. `JAVORA_TRUST_PROXY` (a bare boolean, trusting the LEFT-MOST
 * `X-Forwarded-For` entry from any peer at all) is replaced by an allowlist:
 * a forwarded address is honoured only when the actual TCP peer is inside
 * `JAVORA_TRUSTED_PROXIES`, and the entry taken is the right-most one that is
 * not itself a trusted proxy. See trustedProxies.ts for the matching logic.
 *
 * Kept readable, not honoured, for one release: an operator who only set the
 * old flag gets a loud startup warning instead of a silent security
 * regression to "forwarded headers are never trusted" (the safe direction to
 * fail in, but one worth telling them about rather than leaving to be
 * noticed as a rate-limiting mystery).
 */
const trustedProxyRanges = parseTrustedProxies(process.env.JAVORA_TRUSTED_PROXIES);

if (process.env.JAVORA_TRUST_PROXY !== undefined && !process.env.JAVORA_TRUSTED_PROXIES?.trim()) {
  log("warn", "deprecated-trust-proxy-env", {
    message:
      "JAVORA_TRUST_PROXY no longer has any effect (X-Forwarded-For is not trusted). " +
      "Set JAVORA_TRUSTED_PROXIES to a comma-separated CIDR/address allowlist for the real reverse proxy instead.",
  });
}

/**
 * Hard cap on the rate-limit bucket map, independent of the prune interval.
 * Without one, a flood of distinct (forged or genuinely diverse) client
 * addresses grows `rateBuckets` by one entry per request forever — pruning
 * only removes buckets whose window has already expired, which does nothing
 * for an attacker sending a fresh address on every request within one window.
 */
const RATE_BUCKET_CAP = Number(process.env.API_RATE_BUCKET_CAP ?? 50_000);

interface RateBucket { count: number; resetAt: number }

/** One map per limiter (see checkRateLimit/checkOtherMethodRateLimit below) — two independent budgets, never sharing a counter. */
const rateBuckets = new Map<string, RateBucket>();
const otherMethodBuckets = new Map<string, RateBucket>();
const correctionBuckets = new Map<string, RateBucket>();
/** One entry, keyed "global" — the site-wide corrections ceiling. */
const correctionGlobalBucket = new Map<string, RateBucket>();
let rateBucketCapLoggedThisWindow = false;
let otherMethodBucketCapLoggedThisWindow = false;
let correctionBucketCapLoggedThisWindow = false;

/** Evicts the single oldest-expiring bucket from `buckets`, so the map degrades rather than growing without bound. */
function evictOldestBucket(buckets: Map<string, RateBucket>, event: string, cap: number, alreadyLogged: () => boolean, markLogged: () => void): void {
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < oldestResetAt) {
      oldestResetAt = bucket.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) buckets.delete(oldestKey);
  if (!alreadyLogged()) {
    log("warn", event, { cap });
    markLogged();
  }
}

/** The shared fixed-window counter logic both limiters below are configured instances of. */
function checkBucket(
  buckets: Map<string, RateBucket>,
  ip: string,
  windowMs: number,
  max: number,
  cap: number,
  capEvent: string,
  alreadyLogged: () => boolean,
  markLogged: () => void,
): { limited: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    if (!buckets.has(ip) && buckets.size >= cap) {
      evictOldestBucket(buckets, capEvent, cap, alreadyLogged, markLogged);
    }
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return { limited: false };
  }
  bucket.count++;
  if (bucket.count > max) {
    return { limited: true, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { limited: false };
}

/** The GET/HEAD budget — RATE_LIMIT_MAX per RATE_LIMIT_WINDOW_MS. */
function checkRateLimit(ip: string): { limited: boolean; retryAfterSeconds?: number } {
  return checkBucket(
    rateBuckets, ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, RATE_BUCKET_CAP, "rate-bucket-cap-reached",
    () => rateBucketCapLoggedThisWindow, () => { rateBucketCapLoggedThisWindow = true; },
  );
}

/** L-2's looser budget for OPTIONS preflights and non-GET/HEAD methods (405s) — same window, ten times the ceiling by default. */
function checkOtherMethodRateLimit(ip: string): { limited: boolean; retryAfterSeconds?: number } {
  return checkBucket(
    otherMethodBuckets, ip, RATE_LIMIT_WINDOW_MS, OTHER_METHOD_RATE_LIMIT_MAX, RATE_BUCKET_CAP, "other-method-rate-bucket-cap-reached",
    () => otherMethodBucketCapLoggedThisWindow, () => { otherMethodBucketCapLoggedThisWindow = true; },
  );
}

/** The corrections budget — its own map, its own hour-long window. */
function checkCorrectionRateLimit(ip: string): { limited: boolean; retryAfterSeconds?: number } {
  return checkBucket(
    correctionBuckets, ip, CORRECTION_RATE_LIMIT_WINDOW_MS, CORRECTION_RATE_LIMIT_MAX, RATE_BUCKET_CAP,
    "correction-rate-bucket-cap-reached",
    () => correctionBucketCapLoggedThisWindow, () => { correctionBucketCapLoggedThisWindow = true; },
  );
}

/**
 * The site-wide corrections ceiling, keyed on a constant rather than an IP —
 * the same fixed-window counter, deliberately not per-client, so a pool of
 * addresses staying individually under the per-IP limit still hits this one.
 */
function checkCorrectionGlobalRateLimit(): { limited: boolean; retryAfterSeconds?: number } {
  return checkBucket(
    correctionGlobalBucket, "global", CORRECTION_RATE_LIMIT_WINDOW_MS, CORRECTION_GLOBAL_RATE_LIMIT_MAX,
    RATE_BUCKET_CAP, "correction-global-rate-bucket-cap-reached",
    () => true, () => {},
  );
}

/** Bounds memory: without this, one IP per request forever grows either map. */
function pruneRateBuckets(): void {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
  for (const [ip, bucket] of otherMethodBuckets) {
    if (now >= bucket.resetAt) otherMethodBuckets.delete(ip);
  }
  for (const [ip, bucket] of correctionBuckets) {
    if (now >= bucket.resetAt) correctionBuckets.delete(ip);
  }
  rateBucketCapLoggedThisWindow = false;
  otherMethodBucketCapLoggedThisWindow = false;
  correctionBucketCapLoggedThisWindow = false;
}

/** The client's address for rate limiting — see trustedProxyRanges above. */
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedFor = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  return resolveClientIp(req.socket.remoteAddress ?? "unknown", forwardedFor, trustedProxyRanges);
}

/* ==========================================================================
   Route handling
   ========================================================================== */

/**
 * `intake` is the corrections write handle, or null.
 *
 * Null is a supported, non-degraded state, not an oversight: a deployment
 * whose database file is not writable by the API process (or one that simply
 * has not opted in) answers `POST /api/corrections` with 503 and a machine
 * readable `corrections-unavailable`, which the form reads to keep saying
 * plainly that submissions are not connected. An endpoint that accepted a
 * report and dropped it would be strictly worse than the disconnected form
 * this feature replaced.
 */
export function createApiServer(
  store: CanonicalStore,
  queryDb: Queryable = store.database,
  intake: CorrectionIntake | null = null,
) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const start = Date.now();
    const origin = req.headers.origin as string | undefined;
    const ip = clientIp(req);

    res.on("finish", () => {
      log("info", "request", { method: req.method, path: req.url, status: res.statusCode, durationMs: Date.now() - start });
    });

    if (req.method === "OPTIONS") {
      // L-2: its own, looser budget — not the GET/HEAD one (a real browser
      // can legitimately fire many preflights per page) and not "no limit
      // at all" (the previous behaviour: each one still parses a URL and
      // allocates a response, an unauthenticated client could send an
      // unbounded stream of them, and now they have a ceiling too).
      const otherRate = checkOtherMethodRateLimit(ip);
      if (otherRate.limited) {
        log("warn", "rate-limited", { ip, path: req.url, method: req.method });
        res.setHeader("retry-after", String(otherRate.retryAfterSeconds));
        sendError(res, 429, "rate-limited", `Too many requests. Retry after ${otherRate.retryAfterSeconds}s.`, origin);
        return;
      }

      const headers: Record<string, string> = {
        // POST is advertised only where it exists. A browser preflighting a
        // POST to any other path is told the method is not allowed there,
        // rather than being given a blanket permission the router would then
        // answer with 405 anyway.
        "access-control-allow-methods":
          pathOf(req) === CORRECTIONS_PATH ? "GET,HEAD,OPTIONS,POST" : "GET,HEAD,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      };
      // L-4: omit the header on a disallowed origin rather than emit it
      // empty — an empty Access-Control-Allow-Origin is not "no access", it
      // is a value, and treating "reject" and "explicitly blank" as the same
      // response is the kind of ambiguity CORS handling should not have.
      if (origin && allowedOrigins.includes(origin)) {
        headers["access-control-allow-origin"] = origin;
        headers["vary"] = "Origin";
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (req.method === "HEAD") HEAD_RESPONSES.add(res);

    if (req.method !== "GET" && req.method !== "HEAD") {
      /*
       * The ONE write. Matched on the exact, normalised path and on POST
       * alone, before the 405 below — every other method/path combination,
       * `/api/corrections` included, still falls through to it. In
       * particular there is no method-override handling here: an
       * `X-HTTP-Method-Override: POST` on a GET reaches the read router
       * exactly as the GET it is, the same as it always did.
       */
      if (req.method === "POST" && pathOf(req) === CORRECTIONS_PATH) {
        handleCorrection(req, res, ip, origin).catch((error) => {
          logError("correction-failed", error, { ip });
          sendError(res, 500, "internal-error", undefined, origin);
        });
        return;
      }

      // L-2: same looser budget as OPTIONS above — see its comment.
      const otherRate = checkOtherMethodRateLimit(ip);
      if (otherRate.limited) {
        log("warn", "rate-limited", { ip, path: req.url, method: req.method });
        res.setHeader("retry-after", String(otherRate.retryAfterSeconds));
        sendError(res, 429, "rate-limited", `Too many requests. Retry after ${otherRate.retryAfterSeconds}s.`, origin);
        return;
      }
      // Read-only by design: canonical data is written by the sync worker.
      sendError(res, 405, "method-not-allowed", undefined, origin);
      return;
    }

    // L-3: HEAD is routed through the exact same handling as GET from here
    // on — including this same rate budget — and only sendJson's final
    // write withholds the body (see HEAD_RESPONSES above).
    const rate = checkRateLimit(ip);
    if (rate.limited) {
      log("warn", "rate-limited", { ip, path: req.url, method: req.method });
      res.setHeader("retry-after", String(rate.retryAfterSeconds));
      sendError(res, 429, "rate-limited", `Too many requests. Retry after ${rate.retryAfterSeconds}s.`, origin);
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      sendError(res, 400, "bad-request", "malformed URL", origin);
      return;
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    const params = url.searchParams;

    handle(path, params, res, origin).catch((error) => {
      if (error instanceof ValidationError) {
        sendError(res, error.status, "invalid-request", error.message, origin);
        return;
      }
      // Never leak a stack trace, a SQL fragment or a connection string to a
      // client — those go to the server's own log only.
      logError("request-failed", error, { path, ip });
      sendError(res, 500, "internal-error", undefined, origin);
    });
  });

  async function handle(path: string, params: URLSearchParams, res: ServerResponse, origin?: string): Promise<void> {
    if (path === "/health" || path === "/api/health") {
      await handleHealth(res, origin);
      return;
    }

    if (path === "/api/status") {
      sendJson(res, 200, {
        counts: store.counts(),
        sources: store.listSources().map(toPublicSource),
        recentRuns: store.listRuns(undefined, 10).map(toPublicSyncRun),
        // Stated explicitly so no client has to infer it.
        automaticSyncOperational: isAutomaticSyncOperational(),
      }, origin);
      return;
    }

    if (path === "/api/sources") {
      sendJson(res, 200, { sources: store.listSources().map(toPublicSource) }, origin);
      return;
    }

    if (path === "/api/facets") {
      const facets = await withTimeout(
        facetsCache.get(() => getFacets(queryDb)),
        QUERY_TIMEOUT_MS,
        () => new Error(`getFacets timed out after ${QUERY_TIMEOUT_MS}ms`),
      );
      sendJson(res, 200, facets, origin, FACETS_CACHE_TTL_MS / 1000);
      return;
    }

    /*
     * The current government, derived from canonical records.
     *
     * Carries person ids and slugs, not whole person records: every card on
     * the page links to the one canonical profile at /person/<slug> rather
     * than to a second, government-specific profile system.
     *
     * Cached with the SHORTEST TTL of anything on this API — see the comment
     * above GOVERNMENT_CACHE_TTL_MS for why "who currently holds office" is
     * the one answer this site cannot afford to serve stale for long.
     */
    if (path === "/api/government/current" || path === "/government/current") {
      const government = await governmentCache.get(async () => getCurrentGovernment(store));
      sendJson(res, 200, government, origin, GOVERNMENT_CACHE_TTL_MS / 1000);
      return;
    }

    if (path === "/api/search") {
      const q = parseSearchTerm(params.get("q"));
      const { limit } = parsePagination(new URLSearchParams({ limit: params.get("limit") ?? "8" }));
      const items = await withTimeout(
        suggestPeople(queryDb, q, Math.min(limit, 25)),
        QUERY_TIMEOUT_MS,
        () => new Error(`suggestPeople timed out after ${QUERY_TIMEOUT_MS}ms`),
      );
      sendJson(res, 200, { query: q, items }, origin);
      return;
    }

    if (path === "/api/people") {
      const options = parseListOptions(params);
      const page = await withTimeout(
        listPeople(queryDb, options),
        QUERY_TIMEOUT_MS,
        () => new Error(`listPeople timed out after ${QUERY_TIMEOUT_MS}ms`),
      );
      sendJson(res, 200, page, origin);
      return;
    }

    const personMatch = path.match(/^\/api\/people\/([^/]+)(?:\/(positions|timeline|evidence|education|employment))?$/);
    if (personMatch) {
      const idOrSlug = parseIdOrSlug(decodePathSegment(personMatch[1]!, "person identifier"));
      const section = personMatch[2];
      const record = await withTimeout(
        getPerson(queryDb, idOrSlug),
        QUERY_TIMEOUT_MS,
        () => new Error(`getPerson timed out after ${QUERY_TIMEOUT_MS}ms`),
      );

      if (!record) {
        sendError(res, 404, "not-found", `no record for "${idOrSlug}"`, origin);
        return;
      }
      if (section === "positions") { sendJson(res, 200, { positions: record.positions }, origin); return; }
      if (section === "timeline") { sendJson(res, 200, { timeline: record.timeline }, origin); return; }
      if (section === "evidence") { sendJson(res, 200, { evidence: record.evidence }, origin); return; }
      if (section === "education") {
        sendJson(res, 200, { education: record.education, examResults: record.examResults }, origin);
        return;
      }
      if (section === "employment") {
        sendJson(res, 200, { employment: record.employment, publicService: record.publicService }, origin);
        return;
      }
      sendJson(res, 200, record, origin);
      return;
    }

    sendError(res, 404, "no-such-endpoint", `no endpoint at "${path}"`, origin);
  }

  /**
   * `POST /api/corrections` — file one correction report.
   *
   * Order matters and is deliberate: rate limits are checked BEFORE the body
   * is read, so a client past its ceiling is rejected without the server
   * buffering (or the reporter uploading) anything. The global ceiling is
   * checked after the per-IP one so that a single abusive client burns its
   * own budget rather than the site-wide one.
   *
   * The response tells the reporter their report's id and nothing else. Not
   * how many reports are queued, not whether theirs matched an existing one
   * in any way they could probe with — `duplicate` is reported because it is
   * about their own submission, and a duplicate answers with the original's
   * id precisely so a double-submitted form does not become two things a
   * reviewer must read.
   */
  async function handleCorrection(
    req: IncomingMessage,
    res: ServerResponse,
    ip: string,
    origin?: string,
  ): Promise<void> {
    if (!intake) {
      // Honest unavailability. See createApiServer's `intake` parameter.
      sendError(res, 503, "corrections-unavailable",
        "This deployment cannot accept correction reports.", origin);
      return;
    }

    const perIp = checkCorrectionRateLimit(ip);
    if (perIp.limited) {
      log("warn", "correction-rate-limited", { ip, scope: "per-ip" });
      res.setHeader("retry-after", String(perIp.retryAfterSeconds));
      sendError(res, 429, "rate-limited", `Too many correction reports. Retry after ${perIp.retryAfterSeconds}s.`, origin);
      return;
    }

    const global = checkCorrectionGlobalRateLimit();
    if (global.limited) {
      log("warn", "correction-rate-limited", { ip, scope: "global" });
      res.setHeader("retry-after", String(global.retryAfterSeconds));
      sendError(res, 429, "rate-limited", `Too many correction reports site-wide. Retry after ${global.retryAfterSeconds}s.`, origin);
      return;
    }

    try {
      const body = await readJsonBody(req);
      const filed = await fileCorrection(queryDb, intake, body, ip);
      log("info", "correction-filed", { id: filed.id, duplicate: filed.duplicate });
      sendJson(res, filed.duplicate ? 200 : 201, {
        id: filed.id,
        reviewStatus: filed.reviewStatus,
        duplicate: filed.duplicate,
      }, origin);
    } catch (error) {
      if (error instanceof PayloadTooLarge) {
        sendError(res, 413, "payload-too-large", error.message, origin);
        return;
      }
      if (error instanceof ValidationError) {
        sendError(res, error.status, "invalid-request", error.message, origin);
        return;
      }
      throw error;
    }
  }

  /**
   * Reports whether the API can actually reach its database, not just
   * whether the process is running — a process that answers "ok" while its
   * only database is unreachable is worse than one that answers honestly,
   * since a load balancer or orchestrator will keep routing traffic to it.
   *
   * Reports uptime and backend kind; NEVER a connection string, a host, a
   * port or a credential.
   */
  async function handleHealth(res: ServerResponse, origin?: string): Promise<void> {
    try {
      await withTimeout(
        queryDb.get("SELECT 1 AS ok"),
        2_000,
        () => new Error("health check timed out after 2000ms"),
      );
      sendJson(res, 200, {
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        database: "reachable",
      }, origin);
    } catch (error) {
      logError("health-check-failed", error);
      sendJson(res, 503, {
        ok: false,
        uptimeSeconds: Math.round(process.uptime()),
        database: "unreachable",
      }, origin);
    }
  }

  return server;
}

/* ==========================================================================
   Startup and shutdown
   ========================================================================== */

/**
 * Narrow any `{get, all}`-shaped backend to exactly the `Queryable` surface
 * the route handlers need.
 *
 * `server/db/database.ts`'s `Database` and `server/db/postgres.ts`'s
 * `AsyncDatabase` both carry `run`/`transaction`/`close` alongside `get`/`all`
 * — needed by the sync worker and CLI, which write. `queries.ts` never calls
 * those and the `Queryable` type it declares does not include them, but that
 * is a compile-time contract only: the same object was passed straight
 * through, so `.run()` was still reachable at runtime by anything that later
 * imported it typed as the wider interface. Wrapping it in a fresh object
 * exposing only `get`/`all` removes the other methods from what a route
 * handler can reach at all, independent of the read-only SQLite connection
 * below.
 */
export function toQueryable(db: Pick<Queryable, "get" | "all">): Queryable {
  return {
    get<T = Record<string, unknown>>(sql: string, params?: unknown) {
      return db.get<T>(sql, params);
    },
    all<T = Record<string, unknown>>(sql: string, params?: unknown) {
      return db.all<T>(sql, params);
    },
  };
}

/**
 * M-6 (docs/security-audit-followup-2026-09-04.md). `.env.production.example`
 * documents that `DATABASE_URL` should name a SELECT-only role — but nothing
 * enforced that at runtime; a credential with write access dropped in by
 * accident (or because provisioning the dedicated role was skipped) would
 * work exactly as well as the correct one, silently. This converts that
 * documented intention into an enforced one: a real query against the
 * connected database, at startup, asking Postgres itself whether the current
 * user could write.
 *
 * `has_table_privilege` is checked against `person` specifically — the
 * table every canonical write path ultimately touches — rather than trying
 * to enumerate every table a role might have INSERT on.
 */
export async function isWriteCapablePostgresCredential(pg: Pick<AsyncDatabase, "get">): Promise<boolean> {
  const row = await pg.get<{ w: boolean | string }>(
    `SELECT has_table_privilege(current_user, 'person', 'INSERT') AS w`,
  );
  // node-postgres returns a SQL boolean as a JS boolean already; the
  // string/boolean union just protects against a stub returning "t"/"f" the
  // way some drivers historically have.
  return row?.w === true || row?.w === "t" || row?.w === "true";
}

/**
 * Refuses to start on a write-capable Postgres credential unless the
 * operator explicitly opts out — the enforcement half of the check above.
 * `JAVORA_ALLOW_WRITE_CAPABLE_DB=true` exists for a deployment mid-migration
 * to the dedicated role, not as a normal production setting.
 */
export async function assertReadOnlyPostgresCredential(pg: Pick<AsyncDatabase, "get">): Promise<void> {
  if (!(await isWriteCapablePostgresCredential(pg))) return;

  log("error", "insecure-db-credential", {
    message:
      "DATABASE_URL's Postgres credential can INSERT into 'person'. The public API's database " +
      "privileges must be limited to SELECT (SECURITY--SL Politics.md §3.2, Invariant 7/12). " +
      "Provision the dedicated read-only role with scripts/provision-postgres-roles.mjs and point " +
      "DATABASE_URL at it.",
  });

  if (process.env.JAVORA_ALLOW_WRITE_CAPABLE_DB !== "true") {
    throw new Error(
      "Refusing to start: DATABASE_URL's Postgres credential has write access. " +
        "Set JAVORA_ALLOW_WRITE_CAPABLE_DB=true to override (not recommended for production).",
    );
  }
}

/**
 * Which database serves the five hardened read endpoints.
 *
 * `DATABASE_URL` set: PostgreSQL, through a connection pool
 * (`server/db/postgres.ts`). Unset: the same SQLite database the sync worker
 * and CLI use. `/api/status`, `/api/sources` and `/api/government/current`
 * always read the SQLite `CanonicalStore` regardless — converting those to
 * an async backend is out of scope for this pass (see server/db/postgres.ts's
 * header for exactly what that would take).
 */
async function openQueryBackend(): Promise<{ queryDb: Queryable; close: () => Promise<void> | void; kind: "postgresql" | "sqlite" }> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const pg: AsyncDatabase = openPostgres(connectionString);
    await assertReadOnlyPostgresCredential(pg);
    return { queryDb: toQueryable(pg), close: () => pg.close(), kind: "postgresql" };
  }
  return { queryDb: undefined as unknown as Queryable, close: () => {}, kind: "sqlite" };
}

/**
 * Open the corrections write handle — a SECOND connection, opened
 * read-write, separate from the read-only canonical one above.
 *
 * The separation is the point, and it is the SQLite half of
 * docs/corrections-security-design.md's "Database privilege: a third role".
 * There is no way to make one connection both unable to write `person` and
 * able to write `correction_report`, so the process holds two: the canonical
 * one stays read-only at the engine level, and this one is immediately
 * narrowed by `openCorrectionIntake` to a single insert. Nothing in the API
 * ever holds a general-purpose writable handle.
 *
 * `JAVORA_CORRECTIONS=off` disables the endpoint outright (it then answers
 * 503), and so does any failure to open the connection — a read-only volume,
 * a missing file. Failing closed and saying so is correct here: the
 * alternative is an endpoint that accepts reports it cannot store.
 *
 * On the Postgres path this still opens SQLite, matching `/api/status`,
 * `/api/sources` and `/api/government/current`, which also always read the
 * SQLite `CanonicalStore` — Postgres is an opt-in read accelerator, and
 * `correction_report` is not something it serves.
 */
function openIntake(): CorrectionIntake | null {
  if (process.env.JAVORA_CORRECTIONS === "off") {
    log("info", "corrections-disabled", { reason: "JAVORA_CORRECTIONS=off" });
    return null;
  }
  try {
    return openCorrectionIntake(openDatabase());
  } catch (error) {
    logError("corrections-intake-unavailable", error);
    return null;
  }
}

/** Start the API. Returns the server and the resources it holds open. */
export async function startApi(port = DEFAULT_PORT): Promise<{ server: ReturnType<typeof createApiServer>; db: Database }> {
  // Migrate with a normal read-write connection, then drop it in favour of a
  // read-only one for everything this process does from here on. The API
  // never writes canonical data — the sync worker and CLI are the only
  // writers — so its own connection should not be ABLE to, not merely be
  // trusted not to: a read-only SQLite connection rejects a write at the
  // engine level (see `openDatabase`'s `readOnly` option) rather than
  // depending solely on every call site only ever using `get`/`all`.
  openMigrated().close();
  const db = openDatabase(undefined, { readOnly: true });
  const store = new CanonicalStore(db);
  const backend = await openQueryBackend();
  const queryDb = backend.kind === "sqlite" ? toQueryable(store.database) : backend.queryDb;
  const intake = openIntake();

  const server = createApiServer(store, queryDb, intake);

  // Guards against a slow client or a stalled response holding a socket open
  // indefinitely — independent of the per-query timeout above, which bounds
  // the database call but not header delivery or a client reading slowly.
  server.headersTimeout = 8_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  const pruneInterval = setInterval(pruneRateBuckets, RATE_LIMIT_WINDOW_MS).unref();

  server.listen(port, () => {
    log("info", "listening", {
      port,
      queryBackend: backend.kind,
      automaticSyncOperational: isAutomaticSyncOperational(),
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "shutdown-start", { signal });

    clearInterval(pruneInterval);
    server.close(() => {
      Promise.resolve(backend.close())
        .catch((error) => logError("shutdown-db-close-failed", error))
        .finally(() => {
          try { intake?.close(); } catch (error) { logError("shutdown-intake-close-failed", error); }
          try { db.close(); } catch (error) { logError("shutdown-sqlite-close-failed", error); }
          log("info", "shutdown-complete", {});
          process.exit(0);
        });
    });

    // If open connections do not drain in time, exit anyway rather than
    // hanging the process past what an orchestrator's own grace period allows.
    setTimeout(() => {
      log("warn", "shutdown-forced", {});
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return { server, db };
}

// Started directly (`node server/api/server.ts`) rather than imported.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("server.ts")) {
  startApi().catch((error) => {
    // Covers, among other things, assertReadOnlyPostgresCredential's refusal
    // to start above — logged server-side only, same as every other error
    // path in this file; never anything client-facing to leak to.
    logError("startup-failed", error);
    process.exit(1);
  });
}
