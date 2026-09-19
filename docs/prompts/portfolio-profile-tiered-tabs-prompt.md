# Rebuild /person/harsha-de-silva into four tier tabs, with the reference tables restored

Copy-paste prompt for Claude Code. Run from the repo root. Paste everything below the line.

**This supersedes `docs/portfolio-profile-restructure-prompt.md`.** That document removes the tabs
and turns the page into one long scroll. Do not follow it. The tabs stay.

---

Rebuild exactly one page: the portfolio profile at `/person/harsha-de-silva`, rendered by
`src/pages/PortfolioProfile.jsx` + `src/pages/PortfolioProfile.css`, with content from
`src/data/harshaDeSilva.ts` (contract: `PortfolioProfileContent` in `src/data/profileContent.ts`).

The last pass got two things wrong:

1. **Presentation.** Every section was flattened into generic cards. The reference layout (the
   screenshots I am describing below) uses proper evidence **tables** with fixed columns, badges
   under the row title, citation tokens under the evidence cell, and a Details control per
   programme row. Cards hide the comparison a voter needs to make across rows.
2. **Structure.** Sections were grouped under the tabs inconsistently, numbering restarts at 01 in
   every tab, and several blocks (Education, the second institutions list, attribution) landed in
   places that do not match what the tab name promises.

This is a **structure and presentation pass, not a content pass.** You move and re-present
existing content. You do not rewrite claims, add facts, or invent sources.

## Step 0 - safety, before anything else

1. Run `git status` and `git diff --stat` and show me the output. The working tree has large
   **uncommitted** changes to `PortfolioProfile.jsx`, `PortfolioProfile.css`, `harshaDeSilva.ts`,
   `profileContent.ts`, `icons.jsx`, and **10 deleted files under `docs/`**. There is **no git
   remote**, so this work exists nowhere else.
2. Do **not** run `git checkout`, `git restore`, `git stash`, `git reset`, or commit on your own.
   Ask me whether to make a WIP checkpoint commit first and wait for my answer.
3. List the deleted `docs/*.md` files back to me. Two of them,
   `docs/data-model-principles.md` and `docs/corrections-security-design.md`, are referenced by
   `CLAUDE.md` as load-bearing. Point that out explicitly. Do not restore anything yourself.
4. Read `CLAUDE.md` fully. Its invariants apply.

## Step 1 - plan mode first

Enter plan mode. Read: `PortfolioProfile.jsx`, `PortfolioProfile.css`, `harshaDeSilva.ts`,
`profileContent.ts`, `src/components/Tabs.jsx`, `src/pages/PersonPage.jsx`,
`src/pages/PersonPage.test.jsx`, `src/lib/prerenderContent.test.ts`, `src/styles/tokens.css`,
`docs/portfolio-profile-anti-slop-prompt.md` and `docs/portfolio-profile-typography-prompt.md`.

Present to me **before editing any file**:
- the section map below, filled in with the real component names and line numbers;
- the final outline (tab, heading text, number, id, element: table / cards / details);
- the column spec for every table;
- every place where this prompt, the data file and the earlier page prompts disagree
  (see "Known conflicts" below, and add any you find);
- the CSS rules you will add, change and delete.

Wait for my OK.

## Target structure (locked - I chose this)

```
HERO                                        unchanged content
PORTFOLIO AT A GLANCE                       compact strip, UNNUMBERED, stays above the tabs
                                            (harshaDeSilva.ts summaryNote says "the Portfolio at
                                            a glance panel above", so it must exist and be above)

TAB BAR  role="tablist"  4 equal columns
  TIER A  Performance   (default)
  TIER B  Record
  TIER C  Policies
  TIER D  Profile

TIER A - Performance
  01  Performance / outcome indicators                         table    id="hds-outcomes"
  02  Promises & outcomes                                      cards    id="hds-promises"
  03  Major programmes and interventions documented during
      {name}'s tenure                                          table    id="hds-programmes"
  04  Programmes & interventions                               table    id="hds-interventions"

TIER B - Record
  05  Voting & decision record                                 table    id="hds-votes"
  06  Responsibility & attribution                             3 cards  id="hds-attribution"

TIER C - Policies
  07  Policies & public positions                              table    id="hds-policies"

TIER D - Profile
  08  Position and responsibilities                            cards    id="hds-role"
  09  Detailed position & responsibilities                     grid + table + cards  id="hds-career"
      "Evidence layer" quiet label
  10  Research notes & historical context                      <details> closed  id="hds-research"

BELOW ALL TABS (always reachable, whatever tab is active)
  Evidence & sources                                           <details> closed  id="hds-sources"
  Record status                                                unchanged
```

