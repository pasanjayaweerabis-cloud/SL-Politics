# SL Politics — deployment architecture

Four independently deployable pieces. Each is documented here with what it
does, what it does NOT do, and what happens if it is down.

```
  Reader's browser
        |
        |  static HTML, CSS, JS (prerendered, no server on the hot path)
        v
  ┌─────────────┐        VITE_API_URL (cross-origin, CORS)      ┌─────────────┐
  │  FRONTEND   │ ───────────────────────────────────────────>  │     API     │
  │  (static)   │  <— optional: works standalone without this   │  (Node)     │
  └─────────────┘                                                └──────┬──────┘
                                                                          │
                                            reads/writes JAVORA_DB        │  reads only,
                                            (SQLite, always)              │  5 endpoints,
                                                                          │  when DATABASE_URL set
                                                                          v
  ┌─────────────┐                                                ┌─────────────┐
  │   WORKER    │ ─────────── writes ───────────────────────────>│  SQLITE FILE │
  │  (Node)     │                                                │ (JAVORA_DB)  │
  └──────┬──────┘                                                └─────────────┘
         │
         │ fetches, on a schedule
         v
  Parliament of Sri Lanka, Cabinet Office
                                                                  ┌─────────────┐
                                                                  │ POSTGRESQL  │
                                                                  │ (optional)  │
                                                                  └─────────────┘
```

## 1. Frontend — static site

**What it is:** ~1,630 prerendered HTML files plus one JS/CSS bundle, built
once by `npm run build` (see `scripts/prerender.mjs`). No server-side
rendering happens per request — there is nothing here that runs continuously.

**Deploy it:** copy `dist/` to any static host, or serve it with
`deploy/nginx.conf` (the executable specification for the resolution order
is `scripts/serve-dist.mjs` — if a host's config disagrees with that script,
the script is right).

A host that reads `dist/_headers` (Netlify, Cloudflare Pages) gets the
Content-Security-Policy header automatically — it is generated at build time
and written into that file. **nginx does not read `_headers`.**
`deploy/nginx.conf` instead carries the policy as an active, hardcoded
`add_header Content-Security-Policy` line, generated from a specific past
build's `dist/csp.txt` (see the comment directly above it in that file). That
value goes stale the next time the inline theme script in `index.html`
changes — its sha256 hash is baked into the policy — so re-paste the current
`dist/csp.txt` into that line after any build that touches `index.html`;
skipping this does not break anything visibly, it just silently reintroduces
the flash-of-wrong-theme the hash exists to prevent.

**Depends on:** nothing, at request time. The canonical dataset is bundled
into the build itself. It calls the API only if `VITE_API_URL` was set
*at build time* — unset, the site is fully self-contained and the API can be
down, redeploying, or never started at all with zero effect on readers.

**If it is down:** the whole public site is down. Nothing else in this
architecture serves a page to a reader.

## 2. API — read endpoints, and one write

**What it is:** `server/api/server.ts`, a long-running Node process serving
JSON at `/api/*` plus `/health`. Ten read endpoints and one write (see its
own header comment) — **nothing under `/api/` ever writes canonical data.**

The write is `POST /api/corrections`: it appends one row to
`correction_report` with `review_status='open'` and can reach no other table,
because the handler holds an insert-only handle rather than a database
(`server/api/corrections.ts`, designed in
`docs/corrections-security-design.md`). Turning an approved report into an
actual record change stays a separate, human-triggered action. It has its own
tight rate limits (five per IP per hour, 200 site-wide) and its own env vars —
see `.env.example`'s corrections section, and **set
`JAVORA_CORRECTION_HASH_SALT`**. `JAVORA_CORRECTIONS=off` disables the
endpoint; it then answers 503 and the form says submissions are not connected,
which is the honest state for a deployment that will not review them.

Corrections are always written to SQLite, including when `DATABASE_URL` is
set — the same as `/api/status`, `/api/sources` and
`/api/government/current`. The API process opens a second, read-write
connection for this one purpose; its canonical connection stays read-only at
the engine level, so the volume must be writable (it is: `docker-compose.yml`
mounts `javora-data` read/write for both `api` and `worker`).

**Deploy it:** `node server/api/server.ts` behind a reverse proxy —
`deploy/nginx-api.conf` is a reference config (TLS termination, edge rate/
connection limits, and the `X-Forwarded-For` OVERWRITE the API's trust model
depends on). Set `JAVORA_TRUSTED_PROXIES` to that proxy's own address only
once it is genuinely in front of the API — see `.env.production.example` and
`server/api/trustedProxies.ts`; the API never trusts a forwarded address by
default. Containerised via `deploy/Dockerfile` + `deploy/docker-compose.yml`.

**Depends on:** `JAVORA_DB` (SQLite) for `/api/status`, `/api/sources` and
`/api/government/current`. Optionally `DATABASE_URL` (PostgreSQL) for five
endpoints only — health, people, a single person, search, facets — see
`.env.example`'s long comment on exactly which five and why the rest are not
converted yet.

**If it is down:** the frontend still serves everything it was built with
(the bundled dataset is a point-in-time copy, not a live proxy to the API).
A frontend built with `VITE_API_URL` set loses live data and falls back to
that same bundled copy — degraded freshness, not an outage.

## 3. Worker — automatic synchronisation

**What it is:** `server/scheduler/worker.ts`. The ONLY process that writes
canonical data. Polls Parliament and the Cabinet Office on the schedule
`PARLIAMENT_SYNC_INTERVAL`/`CABINET_SYNC_INTERVAL` set (0 = disabled, which
is the default everywhere — see `server/scheduler/schedule.ts`).

