/**
 * Javora — PostgreSQL connection handling.
 *
 * SCOPE OF THIS FILE. This is a real, working, tested Postgres backend — not a
 * placeholder. It applies the exact migration SQL in `server/db/migrations/`
 * (proven portable, zero SQLite-specific syntax) against a real PostgreSQL
 * server, and `scripts/migrate-to-postgres.mjs` / `scripts/validate-postgres-
 * migration.mjs` exercise it end to end.
 *
 * WHAT IS WIRED, AND WHAT IS NOT. `server/db/database.ts`'s `Database`
 * interface is synchronous, because it was built around `node:sqlite`, which
 * is synchronous. PostgreSQL access is inherently asynchronous — there is no
 * production-grade synchronous Postgres client for Node — so this module
 * exports an ASYNC interface with the same shape rather than a drop-in
 * replacement for `openDatabase()`.
 *
 * `server/api/queries.ts` (five read endpoints: health, people, a single
 * person, search, facets) was rewritten to that async shape and IS wired to
 * this module — see `server/api/server.ts`'s `openQueryBackend()`, which uses
 * Postgres for those endpoints whenever `DATABASE_URL` is set. That path has
 * run live against a real PostgreSQL server with the full 226-person dataset.
 *
 * Everything else has NOT been converted: `CanonicalStore` (54 methods,
 * server/db/store.ts) — the sync worker's and CLI's write path, and also what
 * `/api/status`, `/api/sources` and `/api/government/current` still read —
 * remains synchronous/SQLite-only, along with server/sync/syncSource.ts,
 * server/sync/reconcile.ts and server/sync/authority.ts. That is real,
 * substantial, mechanical-but-pervasive work (CanonicalStore plus its
 * remaining callers), not something to rush through silently inside an
 * already-large change. It is called out explicitly as the standing risk
 * rather than done partially here.
 *
 * THE QUERY TRANSLATOR below is what makes the rest of this honest: it lets
 * every existing SQL string — written with SQLite's `?` positional or
 * `:name` named placeholders — run against Postgres UNCHANGED, by rewriting
 * placeholders to `$1, $2, …` and building the positional argument array at
 * the point of execution. Not one query string in store.ts, queries.ts or the
 * migrations had to be rewritten for this module to work.
 */

import pg from "pg";
import { readMigrations, splitStatements } from "./migrationFiles.ts";

export type Params = unknown[] | Record<string, unknown>;

/** The asynchronous counterpart of `Database` in `database.ts`. */
export interface AsyncDatabase {
  run(sql: string, params?: Params): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T | null>;
  /**
   * Runs `fn` inside BEGIN/COMMIT (ROLLBACK on throw), passing the database
   * scoped to the ONE connection the transaction is on. Calling `db.run(...)`
   * instead of `scoped.run(...)` inside `fn` would silently borrow a second,
   * non-transactional pool connection — so `fn` receives `scoped` explicitly
   * rather than relying on callers to close over the right value.
   */
  transaction<T>(fn: (scoped: AsyncDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Rewrite SQLite-style placeholders to Postgres's `$1, $2, …` and produce the
 * matching positional argument array.
 *
 * Two input shapes, matching how the rest of the codebase already calls
 * `Database.run/all/get`:
 *
 *   - an array with `?` placeholders, bound in order;
 *   - a plain object with `:name` placeholders, which may repeat — the same
 *     `:person_id` used twice in one query must become the same `$n` twice,
 *     since Postgres numbers arguments, not names.
 *
 * A `?` inside a quoted SQL string literal would be misread as a placeholder,
 * but nothing in this codebase's SQL puts a bare `?` inside a string literal
 * (verified: `server/db/migrations/*.sql`, `server/db/store.ts`,
 * `server/api/queries.ts` contain none), so the naive replace is safe for the
 * SQL this project actually writes without carrying a full SQL tokenizer for
 * a case that cannot occur.
 */
export function toPositional(sql: string, params: Params = []): { text: string; values: unknown[] } {
  if (Array.isArray(params)) {
    let index = 0;
    const text = sql.replace(/\?/g, () => `$${++index}`);
    return { text, values: params };
  }

  const order: string[] = [];
  const text = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
    let position = order.indexOf(name);
    if (position === -1) {
      position = order.length;
      order.push(name);
    }
    return `$${position + 1}`;
  });

  return { text, values: order.map((name) => params[name]) };
}

/**
 * Open a PostgreSQL-backed database.
 *
 * A pool is used for ordinary queries so concurrent reads (the API) do not
 * serialise behind each other. `transaction()` checks out one dedicated
 * client for its duration — a Postgres transaction is a property of a single
 * connection, not of the pool — and releases it afterwards even on error.
 */
export function openPostgres(connectionString: string): AsyncDatabase {
  const pool = new pg.Pool({ connectionString });

  // Every write in this project goes through explicit transactions or single
  // statements; nothing depends on session-local temp state between calls, so
  // ordinary run/all/get can each borrow any pool connection.
  return {
    async run(sql, params = []) {
      const { text, values } = toPositional(sql, params);
      await pool.query(text, values as unknown[]);
    },

    async all<T>(sql: string, params: Params = []) {
      const { text, values } = toPositional(sql, params);
      const result = await pool.query(text, values as unknown[]);
      return result.rows as T[];
    },

    async get<T>(sql: string, params: Params = []) {
      const { text, values } = toPositional(sql, params);
      const result = await pool.query(text, values as unknown[]);
      return (result.rows[0] ?? null) as T | null;
    },

    async transaction<T>(fn: (scoped: AsyncDatabase) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(clientAsDatabase(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}

function clientAsDatabase(client: pg.PoolClient): AsyncDatabase {
  return {
    async run(sql, params = []) {
      const { text, values } = toPositional(sql, params);
      await client.query(text, values as unknown[]);
    },
    async all<T>(sql: string, params: Params = []) {
      const { text, values } = toPositional(sql, params);
      const result = await client.query(text, values as unknown[]);
      return result.rows as T[];
    },
    async get<T>(sql: string, params: Params = []) {
      const { text, values } = toPositional(sql, params);
      const result = await client.query(text, values as unknown[]);
      return (result.rows[0] ?? null) as T | null;
    },
    transaction<T>(fn: (scoped: AsyncDatabase) => Promise<T>): Promise<T> {
      // Postgres has no nested transactions without SAVEPOINT; nothing here
      // needs one, so a nested call just joins the already-open transaction
      // on the same client rather than opening a second one.
      return fn(this);
    },
    async close() {
      // The pool owns the client's lifecycle; a scoped view never closes it.
    },
  };
}

/* ==========================================================================
   Migrations
   ========================================================================== */

/**
 * Apply every migration that has not run yet, in filename order.
 *
 * The SAME files `server/db/database.ts` applies to SQLite — proven portable
 * by running unchanged here, not merely commented as intended to be.
 */
export async function migratePostgres(db: AsyncDatabase, { silent = false } = {}): Promise<string[]> {
  await db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = await db.all<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.name));

  const ran: string[] = [];
  for (const { file, sql } of readMigrations()) {
    if (applied.has(file)) continue;

    await db.transaction(async (scoped) => {
      for (const statement of splitStatements(sql)) {
        await scoped.run(statement);
      }
      await scoped.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [
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
export async function openMigratedPostgres(connectionString: string): Promise<AsyncDatabase> {
  const db = openPostgres(connectionString);
  await migratePostgres(db, { silent: true });
  return db;
}
