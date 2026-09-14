import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate } from "../server/db/database.ts";
import { CanonicalStore } from "../server/db/store.ts";
import { runBackup } from "./backup-db.mjs";

/**
 * Javora — scripts/backup-db.mjs (L-7, SECURITY--SL Politics.md §24).
 *
 * The one property that actually matters for a backup: opening it later
 * reports the same data the source had at backup time. VACUUM INTO is
 * SQLite's own consistent-copy mechanism (see backup-db.mjs's header for why
 * a plain filesystem copy of a WAL-mode database is not equivalent), so this
 * exercises it against a real seeded database rather than an empty one.
 */
describe("runBackup", () => {
  let dir;
  let sourcePath;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "javora-backup-test-"));
    sourcePath = join(dir, "javora.db");

    const db = openDatabase(sourcePath);
    migrate(db, { silent: true });
    const store = new CanonicalStore(db);
    store.upsertSource({
      id: "S001", name: "Parliament", institution: "Parliament of Sri Lanka",
      sourceType: "legislature", category: "Official directory", url: "https://www.parliament.lk/",
    });
    store.upsertParty({ id: "test-party", name: "Test Party", abbreviation: "TP" });
    store.upsertPerson({ id: "person-1", slug: "person-1", canonicalName: "Test Person" });
    db.close();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces a backup file that opens and reports the same row counts as the source", () => {
    const outDir = join(dir, "backups");
    const result = runBackup({ sourcePath, outDir });

    expect(existsSync(result.destPath)).toBe(true);
    expect(result.backupBytes).toBeGreaterThan(0);

    const backup = openDatabase(result.destPath, { readOnly: true });
    try {
      expect(backup.get("SELECT COUNT(*) AS n FROM person")?.n).toBe(1);
      expect(backup.get("SELECT COUNT(*) AS n FROM party")?.n).toBe(1);
      expect(backup.get("SELECT COUNT(*) AS n FROM source")?.n).toBe(1);
      expect(backup.get("SELECT canonical_name FROM person WHERE id='person-1'")?.canonical_name)
        .toBe("Test Person");
    } finally {
      backup.close();
    }
  });

  it("writes into the given --out-dir, named with the javora-<timestamp>[-label].db convention", () => {
    const outDir = join(dir, "labelled-backups");
    const result = runBackup({ sourcePath, outDir, label: "pre-migration" });

    expect(result.destPath.startsWith(outDir)).toBe(true);
    expect(result.destPath).toMatch(/javora-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-pre-migration\.db$/);
  });

  it("the backup is genuinely a separate file — writable independently of the source", () => {
    // A VACUUM INTO copy that were somehow still just a reference to the same
    // file would make this a no-op; confirm it is a real, independent write
    // target by opening it read-write and adding a row.
    const outDir = join(dir, "independence-check");
    const result = runBackup({ sourcePath, outDir });

    const backup = openDatabase(result.destPath);
    try {
      backup.run(
        "INSERT INTO party (id, name, abbreviation, created_at, updated_at) VALUES (?,?,?,?,?)",
        ["another-party", "Another Party", "AP", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
      );
      expect(backup.get("SELECT COUNT(*) AS n FROM party")?.n).toBe(2);
    } finally {
      backup.close();
    }

    // The SOURCE is unaffected by the write made to its backup copy.
    const source = openDatabase(sourcePath, { readOnly: true });
    try {
      expect(source.get("SELECT COUNT(*) AS n FROM party")?.n).toBe(1);
    } finally {
      source.close();
    }
  });

  it("throws a clear error rather than silently producing nothing when the source does not exist", () => {
    expect(() => runBackup({ sourcePath: join(dir, "does-not-exist.db"), outDir: join(dir, "x") }))
      .toThrow(/does not exist/);
  });
});
