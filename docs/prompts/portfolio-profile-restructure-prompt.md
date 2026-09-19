# Information-architecture restructure - /person/harsha-de-silva (PortfolioProfile only)

Copy-paste prompt for Claude Code. Run from the repo root. Paste everything below the line.

---

Restructure the section order and visual weight of exactly one page: the portfolio profile at
`http://127.0.0.1:5173/person/harsha-de-silva` (`npm run dev`), rendered by
`src/pages/PortfolioProfile.jsx` + `src/pages/PortfolioProfile.css`.

This is an **information-architecture pass, not a content pass and not a restyle.** You are
moving, grouping, collapsing and de-emphasising existing content according to a fixed priority
model. You are not rewriting claims, adding data, or inventing a new visual language.

## Step 0 - safety, before you read anything else

1. Run `git status` and `git diff --stat` and show me the output. The working tree currently has
   large **uncommitted** changes to `PortfolioProfile.jsx`, `PortfolioProfile.css`,
   `harshaDeSilva.ts`, `profileContent.ts`, `icons.jsx`, and **10 deleted files under `docs/`**.
   This repo has **no git remote**, so uncommitted work exists nowhere else.
2. **Do not** run `git checkout`, `git restore`, `git stash`, `git reset`, or commit anything on
   your own. Ask me whether to make a WIP checkpoint commit first, and wait for my answer.
3. Do not restore or touch the deleted `docs/*.md` files. Just list them back to me so I can
   decide separately.
4. Read `CLAUDE.md` fully. Its invariants apply to this task.

## Step 1 - plan mode first

Enter plan mode. Read `PortfolioProfile.jsx`, `PortfolioProfile.css`, `src/data/profileContent.ts`
(the `PortfolioProfileContent` contract), `src/data/harshaDeSilva.ts` (read-only),
`src/pages/PersonPage.jsx`, `src/pages/PersonPage.test.jsx`, `src/components/Tabs.jsx`, and
`src/lib/prerenderContent.test.ts`.

Then present to me, **before editing any file**:
- the mapping table below, filled in with the real component names and line numbers you found;
- the final page outline (heading text, heading level, number, section id, open/collapsed state);
- the list of CSS rules you expect to add, change, or delete.

Wait for my OK.

## The priority model (source of truth for every decision)

Each block has an importance score for a citizen making a voting decision. Higher = more central.
**Scores and tier letters are internal. Never render them on the page.**

| Tier | Score | Block | Treatment |
|---|---|---|---|
| A - core accountability triad | 95 | Performance / outcome indicators | Visible, expanded, first evidence on the page |
| A | 94 | Voting & decision record | Visible, expanded, directly after outcomes |
| A | 91 | Promises & outcomes | Visible, expanded, directly after votes |
| B - supporting evidence | 82 | Hero / identity | Top of page, but **compact** (it frames, it does not dominate) |
| B | 79 | Responsibility & attribution | Visible, immediately after the triad (it tells readers how far to credit/blame) |
| B | 78 | Programmes & interventions | Visible |
| B | 76 | Policies & public positions | Visible |
| C - useful, compressed | 68 | Position & responsibilities | Short, visible summary only |
| C | 57 | Detailed position & responsibilities | Collapsed by default |
| C | 48 | Portfolio at a glance | No longer its own section; folded into the hero as one meta line |
| D - research layer | 42 | Research notes & historical context | Collapsed, bottom evidence layer |
| D | - | Sources | Collapsed, bottom evidence layer (credibility infrastructure) |

Rule of thumb when something is unclear: **a lower-scored block must never sit above, or take more
default screen space than, a higher-scored block**, except the hero, which is physically first but
must stay compact.

## Current state (what is wrong)

Verify each of these against the code; tell me if any is no longer true.

1. **Two of the three Tier A blocks are hidden behind a non-default tab.** Voting record (94) and
   Promises (91) live in the `record` tab; only Outcome indicators (95) is in the default
   `performance` tab. A reader who never clicks "Record" never sees the voting record.
