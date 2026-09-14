import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { openDatabase, migrate, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { toQueryable } from "./server.ts";
import { openCorrectionIntake } from "./corrections.ts";

/**
 * Javora — adversarial tests for the corrections write path.
 *
 * These are docs/corrections-security-design.md's "Adversarial tests required
 * before this ships" list, numbered as it numbers them. They run at the HTTP
 * level against a real listening server for the same reason
 * `server/api/server.test.ts` does: the properties under test (status codes,
 * what is actually stored, what a client is told) are properties of the HTTP
 * layer, and calling the handler directly would skip the code that matters.
 *
 * The premise every test here shares: assume the request did NOT come from
 * `CorrectionsPage.jsx`. Assume it is a script replaying, or inventing, a
 * payload shaped like one. Nothing the client says about validation, about
 * what the record currently shows, or about the report's own review status
 * may survive.
 */

/**
 * The rate limits are read from `process.env` once, when server.ts is first
 * loaded, and the real per-IP default (five an hour) is far below what a test
 * file's worth of submissions needs. So the shared server below is built from
 * a module instance imported AFTER raising them, and the tests that are about
 * rate limiting build their own instances with their own tight values
 * (`startLimited`) rather than sharing this one's counters.
 */
type ApiFactory = typeof import("./server.ts")["createApiServer"];

let db: Database;
let store: CanonicalStore;
let createApiServer: ApiFactory;
let server: ReturnType<ApiFactory>;
let base: string;

const VALID = {
  entityId: "sunil-perera",
  fieldName: "canonicalName",
  proposedValue: "Sunil Bandara Perera",
  supportingSourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/42",
  explanation: "The profile page spells the middle name in full.",
};

const post = (body: unknown, path = "/api/corrections") =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const openReports = () =>
  db.all<Record<string, unknown>>("SELECT * FROM correction_report ORDER BY submitted_at");

beforeAll(async () => {
  process.env.API_CORRECTION_RATE_LIMIT_MAX = "1000";
  process.env.API_CORRECTION_GLOBAL_RATE_LIMIT_MAX = "10000";
  vi.resetModules();
  ({ createApiServer } = await import("./server.ts"));

  db = openDatabase(":memory:");
  migrate(db, { silent: true });
  store = new CanonicalStore(db);
  store.upsertPerson({
    id: "person-1",
    slug: "sunil-perera",
    canonicalName: "Sunil Perera",
    dateOfBirth: "1968-04-02",
  });

  server = createApiServer(store, toQueryable(db), openCorrectionIntake(db));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  db.run("DELETE FROM correction_report");
});

describe("filing a valid report", () => {
  it("stores one open row and answers 201 with its id", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toMatch(/^correction-/);
    expect(body.reviewStatus).toBe("open");

    const rows = openReports();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity_id).toBe("person-1");
    expect(rows[0]!.field_name).toBe("canonicalName");
    expect(rows[0]!.proposed_value).toBe("Sunil Bandara Perera");
    expect(rows[0]!.review_status).toBe("open");
  });

  it("stores the canonical person id, not whichever slug the reporter used", async () => {
    // A slug can be retired when records merge (CLAUDE.md, "A merged record
    // may change its published slug"); a queued report must outlive that.
    await post({ ...VALID, entityId: "sunil-perera" });
    expect(openReports()[0]!.entity_id).toBe("person-1");
  });

  it("re-derives current_value from the record rather than storing the client's claim", async () => {
    await post({ ...VALID, currentValue: "Something Entirely Invented" });
    expect(openReports()[0]!.current_value).toBe("Sunil Perera");
  });

  it("records a reporter token, never the address itself", async () => {
    await post(VALID);
    const hash = openReports()[0]!.submitter_ip_hash as string;
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain("127.0.0.1");
    expect(openReports()[0]!.submitter_contact).toBeNull();
  });

  it("answers a repeat submission with the original id instead of queuing it twice", async () => {
    const first = await (await post(VALID)).json();
    const second = await post(VALID);

    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.duplicate).toBe(true);
    expect(body.id).toBe(first.id);
    expect(openReports()).toHaveLength(1);
  });
});

/*
 * Adversarial test 1 — the client's validation is provably not trusted.
 */
