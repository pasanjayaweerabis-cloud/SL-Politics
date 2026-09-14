/**
 * Javora — provision the least-privilege PostgreSQL roles (M-6).
 *
 * `.env.production.example` has documented the SELECT-only `javora_api` role
 * SECURITY--SL Politics.md §3.2 recommends since the F3 remediation
 * (docs/security-audit.md §7) — but documenting a role is not provisioning
 * one, and nothing in this repository could create it without a real
 * Postgres server to run against. This script is that provisioning step.
 *
 * TWO ROLES, MATCHING §3.2's MODEL:
 *
 *   javora_api      SELECT only. What DATABASE_URL in .env.production.example
 *                    should name — the credential server/api/server.ts's
 *                    Postgres path actually connects with. Its own startup
 *                    self-check (assertReadOnlyPostgresCredential in
 *                    server/api/server.ts) refuses to run against a
 *                    credential that can write, so provisioning this role
 *                    correctly is what lets the API start at all once
 *                    DATABASE_URL is pointed at it.
 *
 *   javora_migrate   SELECT/INSERT/UPDATE/DELETE plus schema CREATE — what
 *                    scripts/migrate-to-postgres.mjs (and any future
 *                    Postgres-targeting migration path) should run as.
 *                    Never used by the running API.
 *
 * IDEMPOTENT. Safe to re-run: a role that already exists is left alone
 * (including its password — this script never resets one, so re-running it
 * cannot silently rotate a credential something else depends on), and every
 * GRANT / ALTER DEFAULT PRIVILEGES statement below is naturally idempotent.
 *
 * Usage — run with an ADMIN/owner connection, never the app's own:
 *
 *   DATABASE_URL=postgres://<admin>@host:5432/javora \
 *   JAVORA_API_ROLE_PASSWORD=<generate one yourself> \
 *   JAVORA_MIGRATE_ROLE_PASSWORD=<generate one yourself> \
 *   node scripts/provision-postgres-roles.mjs
 *
 * This script deliberately never generates or prints a password — supply
 * both yourself (e.g. `openssl rand -base64 24`) so neither ever appears in
 * this process's own stdout.
 */

import pg from "pg";

/**
 * Postgres has no bind-parameter support for identifiers (role/database/
 * schema names) in DDL — only for values. Validating against a strict
 * pattern before interpolating is the same approach
 * scripts/migrate-to-postgres.mjs already takes for table names read from
 * the migration files' own schema, and is safe here for the same reason:
 * these names come from environment variables an operator sets when
 * invoking this script by hand, never from a web request.
 */
export function identifier(name, label) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to use "${name}" as a ${label} — must be lowercase, start with a letter or underscore`);
  }
  return name;
}

/** Standard SQL string-literal escaping (double any embedded quote). */
export function literal(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureRole(client, roleName, password) {
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);
  if (existing.rowCount > 0) {
    console.log(`  role ${roleName} already exists — leaving it (and its password) untouched`);
    return;
  }
  await client.query(`CREATE ROLE ${identifier(roleName, "role name")} LOGIN PASSWORD ${literal(password)}`);
  console.log(`  created role ${roleName}`);
}

async function grantReadOnly(client, roleName, dbName) {
  const role = identifier(roleName, "role name");
  await client.query(`GRANT CONNECT ON DATABASE ${identifier(dbName, "database name")} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role}`);
  console.log(`  granted SELECT-only on database ${dbName}, schema public, to ${roleName}`);
}

async function grantWrite(client, roleName, dbName) {
  const role = identifier(roleName, "role name");
  await client.query(`GRANT CONNECT ON DATABASE ${identifier(dbName, "database name")} TO ${role}`);
  // CREATE, not just USAGE: this role runs migratePostgres() (server/db/
  // postgres.ts), which issues CREATE TABLE/CREATE INDEX for new migrations.
  await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  );
  console.log(`  granted SELECT/INSERT/UPDATE/DELETE + schema CREATE on database ${dbName} to ${roleName}`);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  const API_ROLE = process.env.JAVORA_API_ROLE ?? "javora_api";
  const API_PASSWORD = process.env.JAVORA_API_ROLE_PASSWORD;
  const MIGRATE_ROLE = process.env.JAVORA_MIGRATE_ROLE ?? "javora_migrate";
  const MIGRATE_PASSWORD = process.env.JAVORA_MIGRATE_ROLE_PASSWORD;

  if (!DATABASE_URL) {
    console.error(
      "provision-postgres-roles: DATABASE_URL is not set.\n" +
        "  Run this with an ADMIN/owner connection string — not the read-only\n" +
        "  javora_api credential this script exists to create.",
    );
    process.exit(1);
  }
  if (!API_PASSWORD || !MIGRATE_PASSWORD) {
    console.error(
      "provision-postgres-roles: set JAVORA_API_ROLE_PASSWORD and JAVORA_MIGRATE_ROLE_PASSWORD.\n" +
        "  This script never generates or prints a password itself.",
    );
    process.exit(1);
  }

  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!dbName) throw new Error("DATABASE_URL has no database name in its path");

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log(`database: ${dbName}`);

    console.log(`\n${API_ROLE} (read-only, for the running API):`);
    await ensureRole(client, API_ROLE, API_PASSWORD);
    await grantReadOnly(client, API_ROLE, dbName);

    console.log(`\n${MIGRATE_ROLE} (read/write, for migrations only):`);
    await ensureRole(client, MIGRATE_ROLE, MIGRATE_PASSWORD);
    await grantWrite(client, MIGRATE_ROLE, dbName);

    console.log(
      `\ndone. Point DATABASE_URL at ${API_ROLE} for the running API (server/api/server.ts refuses to\n` +
        `start against a write-capable credential — see assertReadOnlyPostgresCredential), and run\n` +
        `scripts/migrate-to-postgres.mjs / any future migration path as ${MIGRATE_ROLE} instead.`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

// Started directly (`node scripts/provision-postgres-roles.mjs`) rather than
// imported — importing this module (e.g. from its test file) exercises only
// the pure identifier()/literal() exports above, never main()'s side effects.
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("provision-postgres-roles.mjs")
) {
  main().catch((error) => {
    console.error("\nprovision-postgres-roles: FAILED.");
    console.error(error);
    process.exit(1);
  });
}