2. **Portfolio at a glance (48) is a full numbered section** between hero and tabs, and it repeats
   Role and Term that the hero already shows.
3. **Attribution (79) sits after Programmes (78)** and is separated by a tab from the votes and
   promises it qualifies.
4. **Tier C background gets a whole tab with four numbered sections** (Career summary, Position and
   responsibilities, Education, Institutions), the same weight as the accountability record.
5. **Section numbering restarts at "01" five times** (meta strip plus each tab), so the numbers
   carry no meaning.
6. `SourceRefs` links (`#hds-source-*`) point into the Sources `<details>`, which is closed by
   default. Following a link must reliably land on a visible, highlighted source row.

## Current component -> new location map

| Score | Current component(s) | Currently in | New home |
|---|---|---|---|
| 82 | hero `<section>` | top | top, compact (unchanged content) |
| 48 | `MetaStrip` | own section, "01 Portfolio at a glance" | **delete as a section**; portfolio areas + "N institutions · N source records" become one meta line inside the hero. Do not repeat Role/Term (hero already has them). No h2. |
| 95 | `OutcomeIndicators` | Performance tab, 01 | Group A, section 01 |
| 94 | `VotingRecordSection` (keep its Year/Evidence filter state exactly) | Record tab, 01 | Group A, section 02 |
| 91 | `PromisesSection` | Record tab, 02 | Group A, section 03 |
| 79 | `AttributionNote` | Performance tab, 03 | Group B, section 04 |
| 78 | `MajorProgrammes` (both groups: `programmes` and `programmeInterventions`) | Performance tab, 02 | Group B, section 05 |
| 76 | `PoliciesTab` content | Policies tab, 01 | Group B, section 06 |
| 68 | `PositionsAndResponsibilities`: Role summary + Scope cards only | Profile tab, 02 | Group C, section 07, visible |
| 57 | `CareerSummary`, positions list + "Documented responsibilities" (currently inside `PositionsAndResponsibilities`), `Education`, `Institutions` | Profile tab, 01/02/03/04 | Group C, one collapsed `<details>` under section 07, unnumbered |
| 42 | `ResearchNotesDisclosure` | foot of Profile tab | Group D, collapsed |
| - | Sources `CollapsibleSection` | after tabs | Group D, collapsed, last |
| - | Record status line | page foot | page foot, unchanged |

Education and Institutions have no score of their own. They are background detail, so they go
inside the Tier C collapsed block.

## Target page outline

```
HERO (compact)
  portrait · eyebrow · h1 name
  Focus role · tenure
  focus note
  meta line: portfolio areas · N institutions · N source records     <- was "Portfolio at a glance"
  <details> Why this role?

ON THIS PAGE (plain <nav aria-label="On this page">, anchor links, not sticky)
  Accountability record · Context · Role & background · Evidence & sources

GROUP A - "Accountability record"            (always expanded)
  h2 01 Outcome indicators                    id="hds-outcomes"
  h2 02 Voting & decision record              id="hds-votes"      (filters unchanged)
  h2 03 Promises & outcomes                   id="hds-promises"

GROUP B - "Context for the record"           (always expanded)
  h2 04 Attribution & limitations             id="hds-attribution"
  h2 05 Major programmes and interventions documented during {name}'s tenure   id="hds-programmes"
  h2 06 Policy positions                      id="hds-policies"

GROUP C - "Role & background"                (compressed)
  h2 07 Position and responsibilities         id="hds-role"   Role summary + Scope only
  <details> Full career record                id="hds-career-detail"  (closed)
      career summary facts · positions held · documented responsibilities · education · institutions

GROUP D - "Evidence & research"              (collapsed layer)
  <details> Research notes & historical context   id="hds-research"  (closed, unnumbered)
  <details> Evidence & sources                    id="hds-sources"   (closed, unnumbered)

Record status
```

