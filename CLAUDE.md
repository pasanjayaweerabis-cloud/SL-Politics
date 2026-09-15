# CLAUDE.md

SL Politics (`javora-react`) — a public-record site for Sri Lankan political
figures. **Correctness, provenance and crawlability outrank tidiness here.** A
change that makes the code smaller and the record less trustworthy is a
regression.

Long-form reasoning lives in `README.md` (~1,200 lines). This file is the
short, current, load-bearing version. Facts below were counted on
**31 August 2026**, not remembered.

## Commands

```bash
npm run dev                     # Vite on 127.0.0.1:5173, bundled data, no server
npm run build                   # vite -> vite --ssr -> prerender. NEEDS VITE_SITE_ORIGIN
npm test                        # vitest run - 784 tests, 46 files
npm run typecheck               # tsc --noEmit, owns all .ts/.tsx
npm run lint                    # eslint, owns .js/.jsx only (see eslint.config.js)
npm run serve:dist              # serve dist/ on :5190
npm run validate:crawlability   # needs serve:dist running. HARD GATE.
```

`npm run build` fails without `VITE_SITE_ORIGIN` on purpose — a canonical URL
pointing at localhost is worse than none. Use `VITE_SITE_ORIGIN=https://javora.lk`.

**Only `serve:dist` tells the truth about production.** It resolves directory
indexes, returns real 404s and applies the generated CSP, and it is what
`validate:crawlability` targets. `npm run dev` prerenders nothing and injects
the CSS through JS, so its first paint differs by construction — edit against
it, never judge prerendering or crawlability by it. `npm run preview` is the
trap: it serves `dist/` but answers deep routes with the SPA shell instead of
the prerendered file, so a broken build looks fine (the reasoning is at the top
of `scripts/serve-dist.mjs`). The script is kept for ordinary bundle checks; its
launch-config entry was removed so it is not reached for by habit.

`serve:dist` warns at startup when `dist/` is older than the source it was built
from. Heed it: `validate:crawlability` runs against that server, so a stale
build means the hard gate passes on code you are no longer running.

**Node >= 24 is required**, not preferred: the server runs TypeScript through
bare `node` and uses `node:sqlite`'s `DatabaseSync`.

## Never run these against real data

`npm run db:migrate`, `db:seed`, `sync`, `sync:parliament` and
`db:migrate:postgres` all write `.data/javora.db`. **There is no git remote.**
Copy the database first and point `JAVORA_DB` at the copy. `.claude/settings.json`
makes these ask; do not widen it. `.data/backups/javora-2026-08-29T21-01-04-180Z.db`
is a protected recovery artefact — never delete it.

## Architecture

Two data paths that share parsers and, as of 1 September 2026, the same
people universe — but still not the same write mechanism:

- **Bundled (what 99% of the site renders).** `scripts/import-*.mjs` →
  `src/data/imported/*.json` → adapters → `src/services/repository.ts` → pages.
  Synchronous, which is what lets the site deploy as pure static files.
- **Database (what `/api` serves).** `server/fetchers/*` →
  `server/sync/syncSource.ts` → `CanonicalStore` (`server/db/store.ts`) over
  `node:sqlite` → `server/api/*`. Past members reach the database through a
  different route: `scripts/promote-past-members.mjs` promotes the same
  `pastMembersDataset` objects the bundle already computes — there is no live
  connector for the historical directory, only for the current one.

Until this promotion script existed, the database held only the 225 current
members its live connector wrote; the 1,398 former members were reachable
from the frontend and invisible to `/api`. Fixing that also required
`scripts/reconcile-identity-overrides.mjs`, which re-syncs the Cabinet Office
so a curated override (below) reaches a database written before the override
existed — see `server/sync/bundleParity.test.ts`, which asserts the two
stores agree on the people they now both hold. Neither script is on a
schedule; re-run them by hand after a real historical re-crawl.

`src/services/repository.ts` is the **only** data boundary — no page or
component imports a dataset directly. `src/lib/routeManifest.ts` is the **only**
URL list, feeding prerender, sitemap and tests.

Dataset: 1,623 people (226 currently serving, 1,397 former), 6,649 positions,
earliest office 1931. Sources: 7 declared, 2 connected (S001 Parliament,
S006 Cabinet Office). S900 is a research compilation, authoritative for nothing.
1,623 rather than 1,624 since the President's two records were merged — see
"Curated identity assertions" below.

Schema: `server/db/migrations/*.sql` — 4 migrations, 29 tables. That is the
schema of record. `docs/data-model-principles.md` explains why the model is
shaped as it is.

## Invariants — do not break these

Each exists because a real bug was found. Several have tests; where they do not,
add one rather than removing the behaviour.

**Prerender / crawlability**

- `TabPanel` renders **all** children and hides with `hidden`. Rendering
  `{selected ? children : null}` shipped every profile with an empty Political
  Career panel in the static HTML. Pinned by `src/lib/prerenderContent.test.ts`.
