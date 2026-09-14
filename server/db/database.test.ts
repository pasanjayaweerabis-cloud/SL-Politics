import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate } from "./database.ts";

/**
 * Javora — read-only database connections (F3).
 *
 * server/api/server.ts opens the API's connection with `readOnly: true` so a
 * write attempted through it fails at the SQLite engine level, rather than
 * depending solely on `server/api/queries.ts` only ever calling `get`/`all`.
 * Before this existed, the API held the exact same read-write handle the sync
 * worker and CLI use to write canonical data — nothing at the connection
 * itself stopped a future bug from writing through it.
 */
describe("openDatabase readOnly option", () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "javora-readonly-test-"));
    dbPath = join(dir, "test.db");
    // A read-only connection cannot create the file — migrate with a normal
    // one first, exactly as server.ts's startApi() does.
    const rw = openDatabase(dbPath);
    migrate(rw, { silent: true });
    rw.close();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("still answers reads", () => {
    const ro = openDatabase(dbPath, { readOnly: true });
    const row = ro.get<{ n: number }>("SELECT COUNT(*) AS n FROM person");
    expect(row?.n).toBe(0);
    ro.close();
  });

  it("rejects a write with an engine-level error, not a silent no-op", () => {
    const ro = openDatabase(dbPath, { readOnly: true });
    expect(() => ro.run("INSERT INTO party (id, name, abbreviation, created_at, updated_at) VALUES (?,?,?,?,?)", [
      "test-party", "Test Party", "TP", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
    ])).toThrow(/readonly/i);
    ro.close();
  });

  it("a write through a genuinely read-only connection never reaches the file", () => {
    const ro = openDatabase(dbPath, { readOnly: true });
    try {
      ro.run("INSERT INTO party (id, name, abbreviation, created_at, updated_at) VALUES (?,?,?,?,?)", [
        "test-party", "Test Party", "TP", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
      ]);
    } catch {
      // Expected — asserted above; this test checks the row genuinely never landed.
    }
    ro.close();

    const rw = openDatabase(dbPath);
    expect(rw.get<{ n: number }>("SELECT COUNT(*) AS n FROM party")?.n).toBe(0);
    rw.close();
  });

  /*
   * L-7 (docs/security-audit-followup-2026-09-04.md, via scripts/backup-
   * db.mjs). openDatabase(path, { readOnly: true }) used to unconditionally
   * try `PRAGMA journal_mode = WAL` — a no-op, and so harmless, on a file an
   * earlier read-write open already switched to WAL (every case the existing
   * tests above exercise), but a genuine write attempt — and therefore a
   * thrown "attempt to write a readonly database" — on any file that starts
   * in SQLite's default (non-WAL) journal mode, such as one `VACUUM INTO`
   * produces. Reproduced directly here without going through backup-db.mjs,
   * against a file this test creates via VACUUM INTO itself.
   */
  it("opens read-only a database file that is NOT already in WAL mode (e.g. one VACUUM INTO produced)", () => {
    const vacuumedPath = join(dir, "vacuumed.db");
    const rw = openDatabase(dbPath);
    rw.run(`VACUUM INTO '${vacuumedPath.replace(/'/g, "''")}'`);
    rw.close();

    const ro = openDatabase(vacuumedPath, { readOnly: true });
    expect(ro.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).not.toBe("wal");
    expect(ro.get<{ n: number }>("SELECT COUNT(*) AS n FROM person")?.n).toBe(0);
    ro.close();
  });
});