describe("the client's claims about the record are ignored (test 1)", () => {
  it("rejects a proposed value equal to the REAL current value, whatever currentValue claims", async () => {
    const res = await post({
      ...VALID,
      // What the record actually says. The client asserts otherwise, hoping
      // the "must differ from currentValue" rule is evaluated against its
      // own claim rather than against the record.
      proposedValue: "Sunil Perera",
      currentValue: "A Completely Different Name",
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-request");
    expect(openReports()).toHaveLength(0);
  });

  it("ignores a client-supplied id, submittedAt, reviewStatus, reviewedAt and reviewer", async () => {
    const res = await post({
      ...VALID,
      id: "correction-attacker-chosen",
      submittedAt: "1999-01-01T00:00:00.000Z",
      reviewStatus: "published",
      reviewedAt: "1999-01-01T00:00:00.000Z",
      reviewer: "nobody",
      resolution: "approved",
    });
    expect(res.status).toBe(201);

    const row = openReports()[0]!;
    expect(row.id).not.toBe("correction-attacker-chosen");
    expect(row.review_status).toBe("open");
    expect(row.submitted_at).not.toBe("1999-01-01T00:00:00.000Z");
    expect(row.reviewed_at).toBeNull();
    expect(row.reviewer).toBeNull();
    expect(row.resolution).toBeNull();
  });
});

/*
 * Adversarial test 2 — entityId must resolve to a real record.
 */
describe("entityId must name a real record (test 2)", () => {
  it("rejects a well-formed but non-existent entityId", async () => {
    const res = await post({ ...VALID, entityId: "no-such-person" });
    expect(res.status).toBe(400);
    expect(openReports()).toHaveLength(0);
  });

  it("does not reveal whether the id was a slug, an id, or neither", async () => {
    const message = (await (await post({ ...VALID, entityId: "no-such-person" })).json()).message;
    expect(message).not.toContain("no-such-person");
    expect(message).not.toMatch(/SELECT|person WHERE|sqlite/i);
  });
});

/*
 * Adversarial test 3 — the fieldName allowlist is enforced server-side.
 */
describe("fieldName allowlist (test 3)", () => {
  it("rejects a field name that is not on CORRECTION_FIELDS", async () => {
    for (const fieldName of ["is_demonstration", "portrait_rights", "review_status", "", "__proto__"]) {
      const res = await post({ ...VALID, fieldName });
      expect(res.status, `fieldName=${JSON.stringify(fieldName)}`).toBe(400);
    }
    expect(openReports()).toHaveLength(0);
  });

  it("does not echo the rejected field name back into the response", async () => {
    const body = await (await post({ ...VALID, fieldName: "<script>alert(1)</script>" })).json();
    expect(JSON.stringify(body)).not.toContain("<script>");
  });
});

/*
 * Adversarial test 4 — no other endpoint becomes writable through this one.
 */
describe("the write surface is one path and one method (test 4)", () => {
  it("still answers 405 for POST to every other endpoint", async () => {
    for (const path of ["/api/people", "/api/facets", "/api/status", "/api/people/sunil-perera", "/health"]) {
      const res = await post(VALID, path);
      expect(res.status, path).toBe(405);
    }
  });

  it("answers 405 for PUT, PATCH and DELETE on the corrections path itself", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${base}/api/corrections`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID),
      });
      expect(res.status, method).toBe(405);
    }
  });

  it("ignores X-HTTP-Method-Override — a GET stays a GET", async () => {
    const res = await fetch(`${base}/api/corrections`, {
      method: "GET",
      headers: { "x-http-method-override": "POST" },
    });
    // Routed as the GET it is: there is no GET /api/corrections, so 404 —
    // never a write, and never the 201 an override-honouring server would give.
    expect(res.status).toBe(404);
    expect(openReports()).toHaveLength(0);
  });

  it("ignores X-Original-URL and X-Rewrite-URL when deciding the write path", async () => {
    const res = await fetch(`${base}/api/people`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-original-url": "/api/corrections",
        "x-rewrite-url": "/api/corrections",
      },
      body: JSON.stringify(VALID),
    });
    expect(res.status).toBe(405);
    expect(openReports()).toHaveLength(0);
  });

  it("matches the path exactly — a lookalike does not reach the write path", async () => {
    for (const path of ["/api/corrections/extra", "/api/Corrections", "/api/corrections2"]) {
      const res = await post(VALID, path);
      expect(res.status, path).toBe(405);
    }
    expect(openReports()).toHaveLength(0);
  });

  it("accepts the path with a trailing slash or a query string, same as the read router normalises", async () => {
    expect((await post(VALID, "/api/corrections/")).status).toBe(201);
    // The same report again — answered as a duplicate, still not a second row.
    expect((await post(VALID, "/api/corrections?utm_source=x")).status).toBe(200);
    expect(openReports()).toHaveLength(1);
  });
});

/*
 * Adversarial test 5 — hostile-shaped input is inert data or rejected.
 */
describe("injection- and XSS-shaped input (test 5)", () => {
  const CORPUS = [
    "' OR 1=1--",
    "'; DROP TABLE person;--",
    "<script>alert(1)</script>",
    "../../etc/passwd",
    "${jndi:ldap://x/y}",
  ];

  it("stores hostile strings verbatim as data, changing nothing else", async () => {
    for (const [i, hostile] of CORPUS.entries()) {
      const res = await post({
        ...VALID,
        proposedValue: hostile,
        explanation: hostile,
        supportingSourceUrl: `https://www.parliament.lk/en/members/${i}`,
      });
      expect(res.status, hostile).toBe(201);
    }

    // The table the corpus tried to drop is still there, with its row.
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM person")!.n).toBe(1);
    const stored = openReports().map((r) => r.proposed_value);
    expect(stored).toEqual(CORPUS);
  });

  it("rejects a non-http(s) source URL, including javascript: and data:", async () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "https://www.parliament.lk",
      "https://www.parliament.lk/",
      "not a url",
    ]) {
      const res = await post({ ...VALID, supportingSourceUrl: url });
      expect(res.status, url).toBe(400);
    }
    expect(openReports()).toHaveLength(0);
  });

  it("never reflects an error message containing a stack trace or SQL", async () => {
    const body = await (await post({ ...VALID, entityId: 42 })).json();
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/at .*\.ts:\d+/);
    expect(serialised).not.toMatch(/SELECT|INSERT INTO|sqlite/i);
  });
});