- `DirectoryPage` maps `results`, **not** `page.items`. A card it declines to
  render is a profile with no crawlable link. **Do not paginate by dropping
  links.** Any directory change must pass `npm run validate:crawlability` on
  every URL (currently 1623/1623).
- `liftPreloads()` in `scripts/prerender.mjs` — React 19 emits preloads inline
  and hoists them on the client; the mismatch fails hydration and discards the
  whole prerendered tree.
- `stripShellMeta()` — prevents three meta tags duplicating on 1,628 pages.
- Unknown routes resolve to `not-found`, never home. Soft-404s must not index.
- `index.html`'s inline theme script has its **sha256 baked into the CSP**.
  Edit it and regenerate, or the theme flash silently returns.
- One `BUILD_TIME` for the whole build, so a term boundary cannot fall
  mid-build and produce contradictory pages.

**Hydration**

- `ThemeToggle` starts `dark=false` unconditionally.
- `NotFoundPage` uses `useSyncExternalStore` for a distinct server snapshot.

**Data integrity**

- `verificationForImportedFact()`'s four-condition rule and `normaliseClaim()`
  enforcing the same floor at render time. Do not weaken either.
- `planPositionUpdate()`'s four outcomes, especially `close-and-open`: history
  is added to, never overwritten.
- **A missing end date is not "Present."** `Period` says "Present" only when a
  source states the role is ongoing; otherwise "end not recorded". 314
  positions are genuinely ongoing; 56 have an unrecorded end.
- `Unavailable` / `Unrecorded` / `NotVerified` are three different statements
  ("not recorded here" / "not published by anyone" / "no results"). Do not
  merge them.
- **Identity never auto-merges on names alone** — only an exact external-id
  match. Uncertain matches go to the identity-review queue. Parliament's
  id-first resolution and the Cabinet Office's fuzzy name matching are separate
  policies and must stay separate; the Cabinet Office publishes no ids at all.
- **Curated identity assertions** live in `src/data/identityOverrides.ts` and
  are the ONLY way two records may be merged when the names cannot decide it.
  Do not loosen the fuzzy thresholds instead: measured on this dataset, the
  President's two spellings are further apart (edit distance 8) than two
  *different* members' are (Anura Dissanayaka / Thanura Dissanayake, distance
  3), so any threshold that merges him merges them first. Each entry carries
  required prose evidence and is read by both stores — the bundle adapter and
  the sync worker's resolver — so they cannot diverge on identity.
- **A merged record may change its published slug, but only by retiring the
  old one.** The displaced slug goes in the override's `retiredSlugs`, where it
  stays resolvable (`getPersonBySlug`), gets prerendered as a real file, and
  declares the current slug canonical — while staying OUT of the sitemap.
  Skipping the prerender step is the trap: the SPA resolves the old URL fine
  and a static host still returns a hard 404. Guarded by
  `src/services/slugs.golden.test.ts` and `src/lib/routeManifest.test.ts`.
- Evidence is a row with a `locator`, not a column. A row naming only a source
  is an institution reference, not a citation.
- Slugs are permanent public URLs — "never reused, never changed once
  published". `slugify` currently exists in six copies; if you consolidate it,
  diff every slug before and after and require byte-identical output.
- Nothing time-dependent is stored: age, tenure and currency are derived.
- `src/lib/externalUrl.test.ts` contains a **deliberate NUL byte** at offset
  1914 (attack-string test data). `.gitattributes` marks it `-text`. Do not
  "repair" it.

**Infrastructure**

- The API is **read-only with exactly one exception**: `POST /api/corrections`
  (`server/api/corrections.ts`). Every other method on every other path is
  still rejected with 405, and that exception is narrow by construction — the
  handler holds a `CorrectionIntake`, not a database, so the only statement it
  can execute is one INSERT into `correction_report` with
  `review_status='open'`. **A web request still cannot touch `person`,
  `position` or any other canonical table**; publishing an approved correction
  is a separate, human-triggered action through `CanonicalStore`. The API
  process opens a second, read-write connection purely for this — the
  canonical one stays read-only at the engine level. Built to
  `docs/corrections-security-design.md`, whose numbered adversarial tests are
  `server/api/corrections.test.ts`. Do not widen the exception: a second write
  endpoint needs its own threat model, not a copy of this one's.
- The corrections form **submits only when `VITE_API_URL` was set at build
  time**, and says plainly that submissions are not connected when it was not.
  Do not make it optimistic. Telling a reporter their correction was received
  when it was discarded is worse than the disconnected form this replaced.
- **One worker process only.** `server/scheduler/lock.ts` is in-process;
  `docker-compose.yml` sets no `deploy.replicas` and none should be added.
- Keep the `CHECK (source_url LIKE 'http%')` constraint as defence in depth
  even though code also validates URLs.
