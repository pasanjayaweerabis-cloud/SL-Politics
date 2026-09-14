/**
 * Javora — SQLite → PostgreSQL data migration.
 *
 * Copies every row from the local canonical SQLite database into a
 * PostgreSQL database with the same schema, preserving every id, every
 * timestamp and every relationship exactly as recorded. This is a data copy,
 * not a transformation: no value is regenerated, reformatted or inferred.
 *
 * SAFETY. The whole copy runs inside ONE Postgres transaction. If any row
 * anywhere fails — a constraint violation, a connection drop — everything
 * written so far is rolled back, so the target database is either the
 * complete source or untouched. There is no such thing as a half-migrated
 * Javora database from this script.
 *
 * ORDER. Tables are inserted in dependency order, computed by tableOrder()
 * below — a topological sort over the REFERENCES clauses in the migration
 * files themselves, rather than a hand-maintained list that silently goes
 * stale the day a migration adds a table.
 *
 * IDEMPOTENCE. This loads into an EMPTY schema. Run against a database that
 * already has rows and it refuses, rather than guessing whether to upsert,
 * skip or duplicate — those are different correct behaviours for different
 * situations, and picking one silently risks exactly the data loss this
 * project exists to prevent. Pass --force to truncate first (for repeated
 * test runs against a disposable database, never for a real destination that
 * already holds production data).
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-to-postgres.mjs [--force]
 */

import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openPostgres, migratePostgres } from "../server/db/postgres.ts";
import { readMigrations } from "../server/db/migrationFiles.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SQLITE_PATH = process.env.JAVORA_DB ?? join(ROOT, ".data", "javora.db");
const DATABASE_URL = process.env.DATABASE_URL;
const FORCE = process.argv.includes("--force");

if (!DATABASE_URL) {
  console.error("migrate-to-postgres: DATABASE_URL is not set.");
  process.exit(1);
}

/**
 * Table order, computed from the migration files' own REFERENCES clauses.
 *
 * A parent table always sorts before every table that references it, so
 * inserting in this order can never violate a foreign key. Read directly from
 * the SQL rather than declared by hand, so a schema change cannot silently
 * desynchronise this script from the tables it copies.
 */
function tableOrder() {
  let sql = readMigrations().map((m) => m.sql).join("\n");
  // A dropped-and-recreated table (education, migration 003) must be read from
  // its FINAL definition only; an early DROP has no CREATE body to conflict
  // with, so stripping DROP statements first is enough.
  sql = sql.replace(/DROP TABLE[^;]*;/gi, "");

  const refs = new Map();
  for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+) \(([\s\S]*?)\n\);/g)) {
    const [, name, body] = match;
    const dependencies = new Set();
    for (const ref of body.matchAll(/REFERENCES (\w+)\(/g)) {
      if (ref[1] !== name) dependencies.add(ref[1]);
    }
    refs.set(name, dependencies);
  }

  const order = [];
  const done = new Set();
  function visit(name, stack) {
    if (done.has(name)) return;
    if (stack.has(name)) throw new Error(`circular foreign key involving ${name}`);
    stack.add(name);
    for (const dep of refs.get(name) ?? []) visit(dep, stack);
    done.add(name);
    order.push(name);
  }
  for (const name of refs.keys()) visit(name, new Set());
  return order;
}

/** Column names, in declared order, straight from SQLite's own catalogue. */
function columnsOf(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/*
 * No boolean coercion here. `is_demonstration` and `raw_hash_is_stable` are
 * declared INTEGER in the schema (SQLite has no boolean type, and the
 * migration deliberately never introduced one — see 001_initial.sql), and
 * node:sqlite already returns them as the JS numbers 0/1, which is exactly
 * what an INTEGER column expects on the Postgres side too. Converting them to
 * JS `true`/`false` here was tried and is wrong: it sends `pg` a boolean
 * literal against an integer column and Postgres rejects it outright
 * (`invalid input syntax for type integer: "false"`).
 */

async function main() {
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const order = tableOrder();

  console.log(`source : ${SQLITE_PATH}`);
  console.log(`target : ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
  console.log(`tables : ${order.length}, in dependency order`);

  const db = openPostgres(DATABASE_URL);
  await migratePostgres(db);

  const existing = await db.get("SELECT COUNT(*) AS n FROM person");
  if (Number(existing.n) > 0 && !FORCE) {
    console.error(
      `\nmigrate-to-postgres: target already has ${existing.n} row(s) in "person".\n` +
        "  Refusing to guess whether to upsert, skip or duplicate.\n" +
        "  Pass --force to truncate the target first (test databases only).",
    );
    await db.close();
    sqlite.close();
    process.exit(1);
  }

  const report = [];

  await db.transaction(async (scoped) => {
    if (FORCE) {
      // Truncate in REVERSE dependency order so no FK is briefly violated,
      // and RESTART IDENTITY/CASCADE is unnecessary — every id is
      // application-generated TEXT, never a sequence.
      for (const table of [...order].reverse()) {
        await scoped.run(`DELETE FROM ${table}`);
      }
    }

    for (const table of order) {
      const columns = columnsOf(sqlite, table);
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();

      if (rows.length === 0) {
        report.push({ table, rows: 0 });
        continue;
      }

      // Batched multi-row INSERT rather than one round trip per row — table
      // sizes here run into the hundreds, and one statement per row would
      // mean hundreds of network round trips for no benefit.
      const BATCH = 500;
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const values = [];
        const tuples = batch.map((row, i) => {
          const placeholders = columns.map((col) => {
            values.push(row[col]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(",")})`;
        });

        await scoped.run(
          `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}`,
          values,
        );
      }

      report.push({ table, rows: rows.length });
    }
  });

  sqlite.close();
  await db.close();

  console.log("\ncopied:");
  for (const { table, rows } of report) {
    console.log(`  ${String(rows).padStart(6)}  ${table}`);
  }
  console.log(`\ntotal rows copied: ${report.reduce((sum, r) => sum + r.rows, 0)}`);
  console.log("migration committed in a single transaction — all tables, or none.");
}

main().catch((error) => {
  console.error("\nmigrate-to-postgres: FAILED — transaction rolled back, target unchanged.");
  console.error(error);
  process.exit(1);
});