**Deploy it:** exactly ONE instance. `server/scheduler/lock.ts` documents in
detail what its overlap guard does and does not protect against; running two
worker processes against the same `JAVORA_DB` is the specific configuration
that guard is not built for. `docker-compose.yml` deliberately sets no
replica count for this reason.

**Depends on:** `JAVORA_DB` only. Never touches `DATABASE_URL`/PostgreSQL —
see `.env.example`.

**If it is down:** nothing the API or frontend serves goes down. The site
keeps serving the last successfully synchronised data — that is the whole
design point of `syncSource.ts`'s "never destroy data on failure" guarantee,
extended to "the worker not running at all" as the limiting case of "a run
failed."

## 4. PostgreSQL — optional read acceleration

**What it is:** a connection-pooled backend for exactly five API read
endpoints, added in `server/db/postgres.ts`. Genuinely tested (schema
migration, 3,230-row data copy, byte-identical validation — see
`scripts/validate-postgres-migration.mjs` and its own report) but **not**
the system of record: the worker never writes to it, and it can be dropped
and rebuilt from `JAVORA_DB` at any time via `npm run db:migrate:postgres`.

**Deploy it:** any managed PostgreSQL 16, or the `postgres` service in
`deploy/docker-compose.yml` for a self-hosted setup.

**It is OFF by default, deliberately.** `docker-compose.yml` used to set
`DATABASE_URL` on the `api` service unconditionally, which opted every compose
deployment into the Postgres path for those five endpoints. Nothing refreshes
Postgres — the worker writes SQLite only, and `npm run db:migrate:postgres` is
a one-shot copy that refuses a non-empty target — so the API served a frozen
snapshot of those five endpoints while the worker kept synchronising, and the
two diverged silently. That line is now commented out, together with the
`depends_on` that paired with it.

With it unset the API reads the same SQLite file the worker writes, through
the shared `javora-data` volume, and sync results reach the API immediately.
Enable Postgres only if you specifically want its connection pooling under
concurrent read load, and only alongside a deliberate mechanism that re-runs
the migration after syncs. Both commented blocks must be restored together.

**If it is down:** the API falls back to nothing automatically — `DATABASE_URL`
being set and unreachable is a real outage for those five endpoints, not a
graceful degradation. Unset `DATABASE_URL` entirely (falling back to SQLite
for those endpoints too) rather than pointing it at a database that might go
down independently, unless the deployment specifically wants Postgres's
connection pooling under concurrent load and accepts that trade-off.

## 5. Backups (L-7, SECURITY--SL Politics.md §24)

**What it is:** `node scripts/backup-db.mjs` (`npm run db:backup`) — a
consistent, point-in-time copy of `JAVORA_DB` via SQLite's own `VACUUM INTO`,
safe to run against the live database while the worker is writing to it. See
the script's own header for why `VACUUM INTO` and not a filesystem `cp`.

**Where backups go:** `.data/backups/` next to the source database by
default (`--out-dir` to change it) — gitignored, outside `dist/`, never
served by nginx (`deploy/nginx.conf` denies every `.db`/`.db-wal`/`.db-shm`
extension by pattern, in addition to sitting outside the web root entirely).
Filenames follow the existing manual convention already seen in that
directory: `javora-<ISO-8601-timestamp>[-label].db`.

**Retention.** Not enforced by the script — this repository has no
off-host storage target to enforce it against. As a starting policy for
whatever cron/systemd-timer/CI job actually invokes `npm run db:backup`:
keep daily backups for 14 days and weekly backups for 90 days, and verify
with a restore drill (below) at least as often as the retention window
changes. Prune old backups explicitly; this script never deletes one.

**Encryption.** Also not this script's job. `.data/backups/*.db` files are
full, unencrypted database contents — Invariant 13 ("a compromised
application must not automatically expose all backups") depends on them
never sitting somewhere the application itself, or its own compromise,
can reach. At minimum: restrict filesystem permissions on `.data/backups/`
to the backup job's own user, and encrypt at rest wherever a copy leaves
this host (most object-storage providers do this by default when server-side
encryption is enabled — verify it is, rather than assuming it).

**Restore drill.** A backup nobody has restored is a belief, not a
capability. Periodically (recommended: whenever the retention policy above
changes, and at least once per quarter):

```bash
# 1. Take a backup of a real (or realistic) database.
JAVORA_DB=.data/javora.db npm run db:backup

# 2. Point a SEPARATE JAVORA_DB at the backup file and confirm the app
#    actually starts and serves from it — not just that node:sqlite can
#    open it.
JAVORA_DB=.data/backups/javora-<timestamp>.db npm run api &
curl http://localhost:4000/api/status   # counts should match the original

# 3. Confirm row counts against the source directly, the same way
#    scripts/backup-db.test.mjs does it in CI:
node -e "
  const { DatabaseSync } = require('node:sqlite');
  for (const p of ['.data/javora.db', '.data/backups/javora-<timestamp>.db']) {
    const db = new DatabaseSync(p, { readOnly: true });
    console.log(p, db.prepare('SELECT COUNT(*) AS n FROM person').get());
  }
"
```

Never run a restore drill by pointing production's own `JAVORA_DB` at a
restored file in place — restore to a separate path (or a separate
environment entirely) and verify there first.

## Local test of this exact configuration

```bash
cp .env.production.example .env   # then fill in every CHANGE_ME
docker compose -f deploy/docker-compose.yml --env-file .env up -d
curl http://localhost:4000/api/health
```

See the repository root README's verification log for the actual output of
running this.
