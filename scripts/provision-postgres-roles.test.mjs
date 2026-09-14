import { describe, it, expect } from "vitest";
import { identifier, literal } from "./provision-postgres-roles.mjs";

/**
 * Javora — scripts/provision-postgres-roles.mjs (M-6).
 *
 * This only exercises the two pure helpers. The rest of the script (role
 * creation, GRANT/ALTER DEFAULT PRIVILEGES) needs a real PostgreSQL server —
 * none exists in this environment (server/db/database.ts's own header
 * explains why SQLite is what actually runs here) — so it is verified by
 * source review and by the guard-clause behaviour (DATABASE_URL/password
 * env vars missing → exit 1, checked by hand), not by an automated test.
 * Importing this module for these two exports triggers none of main()'s
 * side effects — see the `import.meta.url` guard at the bottom of the file.
 */

describe("identifier", () => {
  it("accepts a lowercase, underscore-led role/database name", () => {
    expect(identifier("javora_api", "role name")).toBe("javora_api");
    expect(identifier("_leading_underscore", "role name")).toBe("_leading_underscore");
  });

  it("rejects anything that is not a plain lowercase identifier", () => {
    // Postgres identifiers cannot be bound as SQL parameters, so this
    // allowlist is the only thing standing between an env-var-supplied role
    // name and a DDL statement — it must reject, not sanitise, anything
    // that could break out of the identifier position.
    for (const bad of ["Javora_Api", "javora-api", "javora api", "javora;DROP TABLE person;--", "1javora", "javora'"]) {
      expect(() => identifier(bad, "role name")).toThrow(/refusing to use/);
    }
  });
});

describe("literal", () => {
  it("wraps a plain value in single quotes", () => {
    expect(literal("hunter2")).toBe("'hunter2'");
  });

  it("escapes an embedded single quote by doubling it, rather than letting it close the literal early", () => {
    expect(literal("pass'word")).toBe("'pass''word'");
  });
});