/*
 * Body handling — the cap is enforced while reading, before JSON.parse.
 */
describe("request body handling", () => {
  it("rejects a body over the cap with 413 and stores nothing", async () => {
    const res = await post({ ...VALID, explanation: "x".repeat(20_000) });
    expect(res.status).toBe(413);
    expect(openReports()).toHaveLength(0);
  });

  it("rejects an over-long field that is under the body cap with 400, never truncating it", async () => {
    const res = await post({ ...VALID, proposedValue: "x".repeat(600) });
    expect(res.status).toBe(400);
    expect(openReports()).toHaveLength(0);
  });

  it("rejects a non-JSON content type", async () => {
    const res = await fetch(`${base}/api/corrections`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(VALID),
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON without echoing it back", async () => {
    const res = await post("{ not json at all");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("not json at all");
  });

  it("rejects a JSON array or a bare string, not only a malformed object", async () => {
    for (const body of [JSON.stringify([VALID]), JSON.stringify("hello"), JSON.stringify(null)]) {
      expect((await post(body)).status).toBe(400);
    }
  });
});

/*
 * Adversarial test 8 — no volume of submissions auto-approves anything.
 */
describe("nothing reaches a decided state without a human (test 8)", () => {
  it("files every report as 'open', however many arrive", async () => {
    for (let i = 0; i < 5; i++) {
      await post({ ...VALID, proposedValue: `Sunil Perera ${i}` });
    }
    const rows = openReports();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.review_status === "open")).toBe(true);
    expect(rows.every((r) => r.reviewed_at === null && r.reviewer === null)).toBe(true);
  });

  it("cannot write a decided state at all — the schema CHECK refuses it", () => {
    // The endpoint never tries this; the point is that the constraint the
    // design leans on is real, not that the code is polite about it.
    expect(() =>
      db.run(
        `INSERT INTO correction_report (id, entity_type, entity_id, field_name, proposed_value,
           supporting_source_url, submitted_at, review_status)
         VALUES ('x','person','person-1','canonicalName','X','https://a.lk/b','2026-01-01','published')`,
      ),
    ).toThrow();
  });

  it("touches no canonical table", async () => {
    const before = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM person")!.n;
    const nameBefore = db.get<{ canonical_name: string }>("SELECT canonical_name FROM person WHERE id='person-1'")!;

    await post(VALID);

    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM person")!.n).toBe(before);
    expect(db.get<{ canonical_name: string }>("SELECT canonical_name FROM person WHERE id='person-1'")!.canonical_name)
      .toBe(nameBefore.canonical_name);
  });
});

/*
 * Adversarial test 6 — rate limiting actually rejects.
 */
