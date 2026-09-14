/**
 * Javora — engine-neutral migration file handling.
 *
 * server/db/database.ts (SQLite, synchronous) and server/db/postgres.ts
 * (PostgreSQL, async) each independently computed the same MIGRATIONS_DIR,
 * split SQL into statements with the same logic, and read the same directory
 * listing in the same order. That duplication is a schema-drift risk
 * specific to migrations: if the two statement-splitting implementations
 * ever disagreed — say, on a DDL file that needed a smarter split — the two
 * engines could apply a different set of statements from the identical
 * source file.
 *
 * WHAT STAYS SEPARATE, deliberately. `database.ts`'s `migrate()` runs
 * synchronously inside one `db.transaction(() => ...)` per file; postgres.ts's
 * `migratePostgres()` is async, awaiting each statement inside
 * `db.transaction(async (scoped) => ...)`. Those two execution shapes are not
 * merged here — only the file discovery and statement splitting they both
 * need first.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where migration SQL files live. Both engines read from this one place. */
export const MIGRATIONS_DIR = join(HERE, "migrations");

export interface MigrationFile {
  /** Filename only, e.g. "001_initial.sql" — also the schema_migrations key. */
  file: string;
  sql: string;
}

/** Every migration file, in filename order, with its content already read. */
export function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

/**
 * Split migration SQL into individual statements.
 *
 * Splits on semicolons at end of line: enough for this DDL, which contains no
 * procedural bodies or dollar-quoted strings. Comment lines (starting with
 * `--`, ignoring leading whitespace) are stripped first so a semicolon inside
 * a comment cannot be mistaken for a statement terminator.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
