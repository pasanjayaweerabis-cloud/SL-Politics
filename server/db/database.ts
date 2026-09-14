/**
 * Javora — database connection and migrations.
 *
 * WHICH ENGINE, AND WHY
 *
 * PostgreSQL is the production target. It is not what runs here: this
 * environment has no PostgreSQL server, no client binaries, and a Docker
 * daemon that is not running, so a Postgres-only implementation would be an
 * untested file rather than a working database.
 *
 * So the store runs on `node:sqlite` — built into Node 24, no dependency to
 * install, and a genuine relational engine with foreign keys, CHECK
 * constraints, indexes, transactions and partial indexes. Everything the
 * pipeline claims (idempotent upserts, append-only history, referential
 * integrity) is therefore actually enforced by a database and actually
 * exercised by the tests, rather than asserted in prose.
 *
 * The migration SQL is written to be portable between the two engines (see
 * the header of `migrations/001_initial.sql`), and `DATABASE_URL` is read so
 * a Postgres driver can be slotted in behind the same `Database` interface.
 * To be explicit about the limit of that claim: the Postgres path is NOT
 * exercised here and must not be described as verified until it is run
 * against a real server.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrations, splitStatements } from "./migrationFiles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Default on-disk location; override with JAVORA_DB. */
export const DEFAULT_DB_PATH = resolve(HERE, "../../.data/javora.db");

/**
 * Statement parameters: either positional (`?`) as an array, or named
 * (`:name`) as an object. Both are used — writes bind positionally, the
 * larger read queries bind by name because they reuse values several times.
 */
export type Params = unknown[] | Record<string, unknown>;

export interface Database {
  /** Run a statement that returns no rows. */
  run(sql: string, params?: Params): void;
  /** Run a query and return all rows. */
  all<T = Record<string, unknown>>(sql: string, params?: Params): T[];
  /** Run a query and return the first row, or null. */
  get<T = Record<string, unknown>>(sql: string, params?: Params): T | null;
  /** Execute several statements atomically. Rolls back if `fn` throws. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/**
 * Open the database, creating the file and its directory if needed.
 *
 * `:memory:` is used by tests, which want a fresh database per case without
 * touching the filesystem.
 *
 * `readOnly` opens the connection with SQLite's own read-only mode, so a
 * write attempted through it fails at the engine level (`attempt to write a
 * readonly database`) rather than depending solely on every caller only ever
 * invoking `get`/`all`. The API process uses this: it never writes canonical
 * data — the sync worker and CLI are the only writers — so its connection
 * should not be *able* to, not just be trusted not to. A read-only open
 * cannot create a missing file, so callers must ensure the database already
 * exists (e.g. by migrating with a normal connection first).
 */
export function openDatabase(
  path: string = process.env.JAVORA_DB ?? DEFAULT_DB_PATH,
  options: { readOnly?: boolean } = {},
): Database {
  if (path !== ":memory:" && !options.readOnly) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path, { readOnly: options.readOnly === true });

  // Off by default in SQLite, which would silently let the schema's
  // REFERENCES clauses do nothing at all. A per-connection setting, not
  // persisted to the file, so this is safe on a read-only connection too.
  db.exec("PRAGMA foreign_keys = ON");
  // Write-ahead logging: lets the API read while the sync worker writes,
  // instead of the two blocking each other.
  //
  // NOT on a read-only connection (L-7, scripts/backup-db.mjs). Unlike
  // foreign_keys above, journal_mode is persisted to the file itself, and
  // setting it is a write — a no-op, and so harmless, on a file some earlier
  // read-write open already switched to WAL, but a real write attempt (and
  // therefore a thrown "attempt to write a readonly database") on any file
  // that is not, such as one `VACUUM INTO` just produced, which starts in
  // SQLite's default rollback-journal mode regardless of the source
  // database's own mode. A read-only connection should accept whichever
  // journal mode the file is already in, never try to change it.
  if (path !== ":memory:" && !options.readOnly) db.exec("PRAGMA journal_mode = WAL");

  let depth = 0;

  /**
   * Bind either positional or named parameters.
   *
   * An array spreads into `?` placeholders; a plain object is passed whole
   * for `:name` placeholders. `setAllowBareNamedParameters` lets the object's
   * keys omit the `:` prefix, which keeps the query code readable.
   */
  const bind = (sql: string, params: Params) => {
    const statement = db.prepare(sql);
    if (Array.isArray(params)) return { statement, args: params as never[] };

    statement.setAllowBareNamedParameters(true);

    // Pass only the names this statement actually references. Callers build
    // one parameter bag and reuse it across a COUNT and a SELECT that share
    // most, but not all, of their placeholders — and node:sqlite rejects a
    // named parameter the SQL does not mention. Filtering here keeps that a
    // detail of the driver rather than something every query must track.
    const used = new Set([...sql.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!));
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (used.has(key)) filtered[key] = value;
    }
    return { statement, args: [filtered] as never[] };
  };

  return {
    run(sql, params = []) {
      const { statement, args } = bind(sql, params);
      statement.run(...args);
    },
    all<T>(sql: string, params: Params = []) {
      const { statement, args } = bind(sql, params);
      return statement.all(...args) as T[];
    },
    get<T>(sql: string, params: Params = []) {
      const { statement, args } = bind(sql, params);
      return (statement.get(...args) ?? null) as T | null;
    },
    transaction<T>(fn: () => T): T {
      // Nested calls join the outer transaction rather than starting a second
      // one, which SQLite does not support.
      if (depth > 0) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth--;
      }
    },
    close() {
      db.close();
    },
  };
}

/* ==========================================================================
   Migrations
   ========================================================================== */

/**
 * Apply every migration that has not run yet, in filename order.
 *
 * Tracked in `schema_migrations`, so initialisation is reproducible and
 * re-running is a no-op — nobody should ever be editing tables by hand.
 */
export function migrate(db: Database, { silent = false } = {}): string[] {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.all<{ name: string }>("SELECT name FROM schema_migrations").map((r) => r.name),
  );

  const ran: string[] = [];
  for (const { file, sql } of readMigrations()) {
    if (applied.has(file)) continue;

    db.transaction(() => {
      // Split on semicolons at end of line: enough for this DDL, which
      // contains no procedural bodies or dollar-quoted strings.
      for (const statement of splitStatements(sql)) {
        db.run(statement);
      }
      db.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [
        file,
        new Date().toISOString(),
      ]);
    });

    ran.push(file);
    if (!silent) console.log(`  applied ${file}`);
  }

  return ran;
}

/** Open and migrate in one step. */
export function openMigrated(path?: string): Database {
  const db = openDatabase(path);
  migrate(db, { silent: true });
  return db;
}