describe("rate limiting (test 6)", () => {
  /** A second server with its own limits and its own bucket state. */
  async function startLimited(env: Record<string, string>) {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    // A fresh module instance, so the bucket maps start empty and read the
    // env vars above — the same technique server.test.ts uses.
    vi.resetModules();
    const { createApiServer: createLimited } = await import("./server.ts");
    const limited = createLimited(store, toQueryable(db), openCorrectionIntake(db));
    await new Promise<void>((resolve) => limited.listen(0, resolve));
    const limitedBase = `http://127.0.0.1:${(limited.address() as AddressInfo).port}`;
    return {
      base: limitedBase,
      async stop() {
        await new Promise((resolve) => limited.close(resolve));
        process.env = previous;
      },
    };
  }

  it("rejects past the per-IP ceiling with 429 and a retry-after", async () => {
    const { base: limitedBase, stop } = await startLimited({ API_CORRECTION_RATE_LIMIT_MAX: "2" });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`${limitedBase}/api/corrections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...VALID, proposedValue: `Sunil Perera ${i}` }),
        });
        statuses.push(res.status);
        if (res.status === 429) expect(res.headers.get("retry-after")).toBeTruthy();
      }
      expect(statuses.slice(0, 2)).toEqual([201, 201]);
      expect(statuses.slice(2)).toEqual([429, 429]);
      // The rejected two were never stored.
      expect(openReports()).toHaveLength(2);
    } finally {
      await stop();
    }
  });

  it("a forged X-Forwarded-For from an untrusted socket does not buy a fresh budget", async () => {
    const { base: limitedBase, stop } = await startLimited({ API_CORRECTION_RATE_LIMIT_MAX: "1" });
    try {
      const first = await fetch(`${limitedBase}/api/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID),
      });
      expect(first.status).toBe(201);

      // A different forged address each time. Because the socket is not a
      // trusted proxy (JAVORA_TRUSTED_PROXIES unset), the header is ignored
      // and every one of these is still the same client.
      for (const forged of ["9.9.9.9", "10.0.0.1", "203.0.113.7"]) {
        const res = await fetch(`${limitedBase}/api/corrections`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": forged },
          body: JSON.stringify({ ...VALID, proposedValue: `Name ${forged}` }),
        });
        expect(res.status, forged).toBe(429);
      }
    } finally {
      await stop();
    }
  });

  it("enforces a site-wide ceiling a per-IP limit alone would not catch", async () => {
    const { base: limitedBase, stop } = await startLimited({
      API_CORRECTION_RATE_LIMIT_MAX: "1000",
      API_CORRECTION_GLOBAL_RATE_LIMIT_MAX: "2",
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`${limitedBase}/api/corrections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...VALID, proposedValue: `Global ${i}` }),
        });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([201, 201, 429, 429]);
    } finally {
      await stop();
    }
  });

  it("rejects before reading the body, so an oversized flood costs nothing to refuse", async () => {
    const { base: limitedBase, stop } = await startLimited({ API_CORRECTION_RATE_LIMIT_MAX: "1" });
    try {
      await fetch(`${limitedBase}/api/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID),
      });
      // Over the body cap AND over the rate limit: the rate limit wins,
      // which is the ordering that means the server never buffers it.
      const res = await fetch(`${limitedBase}/api/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID, explanation: "x".repeat(20_000) }),
      });
      expect(res.status).toBe(429);
    } finally {
      await stop();
    }
  });
});

/*
 * The deployment that cannot accept reports says so, rather than dropping them.
 */
describe("no intake configured", () => {
  it("answers 503 corrections-unavailable, never a false 201", async () => {
    const noIntake = createApiServer(store, toQueryable(db), null);
    await new Promise<void>((resolve) => noIntake.listen(0, resolve));
    const noIntakeBase = `http://127.0.0.1:${(noIntake.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${noIntakeBase}/api/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("corrections-unavailable");
      expect(openReports()).toHaveLength(0);
    } finally {
      await new Promise((resolve) => noIntake.close(resolve));
    }
  });
});

/*
 * CORS — the preflight advertises POST only where POST exists.
 */
describe("CORS preflight", () => {
  it("advertises POST for the corrections path and not for a read endpoint", async () => {
    const [corrections, people] = await Promise.all([
      fetch(`${base}/api/corrections`, { method: "OPTIONS" }),
      fetch(`${base}/api/people`, { method: "OPTIONS" }),
    ]);
    expect(corrections.headers.get("access-control-allow-methods")).toContain("POST");
    expect(people.headers.get("access-control-allow-methods")).not.toContain("POST");
  });
});
