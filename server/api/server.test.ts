import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDatabase, migrate, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import {
  createApiServer, toQueryable,
  isWriteCapablePostgresCredential, assertReadOnlyPostgresCredential,
} from "./server.ts";
import { syncSource, type ConnectorRun, type NormalisedPerson } from "../sync/syncSource.ts";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level API tests.
 *
 * These make real requests, over a real socket, against a real listening
 * `createApiServer` instance — not calls into the route handler function
 * directly — because the things this test file exists to prove (status
 * codes, headers, JSON error shapes, what a client actually receives on a
 * database failure) are properties of the HTTP layer, and a direct function
 * call would skip the exact code under test.
 */

const SOURCE_ID = "S001";

function makePerson(over: Partial<NormalisedPerson> = {}): NormalisedPerson {
  const id = over.externalId ?? "1";
  const name = over.canonicalName ?? "Anura Karunathilaka";
  return {
    externalId: id,
    externalIdKey: "parliament",
    canonicalName: name,
    slug: over.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    aliases: [],
    partyId: "jathika-jana-balawegaya",
    partyName: "Jathika Jana balawegaya",
    partyAbbreviation: "JJB",
    districtId: "colombo",
    districtName: "Colombo",
    sourceUrl: `https://www.parliament.lk/en/members-of-parliament/mp-profile/${id}`,
    searchText: `${name.toLowerCase()} jathika jana balawegaya jjb colombo member of parliament`,
    positions: [
      {
        title: "Member of Parliament",
        roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka",
        districtId: "colombo",
        currentAsOf: "2026-01-01",
        precedence: 40,
        factType: "parliamentary-membership",
      },
    ],
    ...over,
  };
}

const connector = (people: NormalisedPerson[]): ConnectorRun => ({
  sourceId: SOURCE_ID,
  connectorVersion: "test@1",
  parserVersion: "test@1",
  url: "https://www.parliament.lk/",
  async fetch() {
    return {
      retrievedAt: "2026-01-01T00:00:00.000Z",
      canonicalPayload: JSON.stringify(people.map((p) => [p.externalId, p.canonicalName])),
      people,
    };
  },
});

let db: Database;
let store: CanonicalStore;
let server: ReturnType<typeof createApiServer>;
let base: string;