Group labels ("Accountability record", etc.) are quiet visual labels that introduce each group.
Pick one consistent markup for them and justify it in the plan (for example a small styled `<p>`
above the group's first h2, or a wrapping `<section aria-label>`), but **do not add an extra
heading level that pushes the real section headings down to h3.** Section headings stay `h2`,
subheadings inside them stay `h3`, one `h1` on the page.

Group A must not be visually louder than necessary: same card and table styles it already has.
The hierarchy comes from **order and default-open state**, not from new colours, badges, or bigger
type. Group C and D should read clearly quieter (already-existing muted/de-emphasised styles), not
hidden or faded to the point of looking disabled.

## Hard constraints

**Content**
- Move content, do not rewrite it. **No string in `src/data/harshaDeSilva.ts` changes.** No claim,
  caveat, verification status, evidence status, citation token, or source is added, removed,
  softened, strengthened, or merged.
- Keep `programmes` and `programmeInterventions` as **two separate groups** inside section 05. The
  comment in the code explains why: they are two different research passes and must not be blended
  into one list.
- `profileContent.ts`: the `PortfolioProfileContent` type should not need to change. If you believe
  it does, argue for it in the plan first.
- The component stays generic. Every visible string still comes from `content` except structural
  labels (group labels, nav labels, "Full career record"). No Harsha-specific strings in JSX.
- New visible copy you add (group labels, nav text, summary text) uses **no em-dash or en-dash**,
  per `docs/portfolio-profile-anti-slop-prompt.md`.

**Prerender / crawlability (CLAUDE.md invariants)**
- Everything must be in the prerendered HTML. Collapsed means native `<details>` or the `hidden`
  attribute, **never** `{open ? children : null}` or array slicing. This is the same bug class the
  `TabPanel` and `DirectoryPage` invariants exist for.
- Remove the `Tabs`/`TabPanel` usage and the `PORTFOLIO_TABS` constant from this page, and remove
  the now-unused import. **Do not modify `src/components/Tabs.jsx` or `src/lib/profileTabs.ts`**;
  other profiles use them.
- Rewrite the large doc comment at the top of `PortfolioProfile.jsx` so it describes the new
  tiered single-scroll structure. The current comment describes the four-tab architecture and would
  be false after this change. Remove other comments that reference tabs that no longer exist.

**Tests that pin this page**
- `src/pages/PersonPage.test.jsx` asserts the HTML contains `"hds-profile"`,
  `"Major programmes and interventions documented during"` and `"Position and responsibilities"`.
  Keep those strings. Do not weaken those assertions.
- Add assertions to that file (renderToString, no new test libraries) that:
  1. the index of "Outcome indicators" < "Voting & decision record" < "Promises & outcomes" <
     "Attribution & limitations" < "Major programmes and interventions documented during" <
     "Policy positions" < "Position and responsibilities" < "Research notes" < "Evidence &amp; sources"
     in the output HTML (check the actual escaped form React emits);
  2. text from inside the collapsed blocks (one research note label, one source organisation, one
     education entry) is still present in the HTML;
  3. the string `Portfolio at a glance` no longer appears, and no `role="tablist"` is rendered by
     this page.

**Behaviour**
- Voting record filters keep working exactly as now ("N of M records shown" updates live).
- `SourceRefs` fragment links: when a `#hds-source-*` link is followed (click, or loading the page
  with that hash), the Sources `<details>` must be open and the row scrolled into view with the
  existing `:target` highlight. Implement as a small progressive enhancement (for example set
  `open` on the closest `<details>` on click and on mount if `location.hash` matches). Without JS
  the page must still render all content. Must be SSR-safe (no `window` access during render).
- Section ids are new (`hds-outcomes`, etc.). Grep the repo (`src`, `scripts`, `docs`) for the old
  ids (`hds-perf-s0`, `hds-record-s0`, `hds-policies-s0`, `hds-profile-s0`, `hds-tab`,
  `hds-meta-heading`) and report any references outside `PortfolioProfile.jsx`/`.css`.
- Give every section target `scroll-margin-top` using an existing space token so nav jumps do not
  land under the header.
- Keep existing motion; respect `prefers-reduced-motion` exactly as the file already does. Do not
  add new animations in this pass.

**CSS**
- Use existing tokens only (`src/styles/tokens.css`). Invent no raw px/colour/duration values.
- Delete CSS that becomes dead (the scoped `.tabs`/`.tabs__tab` override, tab-panel spacing,
  meta-strip section rules if no longer used). The header comment of `PortfolioProfile.css` also
  describes the four-tab layout; update it too.
  Reuse the existing meta-grid styling for the hero meta line if it fits; otherwise say why.
- Do not undo the earlier typography, anti-slop, or motion passes on this page (see
  `docs/portfolio-profile-*-prompt.md`). If one of your changes conflicts with one of those,
  stop and tell me.
- Check the layout at **1280px, 768px and 400px wide**. At 400px the first Tier A section heading
  should be reachable with a short scroll, not buried under the hero.

## Scope - hard boundary

Editable:
- `src/pages/PortfolioProfile.jsx`
- `src/pages/PortfolioProfile.css`
- `src/pages/PersonPage.test.jsx` (add assertions only)

Read-only: `CLAUDE.md`, `src/data/harshaDeSilva.ts`, `src/data/profileContent.ts`,
`src/pages/PersonPage.jsx`, `src/components/**`, `src/lib/**`, `src/styles/**`, `docs/**`.

Do not touch: `DecisionProfilePrototype.jsx`/`.css`, `profile-decision.css`, any other page, the
router, `routeManifest.ts`, `repository.ts`, i18n files, `server/**`, `scripts/**`, `.data/**`,
`package.json`. **Add no dependencies.** Keep `.jsx` as `.jsx`. Relative imports keep explicit
file extensions. Never run any `db:*` or `sync*` script.

## Step 2 - implement

Work in this order, running `npm test -- PersonPage` after each step:
1. Add the new ordering assertions to `PersonPage.test.jsx` first and confirm they **fail** against
   the current page.
2. Restructure the JSX: remove tabs, fold MetaStrip into the hero, lay out groups A to D, renumber
   01 to 07, new ids, collapsed Tier C block, Tier D layer.
3. Sources fragment-link auto-open enhancement.
4. CSS: group spacing, group labels, hero meta line, quiet treatment for C and D, delete dead rules.
5. Update the top-of-file doc comment and stale inline comments.

## Step 3 - verify (all must pass before you say "done")

1. `npm test` (whole suite, not just this file), `npm run lint`, `npm run typecheck`.
2. `npm run dev`, open `/person/harsha-de-silva`, and check at 1280 / 768 / 400px: section order,
   collapsed states, nav anchors, voting filters, a `Sources NN` link opening and highlighting its
   row, keyboard tab order through the page, and light + dark theme.
3. Production truth (dev does not prerender):
   `VITE_SITE_ORIGIN=https://javora.lk npm run build`, then `npm run serve:dist` and, in another
   shell, `npm run validate:crawlability`. It must stay at every URL passing. Also `curl` the
   prerendered `/person/harsha-de-silva` and confirm the voting record table, a research note and a
   source organisation are in the raw HTML.
4. Heading audit: list every `h1`/`h2`/`h3` on the page in DOM order with its number. No skipped
   levels, one `h1`, numbers 01 to 07 with no repeats.

## Step 4 - report back

- Before/after outline (two short lists).
- Table: each block, its score, where it was, where it is now, default open/closed.
- Files changed with a one-line reason each, and dead CSS removed.
- Test/lint/typecheck/crawlability results with counts.
- Anything you could not do, anything you think the priority model gets wrong for this page, and
  any conflict you found with `CLAUDE.md` or the earlier page prompts. Do not silently resolve
  those; tell me.
- Do not commit. I will review the diff first.