Numbering is **continuous 01 to 10 in tab order**, never restarting. Tier letters and numbers
appear only in the tab bar and the section number box. Group A is not styled louder than the
others; hierarchy comes from tab order and the default tab.

## Section map (current component -> new home)

| # | Heading | Current component | Currently in | Data |
|---|---|---|---|---|
| - | Portfolio at a glance | `MetaStrip` | numbered "01" above tabs | `hero`, `portfolioAreas`, counts |
| 01 | Performance / outcome indicators | `OutcomeIndicators` (cards) | Performance, 01 | `outcomeIndicators` |
| 02 | Promises & outcomes | `PromisesSection` | Record, 02 | `promises` |
| 03 | Major programmes ... tenure | `MajorProgrammes` first half (cards) | Performance, 02 | `programmes`, `programmesIntro`, `evidenceNote` |
| 04 | Programmes & interventions | `MajorProgrammes` second half (cards, h3) | Performance, 02 | `detailedAnalysis.programmeInterventions` |
| 05 | Voting & decision record | `VotingRecordSection` | Record, 01 | `votingRecord` |
| 06 | Responsibility & attribution | `AttributionNote` ("Attribution & limitations") | Performance, 03 | `detailedAnalysis.responsibilityAttribution` |
| 07 | Policies & public positions | `PoliciesTab` ("Policy positions", cards) | Policies, 01 | `detailedAnalysis.policyPositions` |
| 08 | Position and responsibilities | `PositionsAndResponsibilities` (role + scope only) + `Institutions` first card | Profile, 02 / 04 | `responsibilities` |
| 09 | Detailed position & responsibilities | `CareerSummary` + positions list + documented responsibilities + `Institutions` second card + `Education` | Profile, 01 / 02 / 03 / 04 | `detailedAnalysis.careerDetail`, `education` |
| 10 | Research notes & historical context | `ResearchNotesDisclosure` | Profile, foot | `detailedAnalysis.researchNotes` |
| - | Evidence & sources | Sources `CollapsibleSection` | below tabs | `sources` |

**03 and 04 become two separate numbered sections.** They are two different research passes (the
code comment on `ProgrammeInterventionCard` explains why) and must never be merged into one list.

## Presentation spec per section

Use the existing table styles (`.hds-profile__table`, `.hds-profile__table-wrap`, `colgroup` col
classes) and the existing `≤900px` stacked-row pattern (`data-label` on every cell), which the
voting table already uses. Row title cells are `<th scope="row">`. Every table has a `<caption>`
(can be visually hidden) or `aria-labelledby` pointing at its section heading.

**Tab bar.** Four equal columns, centred text. Each tab shows a small uppercase sans eyebrow
("TIER A") above a larger serif label ("Performance", `--font-serif`). Inactive label muted, active
label full-contrast. Hairline rule above and below the bar. Active tab has a `--accent-gold`
underline spanning its column. Keep `Tabs.jsx` **unmodified**: `tab.label` is rendered as a React
child, so pass a node (eyebrow span + label span) from this page. The accessible name must read
"Tier A Performance". Rewrite the scoped `.hds-profile .tabs` override in the CSS for this look.
At 400px wide the four tabs must stay usable: pick either one horizontally scrollable row or a
2 x 2 grid and justify it in the plan. No sticky bar in this pass.

**Portfolio at a glance.** Compact, unnumbered, not an `h2` competing with the sections. Role,
Term, Portfolio, and the "N institutions · N source records" footer as today.

**01 Performance / outcome indicators - table.**
Columns: `Indicator` | `2015 / Baseline` | `Later reference point` | `What it tells the voter` |
`Attribution caution`. Verification badge sits under the indicator name in the first cell.
Citation tokens sit under the attribution caution text. Intro paragraph above the table.

**02 Promises & outcomes - card grid** (3 columns desktop, the only card section in Tier A).
Per card: title, then labelled fields Date, Expected outcome, Action taken, a bold
`Status: <value>` line, Documented outcome, Source (tokens, or `citeNote` as muted text).