- The corrections form is deliberately **stricter** than the renderer's URL
  check (it rejects institution homepages). Do not flatten them into one rule.

## Conventions

- `.jsx` for components, `.ts`/`.tsx` for logic. **Do not convert `.jsx` to
  `.tsx`** — ESLint covers only `.js`/`.jsx` because TypeScript 7 blocks
  `typescript-eslint`, so converting moves components into the unlinted half.
- Relative imports carry explicit file extensions (Node's ESM resolver needs
  them). `scripts/add-import-extensions.py` reproduces this; it is dry-run by
  default and needs `--write`.
- **Add no dependencies.** The absence of a router, HTTP framework, ORM, state
  library and CSS framework is a documented position argued in the code. All 16
  current dependencies are used.

## Deployment

Three deployables: static `dist/`, the API container, the worker container.

**The API reads SQLite.** `deploy/docker-compose.yml` previously set
`DATABASE_URL` unconditionally, which switched five read endpoints to Postgres
while the worker kept writing SQLite and nothing refreshed Postgres — so the
API served a frozen snapshot. That override is commented out. Postgres is an
opt-in read accelerator, never the system of record; re-enabling it needs a
deliberate re-migration step. See `deploy/README.md` §4.

## Known-stale documentation

Nothing known-stale remains. `README.md`'s "Backend architecture (future)",
"Known limitations" and "Synchronisation foundation" sections and
`docs/schema.sql` were the stale set; the first three were rewritten from the
code and `schema.sql` was replaced by `docs/data-model-principles.md`. If you
find a document contradicting the code, fix the document — do not build to it.

## Known data divergences — read before touching identity or slugs

`server/sync/bundleParity.test.ts` compares the two stores and enumerates one
real divergence today. It predates the current work and is recorded, not
hidden. This list may only shrink. Two others were resolved on
1 September 2026 and are kept as "RESOLVED" notes in that file rather than
deleted outright, so the history of what used to diverge is not lost:

- The President split across two id-spaces in the database, fixed by
  `scripts/promote-past-members.mjs` and `scripts/reconcile-identity-overrides.mjs`.
- Five people with a different canonical name/slug in each store
  (`parliament:3549`, `:3472`, `:161`, `:1477`, `:201`) — Parliament's live
  listing page updated to spell all five the same way its profile pages, and
  therefore the bundle, already did. Caught by actually running the
  "operational" schedule (`PARLIAMENT_SYNC_INTERVAL`/`CABINET_SYNC_INTERVAL`
  set, `node server/scheduler/worker.ts --once`) against real data — see
  `server/fetchers/parliamentConnector.test.ts` for the regression that same
  run surfaced: the connector was asserting `startDate: null` instead of
  `undefined` for every position, which is indistinguishable from Parliament
  confirming no start date exists and silently erased 269 members' real term
  start dates the first time it ran against a database `promote-detail.mjs`
  had already enriched. Fixed before this schedule was recommended for real
  use; `.env.production.example`/`.env.staging.example` already carry the
  recommended intervals.

1. **2 of the database's positions have no evidence row** (both open
   offices: `parliament:1432`, `parliament:71`). The bundle is clean — all of
   its positions resolve at least one. Tracked as a ratchet that may fall,
   never rise. It was 353 until 15 September 2026, when the 351 past spells
   an early `promote-detail.mjs` run wrote without evidence were backfilled
   with the rows the current script writes — backup:
   `.data/backups/javora-pre-evidence-backfill-2026-09-15T18-31-45Z.db`. 58 further positions (malformed source dates —
   Parliament's own past-member records occasionally publish an end date
   before the start date) are in the bundle but were skipped rather than
   written to the database at all, since the schema's `end_date >= start_date`
   CHECK constraint refuses them outright; see `promote-past-members.mjs`'s
   own reporting of exactly which ids and why.

## Current gaps (real, as of 31 Aug 2026)

- The whole 3 MB dataset ships in the client bundle; the directory renders all
  1,623 cards; `public/wallpaper1.png` is 1.9 MB on the LCP path. All three are
  known, measured, and deliberate trade-offs for crawlability and static
  deployability — see the audit before "fixing" any of them.
- Component tests cover rendered markup only. Drawer's focus trap, Tabs'
  arrow-key focus movement and Avatar's onError fallback need a DOM and are
  verified by hand; adding jsdom for them was considered and rejected.
- Of the 5 skipped tests, 3 are Postgres cross-engine parity (need
  `DATABASE_URL_TEST`) and 2 are placeholders that report when `.data/javora.db`
  or `dist/` is absent.
- Automatic sync is implemented but off — every interval defaults to 0.
- `place_of_birth` and `nationality` are real columns on `person`, populated for
  0 rows, and absent from the frontend `Person` type. The profile hard-codes
  "Not publicly verified" for place of birth, so a value stored there today
  would not display.