beforeAll(async () => {
  db = openDatabase(":memory:");
  migrate(db, { silent: true });
  store = new CanonicalStore(db);
  store.upsertSource({
    id: SOURCE_ID,
    name: "Parliament",
    institution: "Parliament of Sri Lanka",
    sourceType: "legislature",
    category: "Official directory",
    url: "https://www.parliament.lk/",
  });

  await syncSource(
    store,
    connector([
      makePerson({ externalId: "1", canonicalName: "Anura Karunathilaka", slug: "anura-karunathilaka" }),
      makePerson({ externalId: "2", canonicalName: "Harini Amarasuriya", slug: "harini-amarasuriya" }),
      makePerson({
        externalId: "3",
        canonicalName: "Bhagya Sri Herath",
        slug: "bhagya-sri-herath",
        districtId: "anuradhapura",
        districtName: "Anuradhapura",
      }),
    ]),
  );

  // M-1: a failed run whose error_message names the kind of internal detail
  // (an internal hostname, here) that must never reach a public response.
  store.startRun({ id: "run-failed-1", sourceId: SOURCE_ID, trigger: "manual", startedAt: "2026-01-01T00:00:00.000Z" });
  store.finishRun("run-failed-1", {
    outcome: "failed",
    finishedAt: "2026-01-01T00:00:05.000Z",
    errorMessage: "connect ECONNREFUSED internal-sync-worker.staging.local:5432 at /app/server/fetchers/parliamentConnector.ts:88",
  });

  server = createApiServer(store);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("GET /health and /api/health", () => {
  it("reports ok with a reachable database", async () => {
    for (const path of ["/health", "/api/health"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.database).toBe("reachable");
      expect(typeof body.uptimeSeconds).toBe("number");
    }
  });

  it("never includes a connection string, host or credential", async () => {
    const body = await (await fetch(`${base}/api/health`)).json();
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/postgres:\/\//);
    expect(serialised).not.toMatch(/password/i);
  });
});

describe("GET /api/people — pagination", () => {
  it("returns a bounded page with a consistent shape", async () => {
    const res = await fetch(`${base}/api/people?limit=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 3, limit: 2, offset: 0, hasMore: true });
    expect(body.items).toHaveLength(2);
  });

  it("rejects a non-numeric limit with 400, not a coerced NaN query", async () => {
    const res = await fetch(`${base}/api/people?limit=abc`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid-request");
    expect(body.message).toMatch(/limit/i);
  });

  it("rejects a limit above the maximum rather than silently clamping it", async () => {
    const res = await fetch(`${base}/api/people?limit=999999`);
    expect(res.status).toBe(400);
  });

  it("rejects a negative offset", async () => {
    const res = await fetch(`${base}/api/people?offset=-1`);
    expect(res.status).toBe(400);
  });

  it("rejects more filter values than the cap allows", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `role=r${i}`).join("&");
    const res = await fetch(`${base}/api/people?${many}`);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/role/);
  });

  it("is not confused by a quote or a SQL comment in the search term", async () => {
    const res = await fetch(`${base}/api/people?${new URLSearchParams({ q: "o'brien'; DROP TABLE person;--" })}`);
    expect(res.status).toBe(200);
    expect(store.counts().people).toBe(3); // table still exists, still has all three
  });

  it("rejects a search term over the length cap", async () => {
    const res = await fetch(`${base}/api/people?${new URLSearchParams({ q: "x".repeat(500) })}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/people/:idOrSlug — invalid and missing records", () => {
  it("finds a real record by slug", async () => {
    const res = await fetch(`${base}/api/people/harini-amarasuriya`);
    expect(res.status).toBe(200);
    expect((await res.json()).person.canonical_name).toBe("Harini Amarasuriya");
  });

  it("returns 404, not 200 with an empty body, for an unknown identifier", async () => {
    const res = await fetch(`${base}/api/people/no-such-person`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not-found");
  });

  it("returns 400, not 500, for malformed percent-encoding in the path", async () => {
    /*
     * `decodeURIComponent("%%%%")` throws a bare URIError, which previously
     * fell through to the catch-all and was answered with HTTP 500 plus a
     * stack trace in the server log. Nothing leaked to the client, but a
     * malformed URL is a CLIENT error: a 5xx invites retries from clients and
     * CDNs, and files routine bad input alongside genuine server faults in
     * whatever is watching the error rate.
     */
    const res = await fetch(`${base}/api/people/%%%%`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid-request");
    // Still no internal detail, whatever the status.
    expect(JSON.stringify(body)).not.toMatch(/URIError|decodeURIComponent|at .*\.ts:\d+/);
  });

  it("does not 500 on any of a range of malformed identifiers", async () => {
    for (const raw of ["%%%%", "%E0%A4%A", "%ZZ", "%"]) {
      const res = await fetch(`${base}/api/people/${raw}`);
      expect([400, 404], `"${raw}" produced ${res.status}`).toContain(res.status);
    }
  });

  it("returns 404 for a section of an unknown person rather than a bare 200", async () => {
    const res = await fetch(`${base}/api/people/no-such-person/positions`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/search", () => {
  it("suggests matches", async () => {
    const res = await fetch(`${base}/api/search?q=anura`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("returns an empty list, not an error, for an empty query", async () => {
    const res = await fetch(`${base}/api/search?q=`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("caps the requested suggestion count", async () => {
    const res = await fetch(`${base}/api/search?q=a&limit=2`);
    const body = await res.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
  });
});

describe("GET /api/facets", () => {
  it("returns party, district and role counts", async () => {
    const res = await fetch(`${base}/api/facets`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parties.length).toBeGreaterThan(0);
    expect(body.districts.length).toBeGreaterThan(0);
    expect(body.roles.length).toBeGreaterThan(0);
  });
});

/*
 * M-1 — /api/status and /api/sources used to be SELECT * FROM sync_run /
 * SELECT * FROM source, which included sync_run.error_message: raw connector
 * exception text (internal hostnames, upstream URLs, file paths). Both now
 * map to an explicit public shape via toPublicSyncRun()/toPublicSource().
 */
describe("GET /api/status and /api/sources — public shape (M-1)", () => {
  it("/api/status's recentRuns never includes error_message or its content", async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const serialised = JSON.stringify(body);

    expect(serialised).not.toMatch(/error_message/);
    expect(serialised).not.toMatch(/internal-sync-worker/);
    expect(serialised).not.toMatch(/ECONNREFUSED/);
    expect(serialised).not.toMatch(/parliamentConnector\.ts/);

    const failedRun = body.recentRuns.find((r: { outcome: string }) => r.outcome === "failed");
    expect(failedRun).toBeTruthy();
    expect(Object.keys(failedRun).sort()).toEqual(
      ["createdCount", "finishedAt", "outcome", "seenCount", "sourceId", "startedAt", "unchangedCount", "updatedCount"].sort(),
    );
  });

  it("/api/status's exact top-level and sources key sets are pinned", async () => {
    const body = await (await fetch(`${base}/api/status`)).json();
    expect(Object.keys(body).sort()).toEqual(["automaticSyncOperational", "counts", "recentRuns", "sources"].sort());
    expect(Object.keys(body.sources[0]).sort()).toEqual(
      ["category", "description", "id", "institution", "lastCheckedAt", "lastSuccessfulSyncAt", "name", "sourceType", "syncState", "url"].sort(),
    );
  });

  it("/api/sources returns the same public source shape, with no internal columns", async () => {
    const body = await (await fetch(`${base}/api/sources`)).json();
    expect(Object.keys(body)).toEqual(["sources"]);
    expect(body.sources.length).toBeGreaterThan(0);
    for (const source of body.sources) {
      expect(Object.keys(source).sort()).toEqual(
        ["category", "description", "id", "institution", "lastCheckedAt", "lastSuccessfulSyncAt", "name", "sourceType", "syncState", "url"].sort(),
      );
      // created_at/updated_at are internal bookkeeping, not part of the
      // intentionally-public source shape the frontend already shows.
      expect(source).not.toHaveProperty("created_at");
      expect(source).not.toHaveProperty("updated_at");
    }
  });

  it("no response body anywhere on this API contains an error_message key", async () => {
    for (const path of ["/api/status", "/api/sources", "/api/people", "/api/search?q=a", "/api/facets"]) {
      const body = await (await fetch(`${base}${path}`)).json();
      expect(JSON.stringify(body), path).not.toMatch(/"error_message"/);
    }
  });
});

/**
 * Starts a second `createApiServer` instance with the given env vars set
 * before the module is (re-)imported, so rate-limit-related constants
 * (read from `process.env` once, at module load) pick up test-specific
 * values rather than whatever the top-level `server`/`base` instance
 * already captured. Shared by every describe block below that needs a
 * tight, deterministic limit rather than the real defaults.
 */
async function startLimited(env: Record<string, string>) {
  const { vi } = await import("vitest");
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const { createApiServer: createLimited } = await import("./server.ts");
  const limitedDb = openDatabase(":memory:");
  migrate(limitedDb, { silent: true });
  const limitedStore = new CanonicalStore(limitedDb);
  const limitedServer = createLimited(limitedStore);
  await new Promise<void>((resolve) => limitedServer.listen(0, resolve));
  const { port } = limitedServer.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => limitedServer.close(resolve));
      limitedDb.close();
      for (const key of Object.keys(env)) delete process.env[key];
    },
  };
}

describe("method and route handling", () => {
  it("rejects non-GET methods with 405", async () => {
    const res = await fetch(`${base}/api/people`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  /*
   * L-3 (docs/security-audit-followup-2026-09-04.md). §4.1 lists HEAD among
   * the expected public methods (monitors, CDNs and link checkers use it),
   * and this API answered it with a bare 405 like any other non-GET method.
   * It now runs the identical handling GET gets — same route, same status,
   * same headers — with only the body withheld.
   */
  describe("HEAD (L-3)", () => {
    it("answers 200 with the same headers a GET would, but no body", async () => {
      const [headRes, getRes] = await Promise.all([
        fetch(`${base}/api/facets`, { method: "HEAD" }),
        fetch(`${base}/api/facets`),
      ]);
      expect(headRes.status).toBe(200);
      expect(headRes.status).toBe(getRes.status);
      expect(headRes.headers.get("content-type")).toBe(getRes.headers.get("content-type"));
      // Content-Length matches what the GET body actually was — the header
      // is not suppressed, only the body itself.
      expect(headRes.headers.get("content-length")).toBe(getRes.headers.get("content-length"));
      expect(await headRes.text()).toBe("");
    });

    it("behaves like GET for routing — 404 for an unknown endpoint, not a bare 405", async () => {
      const res = await fetch(`${base}/api/does-not-exist`, { method: "HEAD" });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    });

    it("is rate-limited on the same GET/HEAD budget, not exempt", async () => {
      const { base: limitedBase, stop } = await startLimited({
        API_RATE_LIMIT_MAX: "1",
        API_RATE_LIMIT_WINDOW_MS: "60000",
      });
      try {
        const first = await fetch(`${limitedBase}/api/facets`, { method: "HEAD" });
        const second = await fetch(`${limitedBase}/api/facets`, { method: "HEAD" });
        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
      } finally {
        await stop();
      }
    });
  });

  /*
   * L-2 (docs/security-audit-followup-2026-09-04.md). OPTIONS and non-GET/
   * HEAD methods used to bypass rate limiting entirely. They now share a
   * separate, looser budget (checkOtherMethodRateLimit) — exercised here with
   * a tiny limit so the test does not need hundreds of requests.
   */
  describe("other-method rate limiting (L-2)", () => {
    it("rate-limits a flood of OPTIONS preflights once the looser budget is exceeded", async () => {
      const { base: limitedBase, stop } = await startLimited({ API_OTHER_METHOD_RATE_LIMIT_MAX: "2" });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          const res = await fetch(`${limitedBase}/api/people`, { method: "OPTIONS" });
          statuses.push(res.status);
        }
        expect(statuses.slice(0, 2)).toEqual([204, 204]);
        expect(statuses.slice(2)).toEqual([429, 429]);
      } finally {
        await stop();
      }
    });

    it("rate-limits a flood of rejected non-GET methods (405s) on the same looser budget", async () => {
      const { base: limitedBase, stop } = await startLimited({ API_OTHER_METHOD_RATE_LIMIT_MAX: "2" });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          const res = await fetch(`${limitedBase}/api/people`, { method: "POST" });
          statuses.push(res.status);
        }
        expect(statuses.slice(0, 2)).toEqual([405, 405]);
        expect(statuses.slice(2)).toEqual([429, 429]);
      } finally {
        await stop();
      }
    });

    it("keeps the OPTIONS/405 budget independent of the GET/HEAD budget", async () => {
      const { base: limitedBase, stop } = await startLimited({
        API_RATE_LIMIT_MAX: "1",
        API_OTHER_METHOD_RATE_LIMIT_MAX: "5",
      });
      try {
        // Exhaust the GET budget...
        await fetch(`${limitedBase}/api/facets`);
        const secondGet = await fetch(`${limitedBase}/api/facets`);
        expect(secondGet.status).toBe(429);

        // ...an OPTIONS preflight from the SAME client is unaffected, because
        // it draws from the other-method budget, not the GET one.
        const preflight = await fetch(`${limitedBase}/api/people`, { method: "OPTIONS" });
        expect(preflight.status).toBe(204);
      } finally {
        await stop();
      }
    });
  });

  it("returns 404 for an endpoint that does not exist", async () => {
    const res = await fetch(`${base}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no-such-endpoint");
  });

  it("never includes a stack trace in an error body", async () => {
    for (const path of ["/api/does-not-exist", "/api/people/nope"]) {
      const body = await (await fetch(`${base}${path}`)).json();
      expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/); // a stack frame's shape
      expect(body).not.toHaveProperty("stack");
    }
  });

  /*
   * Method-override and proxy-rewrite headers must never change what this
   * server treats as the request's real method or path — the security policy
   * calls this out by name (SECURITY--SL Politics.md §4.3) precisely because
   * frameworks that DO honour these headers turn them into an authorization
   * bypass: a client sends a POST that a WAF or an upstream proxy sees and
   * allows as harmless, and the header alone flips it back into a write on
   * the origin server. This server reads `req.method`/`req.url` directly from
   * Node's own HTTP parser (server.ts never inspects these headers at all),
   * so the test is really asserting an absence — but an absence is exactly
   * the thing a later change could reintroduce without anyone noticing.
   */
  it("ignores X-HTTP-Method-Override and X-Method-Override on a POST", async () => {
    for (const header of ["X-HTTP-Method-Override", "X-Method-Override"]) {
      const res = await fetch(`${base}/api/people`, { method: "POST", headers: { [header]: "GET" } });
      expect(res.status, `${header} must not turn a POST into an allowed GET`).toBe(405);
    }
  });

  it("ignores X-Original-URL and X-Rewrite-URL on an ordinary GET", async () => {
    for (const header of ["X-Original-URL", "X-Rewrite-URL"]) {
      const res = await fetch(`${base}/api/people?limit=1`, { headers: { [header]: "/../../etc/passwd" } });
      // The header must have no routing effect at all: this is still an
      // ordinary, valid /api/people request and answers normally.
      expect(res.status, `${header} must not change routing`).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("items");
    }
  });
});

describe("CORS", () => {
  it("echoes an allowed origin", async () => {
    const res = await fetch(`${base}/api/facets`, { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("does not echo a disallowed origin", async () => {
    const res = await fetch(`${base}/api/facets`, { headers: { origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight OPTIONS request", async () => {
    const res = await fetch(`${base}/api/people`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
  });

  /*
   * L-4 (docs/security-audit-followup-2026-09-04.md). The OPTIONS handler
   * used to write `"access-control-allow-origin": ""` for a disallowed
   * origin — a present-but-empty header, not the same thing as no header at
   * all. Fetch's Headers.get() distinguishes the two: null means absent.
   */
  it("omits Access-Control-Allow-Origin entirely on a rejected preflight, rather than sending it empty", async () => {
    const res = await fetch(`${base}/api/people`, {
      method: "OPTIONS",
      headers: { origin: "http://evil.example", "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.has("access-control-allow-origin")).toBe(false);
  });
});

describe("database failure behaviour", () => {
  it("returns 500 with no internal detail when the database is unreachable, and health reports it", async () => {
    const failingDb = openDatabase(":memory:");
    migrate(failingDb, { silent: true });
    const failingStore = new CanonicalStore(failingDb);
    const failingServer = createApiServer(failingStore);
    await new Promise<void>((resolve) => failingServer.listen(0, resolve));
    const { port } = failingServer.address() as AddressInfo;
    const failingBase = `http://127.0.0.1:${port}`;

    failingDb.close(); // simulate the database becoming unreachable mid-flight

    try {
      const peopleRes = await fetch(`${failingBase}/api/people`);
      expect(peopleRes.status).toBe(500);
      const body = await peopleRes.json();
      expect(body).toEqual({ error: "internal-error" }); // no message, no stack, no SQL

      const healthRes = await fetch(`${failingBase}/api/health`);
      expect(healthRes.status).toBe(503);
      expect((await healthRes.json()).database).toBe("unreachable");
    } finally {
      await new Promise((resolve) => failingServer.close(resolve));
    }
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-IP limit is exceeded", async () => {
    // The limit is read from the environment once, at module load — so this
    // test resets the module registry and re-imports with a tiny limit set,
    // rather than trying to mutate a constant the running server already
    // captured.
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.API_RATE_LIMIT_MAX = "3";
    process.env.API_RATE_LIMIT_WINDOW_MS = "60000";

    const { createApiServer: createLimited } = await import("./server.ts");
    const limitedDb = openDatabase(":memory:");
    migrate(limitedDb, { silent: true });
    const limitedStore = new CanonicalStore(limitedDb);
    const limitedServer = createLimited(limitedStore);
    await new Promise<void>((resolve) => limitedServer.listen(0, resolve));
    const { port } = limitedServer.address() as AddressInfo;
    const limitedBase = `http://127.0.0.1:${port}`;

    try {
      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${limitedBase}/api/facets`);
        results.push(res.status);
        if (res.status === 429) {
          expect(res.headers.get("retry-after")).not.toBeNull();
        }
      }
      expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(results.slice(0, 3)).toEqual([200, 200, 200]);
    } finally {
      await new Promise((resolve) => limitedServer.close(resolve));
      limitedDb.close();
      delete process.env.API_RATE_LIMIT_MAX;
      delete process.env.API_RATE_LIMIT_WINDOW_MS;
    }
  });
});

/*
 * H-1 — the rate limiter's client-identity resolution. `JAVORA_TRUST_PROXY`
 * used to trust X-Forwarded-For from ANY peer, taking the left-most
 * (client-controlled) entry; `JAVORA_TRUSTED_PROXIES` requires the actual
 * socket peer to be on an allowlist before the header is read at all, and
 * takes the right-most non-trusted entry. All requests here connect over
 * loopback, so "the trusted socket" in these tests is 127.0.0.1/32.
 */
describe("trusted proxy allowlist (H-1)", () => {
  it("a forged X-Forwarded-For from an untrusted socket does not create a new bucket — the 429 still fires", async () => {
    // JAVORA_TRUSTED_PROXIES unset: every request here is answered from the
    // SAME bucket (the real socket address) no matter what X-Forwarded-For
    // claims, so a tiny limit is exceeded regardless of how many distinct
    // forged addresses are sent.
    const { base, stop } = await startLimited({
      API_RATE_LIMIT_MAX: "2",
      API_RATE_LIMIT_WINDOW_MS: "60000",
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": `10.0.0.${i}` } });
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    } finally {
      await stop();
    }
  });

  it("a trusted proxy's forwarded address is honoured, and distinguishes rate-limit identity", async () => {
    const { base, stop } = await startLimited({
      JAVORA_TRUSTED_PROXIES: "127.0.0.1/32",
      API_RATE_LIMIT_MAX: "1",
      API_RATE_LIMIT_WINDOW_MS: "60000",
    });
    try {
      // Client "A": first request allowed, second limited.
      const a1 = await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "203.0.113.10" } });
      const a2 = await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "203.0.113.10" } });
      expect(a1.status).toBe(200);
      expect(a2.status).toBe(429);

      // Client "B", a DIFFERENT forwarded address from the same trusted
      // socket, gets its own budget rather than sharing A's.
      const b1 = await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "203.0.113.20" } });
      expect(b1.status).toBe(200);
    } finally {
      await stop();
    }
  });

  it("takes the right-most X-Forwarded-For entry, not the client-controlled left-most one", async () => {
    const { base, stop } = await startLimited({
      JAVORA_TRUSTED_PROXIES: "127.0.0.1/32",
      API_RATE_LIMIT_MAX: "1",
      API_RATE_LIMIT_WINDOW_MS: "60000",
    });
    try {
      // A client sending its own X-Forwarded-For directly (no real proxy in
      // the chain) puts its forged entry left-most; a real proxy would only
      // ever APPEND. Two different forged left-most values with the SAME
      // right-most (the trusted proxy's own append) must share one bucket.
      const r1 = await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.30" } });
      const r2 = await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.30" } });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(429); // same bucket as r1 — the left-most value was ignored
    } finally {
      await stop();
    }
  });

  it("the bucket map degrades under its cap instead of growing without bound", async () => {
    const { base, stop } = await startLimited({
      JAVORA_TRUSTED_PROXIES: "127.0.0.1/32",
      API_RATE_LIMIT_MAX: "1",
      API_RATE_LIMIT_WINDOW_MS: "60000",
      API_RATE_BUCKET_CAP: "3",
    });
    try {
      const forwarded = (ip: string) => fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": ip } });

      expect((await forwarded("10.0.0.1")).status).toBe(200); // bucket "A" created
      expect((await forwarded("10.0.0.1")).status).toBe(429); // "A" is now limited
      expect((await forwarded("10.0.0.2")).status).toBe(200); // "B" — map size 2
      expect((await forwarded("10.0.0.3")).status).toBe(200); // "C" — map size 3, at cap
      expect((await forwarded("10.0.0.4")).status).toBe(200); // "D" — at cap: evicts the oldest ("A") first

      // "A" was evicted to make room for "D", so it is answered as a fresh
      // bucket (200), not remembered as already-limited (429) — proof the
      // map is bounded rather than merely large.
      expect((await forwarded("10.0.0.1")).status).toBe(200);
    } finally {
      await stop();
    }
  });

  it("logs rate-bucket-cap-reached when the cap is hit", async () => {
    const { vi } = await import("vitest");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { base, stop } = await startLimited({
      JAVORA_TRUSTED_PROXIES: "127.0.0.1/32",
      API_RATE_LIMIT_MAX: "1",
      API_RATE_LIMIT_WINDOW_MS: "60000",
      API_RATE_BUCKET_CAP: "1",
    });
    try {
      await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "10.1.0.1" } });
      await fetch(`${base}/api/facets`, { headers: { "x-forwarded-for": "10.1.0.2" } }); // triggers eviction
      const loggedCapReached = logSpy.mock.calls.some(([line]) => String(line).includes("rate-bucket-cap-reached"));
      expect(loggedCapReached).toBe(true);
    } finally {
      logSpy.mockRestore();
      await stop();
    }
  });
});

/*
 * F3 — the query backend a route handler can reach is narrowed to exactly
 * `get`/`all`, independent of whether the underlying connection is SQLite or
 * Postgres. Before this existed, `openQueryBackend()` handed the FULL
 * `Database`/`AsyncDatabase` object through as `queryDb` — `run`,
 * `transaction` and `close` included — so nothing at the object itself
 * stopped a future code path in queries.ts from writing through the API's own
 * connection; only the `Queryable` TypeScript type (get/all only) suggested
 * it shouldn't, which is a compile-time convention, not a runtime guarantee.
 */
describe("toQueryable — narrowing the API's database handle", () => {
  it("still answers get/all through the wrapper", () => {
    const db = openDatabase(":memory:");
    migrate(db, { silent: true });
    const wrapped = toQueryable(db);
    expect(wrapped.get<{ n: number }>("SELECT COUNT(*) AS n FROM person")).toEqual({ n: 0 });
    expect(wrapped.all("SELECT * FROM person")).toEqual([]);
    db.close();
  });

  it("does not expose run/transaction/close from the wrapped object", () => {
    const db = openDatabase(":memory:");
    migrate(db, { silent: true });
    const wrapped = toQueryable(db);
    expect((wrapped as unknown as Record<string, unknown>).run).toBeUndefined();
    expect((wrapped as unknown as Record<string, unknown>).transaction).toBeUndefined();
    expect((wrapped as unknown as Record<string, unknown>).close).toBeUndefined();
    db.close();
  });
});

/*
 * M-6 — Postgres least privilege enforcement. `.env.production.example`
 * documents that DATABASE_URL should name a SELECT-only role, but nothing
 * verified that at runtime; a write-capable credential would work exactly as
 * well as the correct one, silently. There is no real PostgreSQL server in
 * this environment (server/db/database.ts's own header explains why SQLite
 * is what actually runs here), so this exercises the check the only way it
 * can be exercised without one: a stub implementing exactly the `get` method
 * the check calls, answering as Postgres's own `has_table_privilege` would.
 */
describe("Postgres read-only credential enforcement (M-6)", () => {
  const stubAnswering = (w: boolean | string) => ({
    get: async <T>() => ({ w } as unknown as T),
  });

  describe("isWriteCapablePostgresCredential", () => {
    it("is false for a genuinely read-only credential", async () => {
      expect(await isWriteCapablePostgresCredential(stubAnswering(false))).toBe(false);
    });

    it("is true for a write-capable credential", async () => {
      expect(await isWriteCapablePostgresCredential(stubAnswering(true))).toBe(true);
    });

    it("treats a driver's string boolean ('t') the same as a real boolean", async () => {
      expect(await isWriteCapablePostgresCredential(stubAnswering("t"))).toBe(true);
    });
  });

  describe("assertReadOnlyPostgresCredential", () => {
    it("resolves silently for a read-only credential", async () => {
      await expect(assertReadOnlyPostgresCredential(stubAnswering(false))).resolves.toBeUndefined();
    });

    it("refuses (throws) for a write-capable credential by default", async () => {
      delete process.env.JAVORA_ALLOW_WRITE_CAPABLE_DB;
      await expect(assertReadOnlyPostgresCredential(stubAnswering(true))).rejects.toThrow(/write access/i);
    });

    it("does not refuse when JAVORA_ALLOW_WRITE_CAPABLE_DB=true, but the credential is still flagged", async () => {
      process.env.JAVORA_ALLOW_WRITE_CAPABLE_DB = "true";
      try {
        await expect(assertReadOnlyPostgresCredential(stubAnswering(true))).resolves.toBeUndefined();
      } finally {
        delete process.env.JAVORA_ALLOW_WRITE_CAPABLE_DB;
      }
    });

    it("logs an insecure-db-credential event when the credential is write-capable", async () => {
      const { vi } = await import("vitest");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.JAVORA_ALLOW_WRITE_CAPABLE_DB = "true"; // don't throw; just observe the log
      try {
        await assertReadOnlyPostgresCredential(stubAnswering(true));
        const logged = errorSpy.mock.calls.some(([line]) => String(line).includes("insecure-db-credential"));
        expect(logged).toBe(true);
      } finally {
        delete process.env.JAVORA_ALLOW_WRITE_CAPABLE_DB;
        errorSpy.mockRestore();
      }
    });
  });
});