**03 Major programmes ... tenure - table.**
Columns: `Programme / intervention` | `Type` | `Purpose` | `Longer-term outcome` | `Evidence` |
`Financial evidence` | `Effect on people`.
- First cell: title, with the muted `Sources 02 · 04 · 05` line (`SourceRefs`) under it.
- Longer-term outcome: small gold uppercase eyebrow `INTENDED EFFECT` (or `OUTCOME`), derived from
  `evidenceStatus` exactly as `ProgrammeCard` does today, then the text.
- Evidence: the `EvidenceStatusTag` pill.
- Above the table: `programmesIntro`, then one note explaining that the row source numbers here
  point at the numbered **Evidence & sources** list, which is a different numbering from the
  S-tokens used in the other sections. Below the table: the `evidenceNote` ("Not established
  means..."), plus one sentence that "Intended only" belongs to this table's five-value evidence
  scale and is not the same scale as the Verified / Partially verified / Claim / Derived /
  Unverified badges used elsewhere, with a link to `#hds-sources`. Do not use the word
  "prototype" in visible copy.
- Allow this table to be horizontally scrollable inside `.hds-profile__table-wrap` above 900px if
  seven columns cannot fit at the measure; below 900px it stacks like the others.

**04 Programmes & interventions - table.**
Columns: `Programme / intervention` | `Period` | `Documented role` | `Status / outcome` |
`Evidence` | (unlabelled action column, visually-hidden header "Details").
- Evidence cell: `VerificationTag` badge, citation tokens under it.
- **The Details button is currently dead** (`<button>` with no handler). A control that does
  nothing is a broken promise on a public record. Fix it properly:
  - Add an optional structural field `indicatorIds?: string[]` to `ProgrammeInterventionRow`
    (and to the contract if needed). This is a new *link* between existing rows, not new content;
    argue for it in the plan.
  - Proposed links, from exact title matches only: `pi1` (1990 Suwa Seriya) -> `oi4`, `oi5`;
    `pi2` (Enterprise Sri Lanka) -> `oi3`; `pi4` (Dambulla) -> `oi6`. `pi5` stays
    `hasDetails: false` -> muted "No further detail".
  - `pi3` (Food supply & distribution policy) has `hasDetails: true` but **no matching indicator
    row exists**. Do not invent one and do not guess. Stop and ask me. Until I answer, render it
    like a row with no detail.
  - Behaviour: `<button aria-expanded aria-controls>` toggles a full-width detail `<tr>` directly
    below the row that repeats the linked indicator rows (indicator, badge, baseline, later
    reference, attribution caution, tokens). The detail row is **always rendered** and hidden with
    the `hidden` attribute, never `{open ? ... : null}` (TabPanel invariant, CLAUDE.md). Also give
    each 01 table row an id (`hds-indicator-oi4` etc.) and a "See in 01" link in the detail row.

**05 Voting & decision record - table.** Keep the current table, filters and live
"N of M records shown" count exactly. Columns: `Date` | `Matter` | `Documented action` |
`Result` | `Evidence`. `actionCaveat` renders as muted text under the action. `scopeNote` below,
with "Record scope:" in bold if the data string starts with it (do not edit the string). Derive
the Evidence type filter options from the values present in `rows` instead of hard-coding
Verified / Claim, so a `partially-verified` row can never become unfilterable.

**06 Responsibility & attribution - 3 cards in a row.** Rename the heading from
"Attribution & limitations". Intro, then Political / Institutional / Implementation cards, each
with an uppercase sub-heading and body.

**07 Policies & public positions - table.**
Columns: `Issue` | `Position` | `Date` | `Evidence type` | `Evidence`. Evidence cell: badge, then
tokens, or `citeNote` as muted text when present.

**08 Position and responsibilities - cards.**
Row 1: `Role summary` card | `Portfolio institutions` card (`responsibilities.institutions`, two
column list on desktop). Row 2: full-width `Scope` card (`scope`, then `authorityNote` as muted
text; it is an existing caveat and must not be dropped even though the reference shot omits it).
Under the cards, a short muted footnote after a dashed rule: this portfolio-focused block is
separate from the five-status evidence badges used elsewhere, with a link to `#hds-sources`
whose text matches the real sources heading.

**09 Detailed position & responsibilities.**
- Intro (`careerDetail.intro`, which exists in the data but is not rendered today).
- Uppercase sub-heading `Full-career portfolio summary` (`summaryHeading`) + `summaryNote`.
- 4-column `<dl>` grid of `facts`: label + badge on one line, value + inline cite tokens below;
  list facts render as a bulleted list; note facts render muted. **Fix the grid gap bug:** the
  current grid leaves a large empty filled block beside "Years in office". Empty tracks must show
  the page background, not a panel colour (auto-fill / no background on the grid container).
- Uppercase sub-heading `Current & historical positions` (`positionsHeading`): a table with columns
  `Position` | `Institution` | `Period` (mono) | `Source`. Rows whose period starts with "Current"
  get a subtle highlighted row background from an existing surface token (replace the current
  `nth-child(odd)` zebra on `.hds-profile__position-row`, which highlights by position, not by
  meaning).
- Two cards side by side: `Documented responsibilities` (body + muted note) |
  `Portfolio institutions referenced in sources` (`institutionsReferenced`).
- `Education` as a small card or list at the end of 09. It is verified data (see the comment above
  `education` in the data file); it must not be dropped just because the reference shot has no
  Education block.

**10 Research notes & historical context.** A quiet `Evidence layer` pill label above it, then a
closed native `<details>` with the intro and three cards (strengths / mixed signals / what the
voter should still verify). Numbered 10 in the summary.

**Evidence & sources.** Below the tab panels, closed `<details>`, unchanged list markup.

## Citations: correctness beats the screenshot

The reference screenshots show S1 to S22 underlined like links. **They are not links and must not
become links.** `harshaDeSilva.ts` documents that S1 to S22 are placeholders with no `SourceEntry`
records yet. Keep `PendingCitations` / `InlineCite` as non-interactive tokens with the existing
"Citation pending verification" title. Styling can be a subtle dotted underline, but they must not
look or behave like working links. Only `SourceRefs` (s1 to s5, the real records) links to
`#hds-source-*`. Do not create `SourceEntry` records for S-tokens.

## Behaviour

- **Hash deep links.** On mount and on `hashchange` (effects only, SSR-safe, no `window` during
  render): if the hash targets an element inside a tab panel, activate that tab; if it is inside a
  closed `<details>` (sources, research notes, a hidden indicator detail row), open it; then scroll
  it into view. Clicking a `SourceRefs` link must open Sources and land on the highlighted row.
  Without JS, all content is still in the HTML.
- Tab selection stays plain component state (see the existing doc comment for why
  `src/lib/profileTabs.ts` is not reused). Do not add query params.
- Every section heading gets `scroll-margin-top` from an existing space token.
- Keep existing motion and `prefers-reduced-motion` handling. No new animation.

## Known conflicts - report these, do not silently resolve

1. **Institution name.** The reference shot says "Family Economic **Division**"; the data file (and
   the last commit) says "Family Economic **Unit**". The data file wins for now. Tell me; do not
   edit it.
2. **Em-dashes.** `docs/portfolio-profile-anti-slop-prompt.md` bans em/en-dashes in visible copy,
   but many strings in `harshaDeSilva.ts` contain them, and the reference layout shows them. Do
   not edit data strings in this pass. New structural copy you write (eyebrows, notes, labels)
   uses no em/en-dash. List the data strings that still contain dashes so I can decide separately.
3. **Column header wording.** The reference uses "What it tells the voter" and "Effect on people";
   the current code says "What this tells us" and "Effect on citizens". Use the reference wording
   unless an earlier page prompt explicitly required the change; if it did, quote it and ask me.
4. **Promises in Tier A / Voting in Tier B.** This is my deliberate choice (tabs are named for what
   they contain). Do not move them back.
5. Anything else where the screenshots, the data file, `CLAUDE.md` or an earlier page prompt
   disagree.

## Hard constraints

**Content**
- No visible data string in `harshaDeSilva.ts` changes. No claim, caveat, status, badge value,
  citation token or source is added, removed, softened, strengthened or merged. The only data-file
  change allowed is the structural `indicatorIds` field (after I approve it in the plan).
- Component stays generic: all visible content comes from `content`; only structural labels
  (column headers, tier eyebrows, tab labels, "Evidence layer", sub-headings that are not already
  in data) may live in JSX. No Harsha-specific strings in JSX.

**Prerender / crawlability (CLAUDE.md)**
- All four tab panels, all table rows, all detail rows, research notes and sources must be in the
  prerendered HTML. Hiding is `hidden` or native `<details>` only.
- Do not modify `Tabs.jsx`, `src/lib/profileTabs.ts`, `PersonPage.jsx` or any other page.

**Code hygiene**
- Delete now-dead components and CSS (`OutcomeIndicatorCard`, `ProgrammeCard`,
  `ProgrammeInterventionCard`, `PolicyPositionCard`, `PerformanceTab` etc. if unused, card-only
  rules no longer referenced). Grep before deleting.
- Rewrite the doc comment at the top of `PortfolioProfile.jsx` and the header comment of
  `PortfolioProfile.css` to describe the new tier-tab structure. Remove comments that describe
  sections or numbering that no longer exist.
- Grep `src`, `scripts`, `docs` for old ids (`hds-perf-s0`, `hds-record-s0`, `hds-policies-s0`,
  `hds-profile-s0`, `hds-meta-heading`, `hds-profile-research`) and report references outside
  these two files.
- Existing tokens only (`src/styles/tokens.css`). No raw px / colour / duration values.
- `.jsx` stays `.jsx`, relative imports keep extensions, **add no dependencies**, never run any
  `db:*` or `sync*` script.

## Scope

Editable: `src/pages/PortfolioProfile.jsx`, `src/pages/PortfolioProfile.css`,
`src/pages/PersonPage.test.jsx` (add assertions only), `src/data/harshaDeSilva.ts` and
`src/data/profileContent.ts` (the `indicatorIds` field only, after approval).

Read-only: everything else, including `CLAUDE.md`, `src/components/**`, `src/lib/**`,
`src/styles/**`, `docs/**`. Do not delete or edit the superseded prompt doc; tell me it is stale.

## Step 2 - implement, tests first

Run `npm test -- PersonPage` after each step.

1. Add assertions to `PersonPage.test.jsx` (renderToString, no new libraries) and confirm they
   **fail** on the current page:
   - existing assertions still present and passing (`hds-profile`,
     `Major programmes and interventions documented during`, `Position and responsibilities`);
   - exactly one `role="tablist"` with four tabs, containing `Tier A` ... `Tier D` and
     `Performance`, `Record`, `Policies`, `Profile` in that order;
   - each section heading appears **inside the correct panel**: slice the HTML between
     `id="hds-tab-panel-performance"` and the next panel id, and so on, and assert the headings for
     01-04, 05-06, 07, 08-10 are in the right slice and in numeric order;
   - numbers `01` to `10` each appear exactly once as a section number;
   - 01, 03, 04, 05, 07 and the 09 positions list render as `<table>` (count at least 6 tables);
   - `Portfolio at a glance` appears before the tablist;
   - content from hidden places is in the HTML: one research note label, one source organisation,
     one education entry, and the indicator text inside `pi1`'s hidden detail row;
   - no `<a` element has an `href` containing `S1`..`S22` tokens (pending citations stay unlinked);
   - `No further detail` is rendered for `pi5`.
2. Restructure JSX: tab bar, sections 01-10 in their panels, tables, glance strip unnumbered.
3. Details disclosure rows + `indicatorIds` (after approval, and after my answer about `pi3`).
4. Hash / details / tab deep-link enhancement.
5. CSS: tab bar, tables, grid gap fix, quiet Tier D styling, delete dead rules.
6. Doc comments.

## Step 3 - verify (all must pass before you say done)

1. `npm test` (full suite), `npm run lint`, `npm run typecheck`. Report counts.
2. `npm run dev`, open `/person/harsha-de-silva`, check at **1280 / 768 / 400px**, light and dark:
   tab switching by mouse and keyboard (arrow keys move focus, Enter/Space activates), each table
   stacking below 900px with visible labels, voting filters, a Details row opening and closing,
   a `Sources 02` link opening Sources on its row, loading `#hds-votes` directly opening Tier B,
   no empty panel block in the 09 grid.
3. Production truth (dev does not prerender):
   `VITE_SITE_ORIGIN=https://javora.lk npm run build`, then `npm run serve:dist`, then in another
   shell `npm run validate:crawlability` - must pass on every URL. `curl` the prerendered
   `/person/harsha-de-silva` and confirm the Tier D panel content, the voting table, a research
   note and a source organisation are in the raw HTML.
4. Heading audit: every `h1`/`h2`/`h3` in DOM order. One `h1`, section headings `h2`, sub-headings
   `h3`, no skipped levels, numbers 01-10 with no repeats.

## Step 4 - report back

- Before / after outline, tab by tab.
- Table: section, number, old location, new location, element type, default visible / hidden.
- Files changed, one line each; dead components and CSS removed.
- Test / lint / typecheck / crawlability results with counts.
- The Known conflicts list with what you found for each, plus the `pi3` question if still open.
- Do not commit. I will review the diff.
