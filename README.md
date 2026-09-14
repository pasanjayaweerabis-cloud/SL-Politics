# SL Politics

A source-first public-record platform for Sri Lankan public figures — offices, position history, timelines, qualifications, and the institutional records each claim should be traceable to.

> **SL Politics now has a real backend.** A canonical SQL database, a server-side
> sync worker, real source connectors, snapshots, change detection and an HTTP
> API — all behind the same unchanged Home → Search → Profile interface.
>
> **What is loaded:** the 225 sitting members of the Parliament of Sri Lanka,
> retrieved from the official [Directory of Members](https://www.parliament.lk/en/members-of-parliament/directory-of-members/)
> by a real connector.
>
> **What is honest about its limits:** exactly **one** source is connected
> (Parliament). **No automatic synchronisation is running** — the scheduler
> exists and works, but every interval defaults to 0, so syncs happen when a
> person runs one. **Nothing is marked verified.** See
> [Data coverage](#data-coverage) and [What is genuinely automatic](#what-is-genuinely-automatic).
---

## Contents

- [Purpose](#purpose)
- [Running locally](#running-locally)
- [Current Government](#current-government)
- [The person profile](#the-person-profile)
- [Where the education data comes from](#where-the-education-data-comes-from)
- [Research-file ingestion](#research-file-ingestion)
- [Portraits](#portraits)
- [Backend architecture](#backend-architecture)
- [Database](#database)
- [API](#api)
- [Source connectors](#source-connectors)
- [The sync job](#the-sync-job)
- [Scheduler and worker](#scheduler-and-worker)
- [Source reconciliation and authority](#source-reconciliation-and-authority)
- [What is genuinely automatic](#what-is-genuinely-automatic)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Verification states](#verification-states)
- [Source philosophy](#source-philosophy)
- [How dates are handled](#how-dates-are-handled)
- [How history is preserved](#how-history-is-preserved)
- [Data coverage](#data-coverage)
- [The Parliament importer](#the-parliament-importer)
- [Identity resolution](#identity-resolution)
- [Search](#search)
- [Testing](#testing)
- [Synchronisation foundation](#synchronisation-foundation)
- [Known limitations](#known-limitations)

---

## Purpose

SL Politics presents public information about Sri Lankan public office holders in a way that lets a reader judge it: every factual claim carries its provenance, gaps are shown as gaps, and history is retained rather than overwritten.

The *intended* coverage is national-level public office — presidents, prime ministers, cabinet/state/deputy ministers, sitting and former members of parliament, opposition and party leadership — with affiliations, election history, appointments and qualifications.

The *actual* coverage today is one slice of that: the sitting membership of Parliament. The gap between the two is documented in [Data coverage](#data-coverage) rather than glossed over, because a directory that quietly omits its gaps invites the reader to assume they are not there.

### The product stays to one loop

```
HOME  →  SEARCH  →  PERSON PROFILE
```

SL Politics is deliberately **not** a multi-section government portal. There is no standalone Parties, Elections or Sources page competing for a nav slot — that information lives *inside* the directory's filters and *inside* each person's profile instead:

- **Party** → a directory filter, and a "Political Affiliations" section on the profile.
- **Elections** → a section on the profile (currently an honest empty state — see [Known limitations](#known-limitations)).
- **Sources** → cited inline wherever a claim needs one, each linking straight to the official institution's own site rather than to an internal SL Politics page.

The nav bar has exactly two links: Home and Directory. Advanced data infrastructure (verification states, evidence provenance, the sync foundation below) sits behind those two pages, not in front of the reader as more places to navigate.

---

## Running locally

```bash
npm install
npm run dev
```

Vite prints the port it actually bound to — use that rather than assuming `5173`.

Building requires the public origin, and fails rather than guessing one:

```bash
VITE_SITE_ORIGIN=https://javora.lk npm run build
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build: bundle, then prerender every route, sitemap, robots, 404 and headers into `dist/`. Requires `VITE_SITE_ORIGIN` |
| `npm run build:spa` | Bundle only, without prerendering |
| `npm run serve:dist` | Serve `dist/` with real static-host semantics (use this, not `preview`, to check a build) |
| `npm run preview` | Vite's own preview — applies an SPA fallback, so it does **not** reflect production routing |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Test suite in watch mode |
| `npm run lint` | ESLint over the JS/JSX surface |
| `npm run typecheck` | `tsc --noEmit` over the TypeScript surface |
| `npm run coverage` | Report what is loaded in the bundled dataset |
| `npm run db:migrate` | Create or upgrade the canonical database |
| `npm run db:seed` | Load source definitions and authority rules |
| `npm run db:status` | Report what the database actually holds |
| `npm run sync:parliament` | Retrieve and synchronise Parliament (~255 requests) |
| `npm run api` | Start the HTTP API on :4000 (read-only but for `POST /api/corrections`) |
| `npm run worker -- --once` | Run every enabled schedule once |

The project clones and initialises cleanly: `node_modules/`, `dist/`, `.data/` (the database) and all `.env` files are gitignored, and no secrets are committed. Copy `.env.example` to `.env` to configure ports, CORS origins and sync intervals.

The frontend runs with no backend at all — it uses the bundled dataset unless `VITE_API_URL` is set. See [API](#api).

### Static hosting

The build is **prerendered**: every public route is a real HTML file, so there
is nothing to rewrite and no shell to fall back to.

```
dist/index.html                          /
dist/government/index.html               /government
dist/person/harini-amarasuriya/index.html  /person/harini-amarasuriya
dist/404.html                            anything else, with a 404 status
```

A host must resolve, **in this order**:

1. the exact file — `/sitemap.xml`
2. that path's directory index — `/person/x` → `/person/x/index.html`
3. `404.html`, returned with a real **404** status

**Do not add a single-page-app rewrite to `index.html`.** That is the usual
recipe and it breaks two things at once here: it shadows every prerendered
profile with the empty app shell, throwing away the crawlable HTML the build
just produced, and it answers every nonexistent URL with HTTP 200, so search
engines index an unlimited supply of pages that do not exist.

`deploy/nginx.conf` is a reference configuration.
`scripts/serve-dist.mjs` (`npm run serve:dist`) implements these semantics
exactly and is what the build is verified against — `vite preview` applies its
own SPA fallback and will *not* show you production behaviour.

The build also emits `dist/_headers` (Netlify / Cloudflare Pages format) and
`dist/csp.txt`, containing a Content-Security-Policy whose script hash is
computed from the shipped `index.html` at build time.

---

## Project structure

```
src/
  types/models.ts            Canonical domain model — the schema contract
  styles/
    index.css                Entry point — imports the four files below
    tokens.css               Design tokens (moved from public/assets/css/)
    base.css, layout.css, components.css   Civic Calm styles
  lib/
    date.ts                  Precision-aware date arithmetic
    positions.ts             Derived office logic (current, tenure, headline)
    identity.ts              Name normalisation, search, identity resolution
    typeahead.ts             Pure combobox selection logic (arrows/Enter/Escape)
    verification.ts          Verification states and their enforcement
    router.tsx               Client-side router (Home / Directory / Person / Corrections)
    seo.ts                   Per-page metadata
    theme.ts/.js             Light/dark theme
    icons.jsx                Inline icon set
  data/
    imported/
      parliamentMembers.json The retrieved dataset + its snapshot record
    roles.ts                 Explicit role taxonomy + title classification
    sources.ts               Institutional sources and per-fact authority
    taxonomy.ts              Parties and districts, DERIVED from the import
    adapters/
      datasetDescriptor.ts   Dataset mode ("live") + import snapshot
      parliamentDataset.ts   Projects the import into the canonical model
  services/
    repository.ts            The data boundary every component reads through
    apiClient.ts             API-backed data source (opt-in via VITE_API_URL)
    corrections.ts           Correction validation + API payload contract
  sync/                      Synchronisation foundation — see below
    connectors/
      types.ts               fetch/parse/normalise/validate contract
      parliament.ts          Parliament connector: role splitting, name + validation
    pipeline.ts              Change detection, duplicate-import guard, conflict detection
    positionUpdate.ts        History-preserving position updates ("don't overwrite")
    importRun.ts             Deterministic ids, field diffing, ChangeEvents
    snapshot.ts              Content hashing + append-only snapshot log
    identityReview.ts        Turns an uncertain identity match into a review-queue item
    verificationPolicy.ts    The rule for VERIFIED, and why nothing is
  components/
    Chrome.jsx               Nav (Home, Directory), footer, mobile drawer
    Primitives.jsx           Shared building blocks (cards, badges, evidence pills, filters)
    SearchTypeahead.jsx      The primary search combobox with live suggestions
  pages/                     One component per route: Home, Directory, Person, Corrections, 404
server/                      THE BACKEND — runs in Node, never in the browser
  db/
    migrations/001_initial.sql  Portable DDL (SQLite + PostgreSQL)
    database.ts              Connection, migration runner, transactions
    store.ts                 CanonicalStore — the only module that writes
  fetchers/
    parliamentConnector.ts   The live Parliament connector
  sync/
    syncSource.ts            The sync job: fetch to canonical write
    authority.ts             Fact-specific source authority table
    reconcile.ts             Source reconciliation
  api/
    server.ts                Read-only HTTP API
    queries.ts               Server-side filtered, paginated reads
  scheduler/
    schedule.ts              Env-configured intervals
    worker.ts                The long-running sync worker
  cli.ts                     migrate / seed / sync / status
scripts/
  coverage-report.mjs        Counts what is in the bundled dataset
  add-import-extensions.py   Codemod: explicit import extensions (see below)
```

### Why imports carry explicit `.ts` extensions

Node's ESM resolver does not do extensionless resolution, so `from "../lib/x"`
fails when the server runs TypeScript directly. Writing the extension lets the
*same* modules be used by the Vite bundle and by the Node server with no build
step and no duplicated logic — the connector, the sync job and the API all
import the existing date, identity and verification code rather than
reimplementing it. `allowImportingTsExtensions` makes `tsc` accept it.

---

## Architecture

```
React pages/components
        ↓            (never import raw data)
services/repository.ts              ← the seam a real API replaces
        ↓
data/adapters/parliamentDataset.ts  ← normalisation
        ↓
data/imported/parliamentMembers.json
        ↑
scripts/import-parliament.mjs       ← retrieval (Node, server-side)
        ↑
parliament.lk (official source)
```

No page or component imports the dataset directly, and none builds a query against a raw array. Everything reads through `services/repository.ts`.

That boundary has now been proven, not just asserted: the underlying data was swapped from a 28-record hand-entered demonstration sample to a 225-record live import from parliament.lk **without changing a single component**. Replacing the bundled JSON with an HTTP API is the same shape of change again.

### TypeScript

TypeScript was introduced incrementally. The data model, all business logic, the router and the service layer are `.ts`/`.tsx` under `strict`. The React components remain `.jsx` — they are presentational, they are covered by the typed boundary they consume, and converting them wholesale would have been churn without much benefit. `allowJs` is on and `checkJs` is off.

`tsc --noEmit` owns the TypeScript files; ESLint owns the JS/JSX files. TypeScript files are deliberately excluded from ESLint because `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` and this project runs TypeScript 7 — wiring it in would mean forcing an unsupported resolution or downgrading the compiler. The gap is stylistic only, since `tsc` already checks those files under `strict`.

---

## Data model

A **person is modelled separately from their offices**. `Person` carries identity only; positions, affiliations, qualifications and events are related records keyed by `personId`.

| Entity | Purpose |
| --- | --- |
| `Person` | Canonical identity: names (en/si/ta), aliases, dates, external IDs |
| `Position` | One public office held, with `roleType`, dates and precedence |
| `PositionEvent` | A dated event in an office's life (elected, appointed, resigned…) |
| `PoliticalAffiliation` | Party membership over time, with role and dates |
| `Party` | Party record with abbreviation, aliases, founding/dissolution |
| `Election` / `Candidacy` | Election records and per-candidate results |
| `Qualification` | A credential, with its own evidence |
| `InstitutionalSource` | A public body and the fact types it is authoritative for |
| `SourceEvidence` | One claim bound to one specific document |
| `SourceSnapshot` | Raw fetched content, hashed, for change detection |
| `CorrectionReport` | A reader-submitted correction and its review state |
| `ChangeEvent` | Audit record: what changed, when, and which source caused it |

Two absences are deliberate:

- **No stored `current` flag.** Whether an office is held now is derived from its dates. A stored flag can fall out of agreement with `endDate`; a derived one cannot.
- **No stored age or tenure.** Both are computed at render time, so a record written in 2024 still reads correctly in 2031 without being edited.

---

## Verification states

| State | Meaning |
| --- | --- |
| `demonstration` | Hand-entered sample. Never a truth claim. |
| `unverified` | A real claim, with no specific supporting document. |
| `source-linked` | Points at a specific document; not yet checked. |
| `verified` | Matched against an authoritative source on a recorded date. |
| `conflicting` | Sources disagree. Surfaced, never silently resolved. |
| `pending-review` | Awaiting human confirmation. |
| `unavailable` | No authoritative record located. |

`unavailable` means *we have not found a record* — never *no such record exists*. The interface states that distinction explicitly.

### The rule for VERIFIED

A claim is `verified` only when **all four** hold (`sync/verificationPolicy.ts`):

1. Its evidence is **precise** — a specific document URL, record id or locator, not just an institution's name.
2. That evidence comes from a source **authoritative for that fact type** (Parliament for parliamentary membership; the Election Commission for results — not vice versa).
3. The extraction has been **confirmed** — a human reviewed it, or a second *independent* source agrees. Two pages of the same website are a consistency check, not independent agreement.
4. A **confirmation date** is recorded. A verification with no date is not a verification.

Today condition 3 is never satisfied: there is no review interface and only one source is connected. So **every imported fact sits at `source-linked`** — "here is the official document this came from; nobody has checked our reading of it."

The tempting shortcut this rule exists to refuse is *"it came from parliament.lk, therefore it is verified."* That conflates the authority of the source with the correctness of our reading of it. An importer can point at an impeccable official page and still have put the district in the party field or split one office into two. Marking that verified would make the badge meaningless exactly where it matters most.

Three further rules are enforced in `lib/verification.ts`, in code rather than by convention:

1. **In demonstration mode, every claim is forced to `demonstration`.** Nothing can present itself as verified.
2. **`verified` requires both evidence and a verification date.** Missing either downgrades to `pending-review` — a verification claim with no date is not a verification.
3. **`source-linked` requires precise evidence.** Evidence naming only an institution downgrades to `unverified`, because citing a homepage is not citing a source.

---

## Source philosophy

Authority is **per fact type**, not global. No single body is authoritative for everything:

| Fact type | Primary source |
| --- | --- |
| Parliamentary membership | Parliament of Sri Lanka |
| Election results | Election Commission of Sri Lanka |
| Executive appointments | Presidential Secretariat |
| Portfolio assignments | Gazette / Cabinet Office |
| Gazette instruments | Department of Government Printing |
| Qualifications | University Grants Commission |

A global "source A > source B" ranking would silently prefer the wrong body for half the facts on the site, so `InstitutionalSource.authoritativeFor` records which fact types each source is primary for.

### Evidence, not just a source ID

Storing `sourceId: "S001"` against a claim says only "Parliament exists". Real evidence identifies a retrievable document:

```ts
{
  sourceId, sourceUrl, documentTitle, publishedAt, retrievedAt,
  locator,          // "Page 12, paragraph 4"
  sourceRecordId,   // the source's own identifier
  contentHash, notes
}
```

`hasPreciseEvidence()` requires at least one of `sourceUrl`, `sourceRecordId` or `locator`. Every evidence record projected from the current demonstration dataset **fails** that test — correctly, because the legacy data only ever named institutions. Locators are never invented to make evidence look stronger.

Every evidence pill in the UI links straight to the official source — the exact document URL when the evidence is that precise, otherwise the institution's own site — never to an internal SL Politics page. There is no source-management UI for ordinary readers to browse; the evidence *for a claim* is what's presented, right where the claim is.

---

## How dates are handled

Dates are stored as partial ISO strings, precision-tagged by length: `"1968-11-24"` (day), `"2024-09"` (month), `"2000"` (year), `null` (not recorded).

**A partial date is never widened into a false exact one.** Every duration returns one of:

```ts
{ kind: "exact",   years }          // precision permits a single answer
{ kind: "range",   min, max }       // precision permits only a range
{ kind: "unknown", reason }         // an endpoint is missing or invalid
```

So a person recorded as born in `1968`, with no month, renders as *approximately 57–58* rather than being assigned a 1 January birthday. This fixed a real bug: the previous implementation returned exactly `58` for that input, and returned exact tenure figures for the year-only office dates present in the dataset.

Calendar-invalid dates (`2023-02-30`, `2023-02-29`) are rejected at parse time rather than accepted because they match the shape.

### When a source says *that* an office is held, but not *since when*

The Parliament directory does exactly this: it asserts current membership and publishes no term start date. That created a real tension — with `startDate: null` and no other signal, `isCurrent()` would render all 225 sitting MPs as no longer serving, which is as false as inventing a start date would be.

The resolution is `Position.currentAsOf`: the date on which a source asserted the office *was being held*. It is explicitly **not** the forbidden stored `current: true` flag — that flag is banned because it is a computed status that can silently contradict `endDate`. `currentAsOf` is the opposite: a dated observation about a source, in the same family as `SourceEvidence.retrievedAt`. A recorded `endDate` still always wins, so the two can never disagree.

The profile page's "Legislative Service" duration is deliberately *not* used to back-compute a start date: for members with previous terms it is cumulative across parliaments, so treating it as this term's start would manufacture a wrong date.

---

## How history is preserved

Position history is **append-only**. When someone leaves office, the existing record keeps its `endDate` and the new office is added alongside it. Records are never edited in place to show only the present.

When an ingested source disagrees with a stored value, the change is queued for review rather than written over the record, and `ChangeEvent` retains the previous value alongside the source that superseded it.

Event types (`resigned`, `dismissed`, `removed`…) are recorded **only when a source states them**. A term simply ending is not evidence of a resignation.

---

## The person profile

```
PHOTO / MONOGRAM   NAME
                   CURRENT ROLE
                   PARTY · DISTRICT · STATUS
                   BORN · DISTRICT · OFFICES HELD
─────────────────────────────────────────────────
OFFICIAL OVERVIEW
─────────────────────────────────────────────────
[ EDUCATION & CAREER ]  [ POLITICAL CAREER ]
─────────────────────────────────────────────────
```

Two tabs **inside** the profile — not new pages. Navigation stays Home /
Directory / Person Profile.

**Tab 1 — Education & Career** (the default, because the profile is
person-first): Education (school, O/L, A/L, university, postgraduate),
Certifications, Professional Experience, Public & Institutional Service.

**Tab 2 — Political Career**: Current Political Positions, Current Portfolios,
Political Career History, Parliamentary History, Party History, Election
History, Timeline, Sources & Verification. Every political structure that
existed before is preserved — the tab reorganises it, it does not simplify it.

Tab state lives in the query string (`?tab=political`) so a tab can be linked
and survives reload, written with `replaceSearch` rather than a push so
switching tabs does not fill the back button with entries to click through.

### Keyboard behaviour

The tabs use **manual activation**: arrow keys move focus between tabs, and
Enter or Space activates. Automatic activation (focus switches the panel) is
more common but wrong here — a keyboard user arrowing past "Political Career"
to reach it would swap the entire panel underneath them on the way, which a
screen reader then announces. A roving tabindex keeps exactly one tab in the
tab order, so Tab moves past the strip into the panel rather than through
every tab.

---

## Where the education data comes from

### A correction, and how it happened

An earlier version of this README stated that Parliament of Sri Lanka
publishes "exactly eleven fields" and that there was "no school, no
university, no degree, no examination result — not for one member, for any of
them."

**That was wrong.** It came from reading only the labelled fields at the top of
a member's profile page. The rest of the record lives in Bootstrap tab panes
further down the *same HTML document*, under a "Related Information" heading:

| Pane | What it publishes |
| --- | --- |
| Qualifications | Academic and professional qualifications, as the member submitted them |
| Legislative History | Every parliament served in, with **per-member** dates |
| Portfolios Held | Offices, grouped by parliament, with start dates |
| Ministerial Services | Ministerial offices with start **and end** dates |

Those panes were in the bytes the connector was already downloading, and
discarding. Reading them changed the platform's factual coverage more than any
other single change:

| | Before | After |
| --- | --- | --- |
| Members with academic qualifications | 0 | **175** |
| Education records | 0 | **285** |
| Positions | 286 | **639** |
| Positions with a real start date | 0 | **639** |
| Positions with an end date | 0 | **351** |
| Members with dated parliamentary service | 0 | **225** |

The dates are per-member rather than per-parliament — two members of the same
parliament carry different start dates — which is what makes them service
records rather than a restatement of the term's calendar.

The lesson worth keeping: **"the source publishes nothing" is a claim about
the source, and it needs the same evidence as any other claim.** It was
asserted here on the strength of an incomplete read, written into a schema
comment, a README section and a page of interface copy, and it survived
because nothing tested it.

### What is still genuinely absent

**G.C.E. O/L and A/L results.** Parliament lists the *qualification* for 59
members (45 A/L, 14 O/L) and, for a few, the stream. It never publishes
grades. Those are individual examination records held by the Department of
Examinations, are not published for any candidate, and are personal data.

The distinction is enforced in the schema, not just in the interface: an
examination *held* is a row in `education` with `exam_level` set; a *grade* is
a row in `exam_result`, which requires a subject and a grade together and
which contains **zero rows** and should.

**School names.** Most members did not name one. A few did, inside a longer
qualification string.

**Members who filed in Sinhala or Tamil.** Parliament shows a notice in place
of the list for 35 members: qualifications appear "only in the language they
provided". That notice is a statement about the website, not the member — an
early version of the parser captured it as a qualification, which would have
put a paragraph of site boilerplate on 35 profiles where a degree belongs.
`isBoilerplate()` drops it.

### Occupation is not a qualification

Parliament files both under one "Professional Qualifications" heading:
"Attorney at Law" and "University Lecturer" sit side by side. The first is a
credential; the second is a job, already recorded as `profession`.
`looksLikeCredential()` keeps them apart against an explicit list, so a job
title never appears where a degree belongs.

The same care applies to classification: `classifyEducationLevel()` maps
"MBBS" to a **bachelor's** degree despite the leading M. A substring rule
would promote every doctor's basic medical qualification to a master's on
their public record.

---

## Research-file ingestion

Two research compilations were supplied as inputs. They are documents *about*
sources, not sources — Tier 3/4 material under this project's own hierarchy —
and they are handled accordingly.

### The pipeline

```
research file → parse → stage (research_claim) → match person → reconcile → promote?
```

Nothing is written straight to canonical tables. Every staged claim keeps the
**file, line number and verbatim sentence** it came from, so any promoted fact
can be checked against the original in one step.

### What reconciliation decides

| Outcome | Meaning | Count |
| --- | --- | --- |
| `rejected` | Absence statement, cross-reference, or a field an authoritative source already covers better | 158 |
| `corroborates` | Parliament already states it; canonical data unchanged, keeps its Tier 1 source | 10 |
| `promoted` | Parliament is silent; recorded at **secondary-corroborated**, never verified | 10 |
| `unmatched` | Person match too weak to attach anything to | 7 |

Of 185 staged claims, **10 were promoted**. That is the correct outcome, not a
failed import: the compilations were written without access to Parliament's
qualifications pane, and where they agree with it they confirm a reading
rather than extend it.

What they *did* add is the category Parliament does not publish at all —
employment and institutional service:

- Harini Amarasuriya — Senior Lecturer, Open University of Sri Lanka (2011–2020); UGC Standing Committee on Gender Equality
- Sajith Premadasa — Member, Constitutional Council of Sri Lanka
- Saroja Savithri Paulraj — Chairperson, Women Parliamentarians' Caucus (Tier 1, cited to parliament.lk)
- Sugath Wasantha de Silva — Chair, Parliamentary Caucus for Persons with Disabilities (Tier 1)
- Ramanathan Archchuna — Acting Medical Superintendent, Chavakachcheri Base Hospital

### Tiering is by what a claim links, not by what it names

The Gemini file attributes vote counts to "Election Commission of Sri Lanka /
Ada Derana" while linking only Ada Derana. The strongest thing actually
evidenced is the newspaper, so `tierFor()` resolves that pair to **Tier 3**.
Crediting it as Tier 1 would let a news report acquire the standing of an
official return.

### Two things the parsers exist to prevent

**Negated credentials.** A large share of the education sentences are
*negative*: "No official confirmation of M.A. …", "Secondary sources report a
B.A. (Hons) and a Ph.D. …, but official confirmation is lacking". A regex that
only looks for award tokens puts a degree on a named person's record that no
source claims they hold. `extractCredentials()` drops any award in a sentence
carrying a negation — including some genuine ones, which is the correct trade.

**Fused entities.** The files run records together with no separator
("Status: SECONDARY-CORROBORATEDOrganization: Nest Sri Lanka"). Left joined,
one employer's name attaches to a different employer's job title. This
actually happened during development and produced a composite employment
record for a sitting Prime Minister before `ungluedEntities()` was written to
split on literal starter keys.

### Profession is not employment

Parliament records a profession — "Attorney-at-Law", "Teacher", "University
Lecturer" — for 152 of 225 members. It appears in the Official Overview as
what it is: an occupation.

It is deliberately **not** turned into a Professional Experience entry. It
names no employer, no post and no dates. Manufacturing an employment record
from it would fabricate a career history nobody published.

Political and ministerial offices are likewise **not** listed as employment.
An office held is not a job applied for, and duplicating offices into the
career tab would double-count a person's record and blur the line the two
tabs exist to draw.

---

## Portraits

Portrait URL, credit, source page and retrieval date are stored for all 225
members, and the portrait is **displayed** wherever a member appears: the
profile header, the directory grid, the home page and the search typeahead.

### Two separate questions

The code keeps these apart, in [`src/data/portraitPolicy.ts`](src/data/portraitPolicy.ts):

| Question | Kind of thing | Where it lives |
| --- | --- | --- |
| What are the rights? | A fact about the source | `person.portrait_rights` |
| Does SL Politics display it? | An operator's decision | `PORTRAIT_DISPLAY_POLICY` |

parliament.lk carries *"Copyright © The Parliament of Sri Lanka. All Rights
Reserved."* and publishes no reuse licence, so `portrait_rights` is recorded
as `all-rights-reserved` — truthfully, and it stays that way. A government
publishing an image is not a grant of reuse.

Displaying it anyway is a **fair-dealing judgement**, not a claim about the
licence: these are official photographs of public officials, published so
citizens can identify their representatives, reproduced at thumbnail scale in
a civic-record context, with visible credit, hot-linked rather than copied.
Reasonable people can disagree, which is exactly why it is a flag and not a
hard-coded assumption.

### The switch

`PORTRAIT_DISPLAY_POLICY.displayPortraits = false` falls back to the SL Politics
monogram everywhere. Nothing else changes and the rights metadata is
untouched. If Parliament objects, flipping that flag is the whole remedy.

`hotlink: true` records the other half of the decision: the bytes stay on
parliament.lk. SL Politics is not redistributing the images, the institution keeps
its own access logs, and a portrait it replaces or withdraws changes here too.
Requests carry `referrerPolicy="no-referrer"`, so the institution is not told
which profile a reader is viewing.

`portraitsStored`, `portraitsRightsEstablished` and `portraitsRightsReserved`
are counted separately, so "we know where it is", "reuse is established" and
"reuse is not established" stay visible in the data rather than collapsing
into one number. Today that is 225 / 0 / 225.

### Failure behaviour

`portraitSrc()` resolves the URL and `Avatar` falls back to the monogram on
three distinct failures: no portrait recorded, an unreachable URL, and a URL
that loads but is not an image. The first is handled by the null return, the
other two by `onError`. [`src/lib/portrait.test.ts`](src/lib/portrait.test.ts)
pins the resolver against the regression that kept every portrait hidden for
the life of the dataset — a leading `/` prepended unconditionally, turning
each absolute URL into `/https://www.parliament.lk/…` and 404ing into the
monogram, which looked like a deliberate design choice rather than the bug it
was.

---

## Backend architecture

```
OFFICIAL SOURCE  (parliament.lk)
      |  fetch, robots-respecting, paced
SOURCE CONNECTOR          server/fetchers/parliamentConnector.ts
      |  parse -> normalise -> validate
SYNC JOB                  server/sync/syncSource.ts
      |  snapshot -> change detection -> identity -> reconcile -> history
CANONICAL DATABASE        server/db/  (SQL, migrated)
      |
HTTP API                  server/api/  (read-only; one write, see below)
      |
REACT UI                  unchanged - Home -> Search -> Profile
```

The browser is not in that chain until the last step. It cannot hold
credentials, runs only while a page is open, would issue one set of requests
per visitor (turning ordinary traffic into an accidental denial-of-service
against a government website), and leaves no single audit trail. Retrieval
belongs to one server-side process with one identity and one schedule.

### Running the backend

```bash
npm run db:migrate            # create/upgrade the database
npm run db:seed               # load source definitions + authority rules
npm run sync:parliament       # retrieve and synchronise Parliament (~255 requests)
npm run db:status             # what the database actually holds
npm run api                   # HTTP API on :4000
npm run worker -- --once      # run every ENABLED schedule once
```

---

## Database

**PostgreSQL is the production target. SQLite is what actually runs here**, and
the distinction is stated plainly rather than papered over: this environment
has no PostgreSQL server, no client binaries and a Docker daemon that is not
running, so a Postgres-only implementation would have been an untested `.sql`
file. `node:sqlite` (built into Node 24, no dependency) is a genuine
relational engine with foreign keys, CHECK constraints, transactions and
partial indexes — so every guarantee below is enforced by a database and
exercised by tests, not asserted in prose.

The migration SQL is written to run unchanged on both engines: TEXT primary
keys (ids are deterministic and application-generated), no ENUM types, no
arrays, no JSONB. `DATABASE_URL` is read so a Postgres driver can slot in
behind the same `Database` interface. **That path is not exercised here and
must not be called verified until it has run against a real server.**

To be exact about how far the Postgres path has actually been taken:
`server/api/queries.postgres.test.ts` runs the identical query against both
engines and diffs the result — it exists because Postgres folds an unquoted
`AS` alias to lowercase, which silently nulled every derived field, and only a
cross-engine diff found it. That file **skips unless `DATABASE_URL_TEST` is
set**, and it is the one skipped file in the default suite. `deploy/README.md`
section 4 records a validated 3,230-row migration. Neither runs in the ordinary
`npm test`, so treat Postgres as exercised-but-not-continuously-verified.

**Postgres is not the system of record and nothing refreshes it.** Only the
worker writes canonical data, and it writes SQLite. A Postgres copy is a
point-in-time accelerator for five read endpoints that goes stale at the next
sync, which is why `deploy/docker-compose.yml` leaves `DATABASE_URL` commented
out and the API reads the same SQLite file the worker writes.

`services/repository.ts` was deliberately **not** reimplemented against the
database. The bundled dataset is what lets the site deploy as static files with
no server at all; `src/services/apiClient.ts` is the API-backed path, used by
the Government page when `VITE_API_URL` is set.

23 tables, 29 indexes. The ones that carry the guarantees:

| Table | Guarantee it enforces |
| --- | --- |
| `person_external_id` | `UNIQUE (source_key, external_id)` — one external id per source maps to exactly one person. This is what makes automatic identity matching safe. |
| `position` | No `is_current` column. Currency is derived in SQL from `end_date`/`start_date`/`current_as_of`, so it cannot drift out of step with the dates. |
| `source_snapshot` | Append-only. A new retrieval never replaces its predecessor, because the predecessor is the only evidence of what the source used to say. |
| `change_event` | Insert-only audit: what changed, when, from which source and snapshot, and what it was before. |
| `source_conflict` | Both disagreeing claims retained, with the authority decision recorded. |
| `identity_review` | Where uncertain matches go instead of being merged. |
| `correction_report` | Reader corrections, which never write canonical data directly. |

Dates are TEXT holding partial ISO strings with the precision recorded
alongside (`date_of_birth`, `date_of_birth_precision`). A `DATE` column cannot
represent "we only know the year", and widening 1968 into 1968-01-01 is the
fabrication this project exists to prevent.

Migrations are tracked in `schema_migrations`, so initialisation is
reproducible and re-running is a no-op. Nobody edits tables by hand.

---

## API

Read-only, on `node:http`, no framework. **Nothing here writes canonical
data** — that is the sync worker's job alone, so a web request can never
mutate a public record.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/people` | Paginated directory; `q`, `party`, `district`, `role`, `status`, `limit`, `offset` |
| `GET /api/search?q=` | Typeahead; server-ranked and capped |
| `GET /api/people/:idOrSlug` | Full profile bundle |
| `GET /api/people/:idOrSlug/positions` | Current + historical offices |
| `GET /api/people/:idOrSlug/timeline` | Dated events |
| `GET /api/people/:idOrSlug/evidence` | Source evidence |
| `GET /api/facets` | Party/district/role counts |
| `GET /api/status` | Database counts, source sync state, `automaticSyncOperational` |

Every filter is applied **server-side** and every query is parameter-bound —
the search box is user input reaching a database, and string-building a query
with it is how injection happens. Page size is capped at 200.

### How the React app consumes it

The UI already reads everything through `services/repository.ts`, so the API
plugs in behind that boundary with **no component change**. It is opt-in: set
`VITE_API_URL` to switch the data source; leave it unset and the app uses the
bundled dataset and needs no server running.

That is deliberate. Making the API mandatory would mean the frontend could not
start without a database, which is worse for development and buys nothing
while 225 records still fit in a bundle. Once historical membership is
imported it will not fit, and `src/services/apiClient.ts` already returns the
shapes the bundled repository returns.

---

## Source connectors

Each connector implements the same four stages — `fetch` (the only async,
network-touching one), `parse` (still in the source's own vocabulary),
`normalise` (into SL Politics' model), `validate` (returns problems rather than
throwing them away).

| Source | Status | Why |
| --- | --- | --- |
| **S001 Parliament of Sri Lanka** | **Implemented and working** | Publishes a paginated member directory and per-member profile pages. 225 members retrieved. |
| S002 Election Commission | Not implemented | Root is a language splash page; results are published as documents, not a structured listing. Needs its own investigation. |
| S003 Presidential Secretariat | Not implemented | Returns **HTTP 403** to programmatic requests. |
| S005 Government Gazette | Not implemented | The configured document URL returns **404**; gazettes are scanned PDFs needing a different extraction approach. |
| S006 Cabinet Office | **Not implemented — the source does not publish the data** | Investigated directly. Its menu is Home / Cabinet / Info / Decisions / Downloads. "Cabinet" is the constitutional text on how ministers are appointed; "Info" is a staff contact directory (Secretary, Legal Advisor, Additional Secretaries). **There is no machine-readable roster of current ministers and portfolios.** Writing a connector would mean inventing one. |

Current ministerial portfolios *are* held — Parliament publishes each member's
portfolio on their own page, and that is where the Cabinet and Deputy
Ministers come from. What is missing is a second, independent executive source
to reconcile against.

---

## The sync job

`syncSource(store, connector)` runs the full lifecycle. Two properties it is
built around:

**It never destroys data on failure.** A fetch that times out, a source
returning 500, a parse that breaks — each is recorded as a failed `sync_run`
with its error, the last good snapshot stays the baseline, and canonical
records are untouched. The failure mode of a broken government website must
not be an empty directory. The apply step runs in a transaction, so a
mid-apply error rolls back rather than half-writing.

**It never overwrites history.** When a source reports a different office for
someone who already holds one, the existing position is **closed** (an end
date written) and a **new** position inserted. Both rows survive:

```
Minister of X   2024 -> 2026-06-01   (closed, superseded_by -> Minister of Y)
Minister of Y   2026-06-01 -> present
```

`closePosition` is the only mutation applied to a superseded row, and it
writes an end date and nothing else. There is deliberately no method that
rewrites a position's title in place.

### Source content changed is not the same as canonical data changed

`current_as_of` advances every time a source is re-checked and still says the
same thing. That is the source being re-confirmed, not a political fact
moving, so it is excluded from the watched fields — otherwise every run would
emit a change event per position and bury the real transitions.

Two bugs found by actually running this, both now pinned by tests:

1. **Raw-byte hashing is unusable for this source.** Every page embeds a
   freshly generated CSRF token, so identical content hashes differently on
   every request. Verified: two independent full fetches produced the same
   *semantic* hash (`fnv1a32:1197beac`) and different raw hashes. Change
   detection hashes the canonically ordered parsed records.

2. **A run that reads less must not delete what a fuller run established.** A
   listing-only sync does not fetch profile pages, so it carries no date of
   birth. Treating that as null wiped the date of birth off 219 people and
   logged 365 change events for facts that had not changed. `undefined` now
   means "this run did not look"; `null` means "the source has no value".

---

## Scheduler and worker

`server/scheduler/worker.ts` is a long-running Node process, deliberately not
part of the React app. Intervals come from the environment:

```
PARLIAMENT_SYNC_INTERVAL=1440      # minutes; 0 disables
PARLIAMENT_REQUEST_DELAY_MS=500    # politeness floor between requests
CABINET_SYNC_INTERVAL=0
ELECTION_SYNC_INTERVAL=0
GAZETTE_SYNC_INTERVAL=0
```

**Every interval defaults to 0 — disabled.** Automatically retrieving a
government website should be a deliberate act by whoever runs the deployment,
not a side effect of installing the software.

A schedule is *operational* only when its interval is positive **and** a
connector exists. `isAutomaticSyncOperational()` checks both, `GET /api/status`
reports it, and the UI must not describe data as live unless it is true.

This **polls**. The sources publish no change feed, so nothing here is — or is
described as — "real-time". "Automatically checked" is the accurate phrase.

---

## Source reconciliation and authority

Authority is **per fact type**, never a single global ranking
(`server/sync/authority.ts`):

| Fact type | Authority order |
| --- | --- |
| Parliamentary membership | Parliament |
| Election result | Election Commission |
| Portfolio assignment | Gazette, then Cabinet Office, then Parliament |
| Executive appointment | Gazette, then Presidential Secretariat, then Cabinet Office |
| Qualification | UGC |

Parliament is definitive about who sits in Parliament and says nothing binding
about election returns; the Election Commission is the reverse. One ordering
would silently prefer the wrong body for half the facts on the site.

When two sources disagree (`server/sync/reconcile.ts`):

1. **Agreement is checked after normalising cosmetic differences** — "Ports &
   Civil Aviation" and "Ports and Civil Aviation" are not an institutional
   dispute.
2. **Same office, different label** ("Minister of Energy" vs "Minister of
   Energy and Power") is a wording conflict, not two portfolios. A deputy
   ministry is never merged with the cabinet ministry of the same subject —
   different job, different person.
3. **Authority decides where the rules allow.** Equal rank, or a source with
   no authority for that fact type, returns *indeterminate* and goes to human
   review. Declaration order must never settle a dispute between two official
   bodies.
4. **Both claims are always retained.** Losing a conflict decides which value
   is displayed; it never deletes the record that the other institution said
   something different — often the most interesting thing on the page.

---

## What is genuinely automatic

Stated separately from what is built, because the two are not the same.

**Automatic today: nothing runs unattended**, because every schedule ships
disabled. Turning one on is a deliberate act by whoever runs the deployment,
not a side effect of installing the software.

**Two sources have real connectors** — Parliament (S001) and the Cabinet
Office (S006). Set either interval to a positive value and run the worker, and
that source is genuinely synchronised on a schedule:

```bash
CABINET_SYNC_INTERVAL=360 npm run worker
```

The worker then re-fetches on that cadence; hashes the parsed content and
compares it with the previous snapshot; writes nothing on unchanged content
but still records a snapshot (proof the source *was* checked and said the same
thing); and on changed content parses, validates, resolves identity,
reconciles, applies, closes superseded positions, opens new ones, and writes
change events. A failure is recorded as a failed run and canonical data is
left untouched.

**What is NOT automatic**, and why:

| Source | State | Reason |
| --- | --- | --- |
| Election Commission | no connector | 2024 results are per-district PDFs; no PDF text extraction exists here |
| Government Gazette | no connector | the published archive URL returns 404 |
| Presidential Secretariat | no connector | every page returns 403 behind a bot check |
| Prime Minister's Office | no connector | reachable and parseable; simply not written yet |

The scheduler will not run a source without a connector — it skips it and says
so — so setting those intervals changes nothing. That is deliberate: a
configured interval for a source nobody can read is a plan, not automation.

**Still manual:** resolving an `identity_review` or a `source_conflict` — both
are recorded, neither has a review UI. Marking anything `verified`.

### Deployment model

The scheduler is a long-running process and must outlive any browser:

```
  React SPA  ──→  API server  ──→  SQLite/PostgreSQL
                                        ▲
  Sync worker ──→ official sources ─────┘
```

Three processes: `npm run api`, `npm run worker`, and the built frontend. A
local `npm run worker` is a development convenience, **not** production
automation — production needs the worker supervised (systemd, a container
restart policy, or a platform scheduled job). The browser never fetches a
government site; it only reads the API or the bundled dataset.

---

## Current Government

`/government`, between Home and Directory. It answers one question — *who
currently holds the major national offices* — while the Directory answers
*who is in the record at all*.

### It is derived, not maintained

There is no `current_government` table, no curated list and no hand-edited
JSON. The page calls `deriveCurrentGovernment()`, which computes membership
from canonical positions that **have not ended**. When the Cabinet Office
stops listing someone, the next sync writes an end date on their position and
they leave the page — with no code change, no redeploy and no file edit.

The same function serves the API over database rows and the browser over the
bundled dataset. One definition, two callers: without that, this page and a
person's Political Career tab could disagree about the same portfolio.

```
GET /api/government/current
```

Returns person **ids and slugs**, not duplicated person records — every card
links to the one canonical profile at `/person/<slug>`.

### What it shows

President · Prime Minister · Cabinet · Deputy Ministers · State Ministers ·
Parliamentary leadership. A section with no data is **not rendered**: the
Cabinet Office publishes no State Minister roster, and an empty heading would
imply there are none rather than that no source lists them.

Ordinary parliamentary membership is deliberately excluded — 225 sitting
members is the Directory's job.

### Two things it gets right that are easy to get wrong

**One person, one section.** The Prime Minister also holds an education
portfolio; she appears once, under Head of Government, with both offices on
her card — not twice.

**One office, one row.** Parliament publishes the appointment *date*; the
Cabinet Office publishes that the office is *currently held*. Both describe
the same ministry and arrive as two rows with different ids. They are merged,
keeping the row that carries a real date, so "Prime Minister" is not printed
twice on the Prime Minister's card.

### Freshness is reported, never invented

The status line shows only timestamps from checks that actually succeeded, and
says "not yet checked" otherwise. If one source is stale or failing, the page
says so per source rather than claiming the whole dataset is fresh — or
blanking the Cabinet.

---

## Data coverage

Run `node scripts/coverage-report.mjs` to regenerate this from the data itself.

| | Count | Note |
| --- | ---: | --- |
| People | 225 | every one a sitting MP |
| Current MPs | 225 | the full Parliament |
| Historical MPs | 0 | Past Members directory not imported |
| Cabinet Ministers | 22 | |
| Deputy Ministers | 32 | |
| Prime Minister / Speaker / Dep. Speaker / Opp. Leader | 1 / 1 / 1 / 1 | |
| Other parliamentary offices | 3 | Chief Government Whip, Leader of the House, Deputy Chairperson |
| Total positions | 286 | |
| Political parties | 13 | derived from the source |
| Districts (incl. National List) | 23 | |
| Elections | 0 | Election Commission not connected |
| Source-evidence records | 511 | 100% cite a specific document URL |
| Conflicts needing review | 2 | see below |
| Unresolved identity matches | 0 | single source; all matched on member id |

**Field completeness** — name, party and district 100%; date of birth 95% (213/225); profession 68% (152/225); academic qualifications 78% (175/225); **position start dates 100% (639/639)**, read from each member's Legislative History and Ministerial Services.

### The two conflicts

Both are National List members whose *own profile page* names a territorial district while the directory lists them under "National List":

- **R. M. Ranjith Madduma Bandara** — directory: National List · profile: Monaragala
- **Ravi Karunanayake** — directory: National List · profile: Colombo

Both pages are official. SL Politics does not pick a winner: the claim is marked `conflicting` and the disagreement is shown. This was found by cross-checking every member against two independent pages of the source — 225 checked, 2 disagreements.

### What this dataset is *not*

- **Not "all politicians in Sri Lanka".** It is the 225 sitting MPs.
- **The President is absent.** The head of state is not a member of Parliament, so he does not appear in this source. He will require the Presidential Secretariat connector.
- No former members, election results, party histories, qualifications or dated career events.
- **Nothing is verified.** See [Verification states](#verification-states).

---

## The Parliament importer

```bash
node scripts/import-parliament.mjs               # listing only (~30 requests)
node scripts/import-parliament.mjs --profiles    # + each member's profile (~255 requests)
node scripts/coverage-report.mjs                 # what actually landed
```

It runs in Node, deliberately — see [the worker note](#synchronisation-foundation) for why the browser must not do this. `robots.txt` was checked before anything was retrieved (it disallows only `/adminpanel`, `/api`, `/preview`); requests are issued one at a time with a delay, and the profile pass is opt-in.

Three things this importer learned the hard way, each now encoded in the code:

**1. Hash the parsed data, not the bytes.** Every page of the directory embeds a freshly generated CSRF token, so byte-identical content hashes differently on every request. A raw-bytes hash would report "changed" on every check forever and fill the audit trail with change events that never happened. The snapshot therefore carries a *semantic* `contentHash` over the canonically ordered parsed rows — verified stable across two independent full fetches — alongside the raw hash, which is recorded and explicitly flagged `rawHashIsStable: false`.

**2. "and" is not a delimiter.** Roles arrive as compound strings — `"Minister of Labour and Deputy Minister of Finance and Planning"` is two offices, but `"Minister of Ports and Civil Aviation"` is one. Splitting naively on `" and "` would invent public offices that do not exist. `splitCompoundRole` splits only where the text after `" and "` begins with an explicit office-starter (`Minister of`, `Deputy Minister of`, `Chief Government Whip`, …), and every one of the 56 distinct role strings the source publishes is pinned as a test.

**3. The source's own placeholders are not data.** Profession reads `"---"` for members who have none recorded; that becomes `null`, not a profession called "---".

### What is deliberately not imported

Profile pages also publish each member's **home address, personal telephone numbers and email**. SL Politics is a record of public office, not a contact database, and republishing 225 residential addresses carries real-world risk for no product benefit. The parser does not read those fields at all.

---

## Identity resolution

Names are not a reliable join key: Sri Lankan records transliterate inconsistently across English, Sinhala and Tamil, and attach varying honorifics and initials.

`resolveIdentity()` returns a confidence level, and **only an exact external-ID match from the same source is auto-mergeable**:

| Confidence | Signal | Auto-merge |
| --- | --- | --- |
| `exact` | Same external ID, same source | ✅ |
| `probable` | Name match + matching date of birth | ❌ review |
| `uncertain` | Name or initials alone, or a DOB conflict | ❌ review |
| `none` | No signal | — |

Wrongly merging two politicians is far worse than leaving a duplicate for a human to resolve.

---

## Search

The primary search box (`components/SearchTypeahead.jsx`, on the home page) is a name/alias/party/role/district combobox: suggestions appear as you type, without pressing Enter, and selecting one navigates straight to that person's profile — there is no separate search-results page.

It matches on **token prefixes** across every indexed form of a person — canonical name, Sinhala/Tamil name where recorded, aliases, current office title, party name and abbreviation, and district — so `"anura"`, a surname alone, an alias like `"AKD"`, a party abbreviation like `"npp"`, or a role fragment like `"prime"` all resolve correctly. The matching itself lives in `lib/identity.ts` (`matchesQuery`); the typeahead calls through `services/repository.ts` (`suggestPeople`), which is the seam a real search API replaces later without the component changing.

The interaction logic (what the arrow keys, Enter, and Escape each do) is pulled out into pure functions in `lib/typeahead.ts` specifically so it can be unit-tested without a DOM renderer — this project has no `jsdom`/React Testing Library dependency (see [Testing](#testing)), so keeping that logic framework-free was the way to actually test it rather than assert it works.

The directory page's own search box filters the visible grid live as you type; that full result grid *is* its suggestion list, so it doesn't duplicate the dropdown pattern.

---

## Testing

```bash
npm test
```

**696 tests across 39 files** (693 passing, 3 skipped), all pure/unit-level (no DOM renderer is set up — see [Search](#search) for why), covering:

- **Dates** — full/month/year precision, leap years, calendar-invalid input, age, age at death, tenure, open intervals, and regression tests pinning the partial-date fix.
- **Positions** — current, ended, future, historical, overlapping and reappointment cases; headline-office selection; invalid date ranges.
- **Verification** — all three enforcement rules, in both dataset modes, including the institution-only evidence downgrade.
- **Identity** — normalisation across scripts, honorifics, punctuation; auto-merge only on external IDs; DOB conflict detection.
- **Search** — exact, partial, alias, punctuation, case, prefix, surname-only and party/role matching; a regression test that single-letter terms do not match every record; typeahead keyboard/selection behaviour (arrow-key wrapping, Enter with and without a highlighted suggestion, Escape).
- **Filters** — each facet, conjunctive combination, OR within a facet, and facet counts computed against other facets.
- **Repository (against the real import — 1,624 people, of whom 226 are currently serving)** — full membership loaded, unique ids and slugs, every person anchored on the source's member id, no honorific left in a name or slug, every member an MP, compound roles split into separate positions, every position classified without falling back to "other", every claim citing a specific document, nothing marked verified, the two real conflicts surfaced, pagination, ranking.
- **Parliament connector** — all six real compound role strings split correctly; strings that must *not* split (ministry names containing "and", "Deputy Speaker and the Chair of Committees"); stacked, bare and parenthesised honorifics; post-nominals; the source's irregular whitespace; validation including cross-page conflict detection.
- **Idempotent import** — deterministic ids; import → import again creates nothing and emits no change events; a changed field produces exactly one `ChangeEvent` with the previous value; stability across five runs; semantic vs raw hashing.
- **Corrections** — validation rules, rejection of homepages and dangerous URL schemes, payload shape.
- **Routing** — route matching, unknown paths resolving to 404, legacy URL redirects (including the retired Parties/Elections/Sources pages redirecting to the directory rather than 404ing).
- **Sync foundation** — unchanged-source no-op, duplicate-import prevention, the history-preserving position update, conflicting-source detection, snapshot history, identity review queueing.
- **End-to-end synchronisation against a real database** (`server/sync/syncSource.test.ts`) — initial import; re-running an unchanged source writing nothing; stability across five runs; **the portfolio change**: old position preserved with an end date, new position current, the two linked, a change event created, the snapshot hash moved, no duplicate person, and idempotent afterwards; reappointment reopening rather than duplicating; a new member appearing; a partial run not erasing fields it did not fetch; and source-unavailable leaving canonical data untouched while recording the failure.
- **Reconciliation and authority** — per-fact-type ranking, refusal to choose between equal-rank sources, cosmetic differences treated as agreement, same-office-different-label resolved, genuinely different portfolios kept apart, losing claims retained.
- **API queries** — pagination, server-side filtering, headline ranking, derived currency, typeahead ranking, and a quoted search term binding as a parameter rather than reaching SQL.

---

## Synchronisation foundation

The product goal is that when an official source changes — a minister's portfolio, say — SL Politics detects it, validates it, and updates the profile **without erasing the old record**:

```
OFFICIAL SOURCE
  → CONNECTOR          fetch, honouring robots/rate limits         — IMPLEMENTED for Parliament and
                                                                     the Cabinet Office (server/fetchers/)
  → SNAPSHOT           hash + retrieval record                      — implemented (`sync/snapshot.ts`)
  → CHANGE DETECTION   hash comparison against the previous snapshot — implemented (`sync/pipeline.ts`)
  → NORMALISATION      into the canonical model                     — implemented per connector (src/sync/connectors/)
  → ENTITY RESOLUTION  external IDs first; names never auto-merge   — implemented (`lib/identity.ts`, `sync/identityReview.ts`)
  → VALIDATION         schema + data-quality rules                  — enforced in code (`lib/verification.ts`)
  → CONFLICT DETECTION against current canonical values              — implemented (`sync/pipeline.ts`, `sync/positionUpdate.ts`)
  → UPDATE             history-preserving, never in place            — implemented (`sync/positionUpdate.ts`)
  → WEBSITE                                                          — implemented (this app)
```

**Be precise about what that means.** Two connectors are real and have genuinely retrieved their sources (Parliament and the Cabinet Office), the reconciliation logic is real and tested, and both the database and the worker that writes to it exist — `.data/javora.db`, three migrations, 29 tables. What is **not** running is the schedule: every interval defaults to `0`, so a checkout syncs nothing until a deployment sets one. Concretely:

- `sync/pipeline.ts` — the `SourceConnector` interface a real connector implements; `server/fetchers/parliamentConnector.ts` and `cabinetConnector.ts` implement it, and the browser-side `fetch()` deliberately throws, because retrieval belongs to the server-side worker and never to a reader's tab. Also `detectChange()` comparing content hashes; `isDuplicateImport()` so a re-check that finds nothing new doesn't write duplicate history; `detectFieldConflict()` for when sources disagree.
- `sync/positionUpdate.ts` — `planPositionUpdate()`, the direct implementation of the worked example above: given a person's currently open position and an incoming fact, it decides `no-op` (nothing changed), `open-new` (first record for this slot), `close-and-open` (the old position gets an `endDate`, a *new* position is opened — the old one is never edited in place), or `flag-conflict` (sources disagree, or there's no date to close the old record on — it will not guess one).
- `sync/identityReview.ts` — turns an uncertain `resolveIdentity()` match into a review-queue item, so a probable-but-not-certain match surfaces for a human instead of being silently merged or silently dropped.

### Sync state, stated honestly

`SyncState` gained a fifth value, `manual-import`, because none of the existing four could describe the truth about Parliament: a real, working connector that has genuinely retrieved the source, but which a person runs by hand. Calling that `live` would claim an automation that does not exist; calling it `not-connected` would deny a retrieval that demonstrably happened.

So `S001` (Parliament) reads `manual-import` and carries **real** `lastCheckedAt`/`lastSuccessfulSyncAt` timestamps from the actual retrieval. `S002`–`S006` read `not-connected` with null timestamps. Nothing is back-filled to look active.

**Automatic syncing is implemented, and off by default.** The scheduler is `server/scheduler/schedule.ts` and the worker is `server/scheduler/worker.ts`. `IMPLEMENTED_CONNECTORS` is `{S001 Parliament, S006 Cabinet Office}`, and every source's interval defaults to `0`, which disables it. `isAutomaticSyncOperational()` returns true only for a source that has both an implemented connector and a positive interval — so a default checkout reports `false` truthfully, and setting `PARLIAMENT_SYNC_INTERVAL` / `CABINET_SYNC_INTERVAL` (see `.env.production.example`) makes it genuinely true.

---

## Known limitations

Stated plainly, because the platform's premise is not overstating what it knows.
**Verified against the code and the dataset on 31 August 2026** — every figure below
was counted, not remembered.

1. **Two sources are connected.** Parliament (S001) and the Cabinet Office (S006) — `IMPLEMENTED_CONNECTORS` in `server/scheduler/schedule.ts`. Four are not; see [Source connectors](#source-connectors) for the specific reason each is unavailable.
2. **No automatic synchronisation is running.** The worker and scheduler are real and tested, but every interval defaults to 0. Nothing syncs until someone enables it.
3. **Nothing is verified.** No claim is in state `verified`. Of 6,649 recorded positions, 6,612 are `source-linked` — citing the exact official page they came from — and 37 are `conflicting`, where two sources disagree and the disagreement is shown rather than resolved. Nobody has confirmed SL Politics read those pages correctly.
4. **PostgreSQL is a read accelerator with no refresh mechanism, and is not continuously verified.** `deploy/README.md` records a validated 3,230-row migration, and the cross-engine parity test in `server/api/queries.postgres.test.ts` is real — but it skips unless `DATABASE_URL_TEST` is set and is the one skipped file in the default suite. Separately, only the worker writes canonical data and it writes SQLite only, so a Postgres copy goes stale at the next sync. `deploy/docker-compose.yml` therefore leaves it disabled.
5. **The React app still reads bundled data by default.** The API works and the client exists; `VITE_API_URL` switches it. The bundled path remains the default so the frontend runs without a backend.
6. **Historical membership is imported, and is only as deep as the source.** The Past Members directory is loaded: 1,398 former members, merged onto sitting records by shared Parliament id, with the earliest office beginning in 1931. What it does not give is completeness — an office the directory does not list does not appear, and 56 positions have a start date but no recorded end.
7. **No election records.** The model and authority rules exist; no connector does.
8. **~~No position start dates.~~** Fixed. Parliament publishes per-member service dates in the Legislative History and Ministerial Services panes. Across the current 6,649 positions, 6,279 carry both a start and an end date, 314 are open and explicitly ongoing, and 56 are open with the end simply unrecorded — rendered "end not recorded", never "Present". `current_as_of` is now used by nothing, which is the correct end state for a fallback.
9. **Identity review and conflict queues have no UI.** Both are recorded in the database and covered by tests; nothing renders them for a reviewer.
10. **Corrections cannot be submitted.** The form validates and produces the exact payload the API will accept; there is no write endpoint, by design — canonical data is written only by the sync worker.
11. **Party affiliation has no dates.** The source gives one current party and no joining date.
12. **Sinhala and Tamil names are absent.** The source publishes English only; none were machine-transliterated to fill the gap.
13. **Portraits are hot-linked** to parliament.lk with credit shown, not copied into this repository. If parliament.lk is unreachable, every avatar degrades to a monogram.
14. **~~SEO metadata is client-rendered.~~** Fixed. `scripts/prerender.mjs` renders every route in `lib/routeManifest.ts` to static HTML at build time — 1,628 pages plus `sitemap.xml`, `robots.txt`, `404.html` and generated CSP — so titles, canonicals, Open Graph tags and JSON-LD are in the served markup before any JavaScript runs.
15. **No component-level UI tests.** Interaction logic is extracted to pure functions and tested there; components are verified manually in the browser.

### What the next connector should be

**The Election Commission**, because it is the largest remaining gap in what the model already describes: `Election` and `Candidacy` types exist, `allElections()` and `allCandidacies()` are the declared seam in `services/repository.ts`, and per-fact-type authority already names the Commission as primary for results. Nothing else on the site can answer how someone came to hold an office.

The two connectors this section previously named next are done. The Past Members directory is imported (1,398 former members). The President is present through the Cabinet Office connector, so the Presidential Secretariat is now an enrichment rather than a gap — it still returns 403 to programmatic requests, and establishing whether it can be read at all remains the first task if it is attempted.
# SL-Politics-by-Javora
# SL-Politics-by-Javora
