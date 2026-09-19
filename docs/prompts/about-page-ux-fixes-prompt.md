# About page cleanup: SL Politics (javora-react)

You are working in the `javora-react` repo (SL Politics). **Read `CLAUDE.md` first and follow it.** Its invariants override anything in this brief. Correctness, provenance and honesty outrank looks. If any instruction below conflicts with `CLAUDE.md` or with what the code and data actually do, **stop and tell me** instead of forcing it.

> **Run order:** do this after `homepage-ux-fixes-prompt.md` is finished and verified. Both pages share `home.*` i18n keys (the `stat*` strings especially), so check whatever the homepage work already changed and don't undo it.

## Goal

Make `/about` honest, consistent and readable for ordinary Sri Lankan visitors:

- remove self-contradictions
- remove repetition
- replace jargon with plain words
- unify the visual patterns
- reorder the page for a normal reader

**Don't change data, the database, sync, identity, slugs, routes or the CSP.**

## Files involved (verify before editing)

- `src/pages/AboutPage.jsx`: the whole page
- `src/components/Primitives.jsx`: `StatsCard` (~line 335), `SectionHead`, `Notice`, `VerificationLegend`, `ActionLink`
- `src/lib/verification.ts`: `VERIFICATION_PRESENTATION`, the single source of label names and descriptions
- `src/services/repository.ts`: `datasetStats`, `DATASET`
- `src/components/Chrome.jsx`: footer links (~lines 60–70, 317–325), brand name
- `src/i18n/en.js`, `si.js`, `ta.js`: `about.*`, the `home.*` keys the About page reuses, `corrections.*`, `footer.*`, `nav.howItWorks`
- The CSS for `.grid-stats`, `.trust`, `.principles`, `.principle`, `.about-terms`, `.about-subheading`, `.record-list`, `.workflow-list`, `.notice`, `.section--alt` (find them with grep)
- `src/pages/CorrectionsPage.jsx`: shares the `corrections.*` strings
- Source definitions: find where the 7 declared sources (S001, S006, S900, …) are defined

## Ground rules

- **Plan first.** Read every file above, then show me a short plan (files, changes, risks, and the answers to the "verify" questions below) before editing.
- Components stay `.jsx`. Relative imports keep explicit file extensions. **Add no dependencies.**
- Everything must render in the prerendered static HTML. No client-only content, and no collapsed content missing from the HTML. Use a native `<details>`/`<summary>` for anything collapsible: its content is in the HTML and needs no JS.
- No hydration mismatches.
- **Every number shown must be computed from the data**, never typed into copy.
- **Every factual sentence must match what the code and data actually do.** Where you are unsure, read the code; if still unsure, flag it rather than guess.
- Grep every i18n key before renaming or deleting it. Many are shared with `HomePage.jsx` and `CorrectionsPage.jsx`.
- Keep the `en`, `si` and `ta` key sets identical.

---

## Task 1: Fix the contradictions (highest priority)

### 1a. How updates happen
- Right now `about.limitation3` says "Records update on a schedule, not instantly." `home.infoNoticeBody3` says "updated by re-running the importer, not automatically."
- Per `CLAUDE.md`, automatic sync is implemented but **off**: every interval defaults to 0.
- **Verify** in `server/scheduler/` and `.env*.example`, then keep **one** accurate statement in plain words. For example: "Records are refreshed when we re-check the official sources, not automatically. A change at the source appears here only after that." Delete the other version.

### 1b. Election Commission claim
- `home.principle1Body` says authority is decided per fact, "the Election Commission for results," but `home.infoNoticeBody2` says there are no election results yet.
- **Verify** whether any Election Commission source is used for any shown fact. If none is, rewrite the principle to name only sources actually used (Parliament for membership, the Cabinet Office for ministers). Don't list sources the site doesn't use.

### 1c. "7 institutional sources"
- The stat card shows `stats.sources` (7 declared), but only 2 are connected, and the page itself names 3 directories. S900 is a research compilation that is "authoritative for nothing," so calling it an "institutional source" is also wrong.
- **Verify** what `stats.sources` and `stats.connectedSources` count, and which sources feed any displayed record.
- Change the card so it can't overstate coverage. Preferred: the **value** is the number of sources actually used for records shown, labelled **"Official sources in use,"** with a note naming them (for example "Parliament of Sri Lanka · Cabinet Office"), derived from the source definitions if practical. If you keep the declared count anywhere, label it plainly (for example "7 identified, 2 in use") and never call S900 institutional.
- This card's strings are shared with the homepage trust section. Apply the same honest wording there and tell me what changed on the homepage.

### 1d. The glossary explains labels that appear on zero records
- `home.infoNoticeBody3` says no record is marked verified, yet the legend explains Verified, Secondary source, Pending review and Sources conflict with no hint that they're unused.
- Compute, from the bundled dataset through `repository.ts`, how many claims or records currently carry each state in `VERIFICATION_STATES`. Add a repository helper if none exists, with a unit test.
- In the legend, mark each state with either **"In use · {{count}} records"** or **"Not in use yet."** Pick the unit (claims vs positions vs records) that matches how states are actually attached, and name it correctly.
- Label names and descriptions must still come from `VERIFICATION_PRESENTATION`. Don't restate them in `AboutPage`.

## Task 2: Remove repetition

### 2a. "Official sources first" twice
The methodology section title (`home.methodologyTitle`) and the first principle title (`home.principle1Title`) are identical and side by side.
- Change the section heading to **"How records are sourced."**
- Delete the section lede (`home.methodologyLede`), which only repeats principles 1 and 2, or cut it to one short sentence that adds something new.
- Remove the separate "Methodology" eyebrow once headers are unified (Task 5).
- **Keep `id="methodology"`** on the section. The footer and homepage link to `/about#methodology`.

### 2b. The same counts and sources stated three times
- The stat cards, `home.figuresReal` under them, and `home.infoNoticeBody1` all repeat serving/former counts and the source directories.
- Keep the counts **only** in the stat cards.
- Keep the source names **once**, in the merged scope section (Task 4).
- Remove `home.figuresReal` from the About page. Keep the `figuresDemo` branch only if demonstration mode still needs it.

### 2c. Scope split across two places
"What this covers — and what it does not" (the `Notice` inside the methodology column) and "Limitations" (the bottom section) are the same topic. Merge them in Task 4, and remove the `Notice` from the methodology column.

### 2d. Footer
- "How SL Politics works" (`/about`) and "Methodology" (`/about#methodology`) are two links to one page. Keep one: **"How it works" → `/about`**, plus "Report an error." Update the drawer too if it duplicates this.
- `footer.tagline` and `footer.copyright` both say "traceable to their source." Change the copyright line to a plain `© {{year}} SL Politics`, with the year from the same build-time date the site already uses. Don't call `new Date()` in a way that could mismatch across build and hydration.
- Brand: the nav says "SL Politics," the footer says "SL Politics By Javora." Use **"SL Politics by Javora"** (lowercase "by") in the footer, or ask me if a brand rule exists in the README.

## Task 3: Plain language and clearer labels

### 3a. "Not publicly verified" → "Not published anywhere"
- The name sounds like "Unverified" but means "no authoritative source publishes this."
- **This must stay a separate state from "Not recorded" and "No matching records"** (the `CLAUDE.md` invariant: Unavailable / Unrecorded / NotVerified are three different statements). Only the **display label** changes. No logic or type names change.
- **Verify** where this string is shown. `CLAUDE.md` says profiles hard-code "Not publicly verified" for place of birth. If profiles use the same key, the rename must apply there too, so the site stays consistent. If they use a different key, rename both, or tell me why not.
- Update any test asserting the old label to the new intended text.

### 3b. Stats labels
- "Recorded offices" (6,6xx, "1,4xx distinct titles") → label **"Positions held,"** note **"across {{count}} office titles."**
- "Earliest record" / "Historical records are retained" → label **"Oldest office on record,"** note such as **"Records go back to {{year}}"**, or drop the note if the value already says it.
- "Public figures" / "{{count}} currently serving": keep, but confirm "public figures" is accurate. The scope is people who sat in Parliament, plus the President and Cabinet.

### 3c. Jargon pass on all About copy
Rewrite `about.*`, the reused `home.*` strings and the principle bodies in plain English for a general reader:

| Instead of | Use |
|---|---|
| register | the records / this site |
| authoritative / institutional source | official source |
| retrieval date | the date we last checked the source |
| re-running the importer | when we re-check the official sources |
| authority is decided per fact | say it concretely |

**Keep every claim's exact meaning.** Simpler words, not weaker or stronger claims. Shorten the page lede to one sentence, for example: "Where these records come from, what the labels on them mean, and what to do if something is wrong."

### 3d. Out-of-place CTA
Remove "Browse the Directory" (`home.browseDirectoryAction`) from the methodology section. Grep first; if the key is unused elsewhere afterwards, delete it.

## Task 4: Merge scope and limitations into one section

Create a single section **"What's covered, and what isn't"** (`id="limitations"` kept for existing links; add `id="scope"` only if nothing else needs changing) containing, in plain words:

1. **Who is included:** people who have sat in the Parliament of Sri Lanka (current and former), plus the President and Cabinet from the Cabinet Office. Name the sources once. This is not a register of every politician.
2. **What's not here yet:** no election results, no party histories. Verify both statements are still true.
3. **How current it is:** the single accurate update statement from Task 1a.
4. **Pages change:** a source may change or go offline after we checked it; the date shown is when we last checked.
5. **Historical coverage is uneven:** older terms depend on what institutions still publish. Keep the accurate point that a **missing end date is not "still in office."** It's a `CLAUDE.md` invariant, so the wording must match "end not recorded."
6. **Verification status:** records cite their exact official page, but none is marked verified yet. If Task 1d's counts show otherwise, state the real count.

Use a simple bulleted list or short paragraphs under one heading. One `Notice` at most, or none. Demonstration mode still shows its warning notice (`home.demoNotice*`).

## Task 5: Corrections section, honest and clear

- Right now there's a prominent "Report an error →" button, then text saying the review states apply "once a reporting channel exists." It invites a report and then says reporting doesn't exist.
- **Keep the `CLAUDE.md` honesty rule:** never imply a report will be received when `VITE_API_URL` wasn't set. Use the existing `isApiEnabled()` (`connected`).

**When `connected` is false:**
- Don't show the 4-step workflow list.
- Show one plain line next to the heading: **"Online reports aren't connected yet."** Then give whatever real alternative exists (for example, the Corrections page explaining what to include). **Verify** what `/corrections` actually offers when disconnected, and don't invent an email address.
- Keep the link to `/corrections`, but label it so it doesn't promise submission (for example "How to report an error").

**When `connected` is true:**
- Keep the button **"Report an error."**
- Show the 4 steps as a compact horizontal stepper on desktop and a vertical list on mobile, not 4 full-width bordered boxes.
- Step text stays sourced from the shared `corrections.*` keys so it can't drift from `CorrectionsPage`.

Test both branches if the markup-test setup allows it.

## Task 6: Unify the visual system

### 6a. Number formatting
`StatsCard` renders `String(value)`, so About shows "1623" while the homepage shows "1,623." Format numeric values in `StatsCard` with the same locale formatting the homepage uses (`toLocaleString('en-US')`, or the shared helper if one exists). Leave non-numbers such as "—" or years unformatted: **years must not become "1,931."** Add a small test.

### 6b. One section header pattern
Every section uses `SectionHead` (h2 + optional description + optional action on the right). Remove the one-off eyebrow + two-line-title + two-column layout of the methodology section. No section title should wrap to two lines at desktop width because of a narrow column.

### 6c. One definition layout
The verification legend (dense inline list), the missing-value terms (3-column `dl`) and the principles (icon cards) are all "term + explanation." Use **one** layout for all three: a responsive grid of simple term/definition items.
- 3 columns desktop, 2 tablet, 1 mobile.
- Real `<dl>`/`<dt>`/`<dd>` semantics where they're definitions.
- Consistent spacing.
- Status items keep their existing badge or icon from `VerificationLegend`.
- Principles may keep a small icon, at the same size and position as the legend icons.

If this means changing `VerificationLegend` in `Primitives.jsx`, check every other place it's used and confirm they still look right.

### 6d. Fewer boxes
Reduce the number of bordered card styles on the page:
- Stat cards may keep a border.
- Definitions, principles and scope use no card borders, just spacing and dividers.
- At most one `Notice`, and only for demonstration mode.

Reuse existing CSS tokens and classes. Don't introduce new colours or radii.

### 6e. Background rhythm
After reordering (Task 7), alternate `section--alt` so no two adjacent sections share the same background.

### 6f. Readability and contrast
The legend, notice and card body text is very small and low-contrast on the dark theme.
- Body text at least the site's normal body size; small meta text no smaller than the existing `.meta` size.
- Check contrast in **both light and dark themes** against WCAG AA (4.5:1 for normal text), using the existing colour tokens. Report any pairs you changed.

### 6g. Copy casing
Use sentence case for all links and buttons ("Report an error," "How it works"), not Title Case.

## Task 7: New section order

```
1. Header (h1 "About SL Politics" + one-sentence lede)
2. What's in the records: stat cards only                  (Task 1c, 3b, 6a)
3. What's covered, and what isn't: merged scope + limits   (Task 4)
4. How records are sourced: 4 principles, id="methodology" (Task 1b, 2a)
5. What the labels mean: legend with in-use counts + missing-value terms, id="labels" (Task 1d, 3a, 6c)
6. Found something wrong?: corrections                      (Task 5)
```

- Keep existing anchor ids (`methodology`, `labels`, `limitations`) working. Grep for links to them across the repo.
- Optional: if the labels section is still very long after 6c, wrap the missing-value terms in a native `<details open>`. Its content stays in static HTML. Don't use JS toggles.
- Keep the heading hierarchy valid: one h1, then h2 per section, h3 inside.

## Task 8: i18n cleanup and translations

- The About page currently reads many `home.*` keys (`datasetHeading`, `stat*`, `methodology*`, `principle*`, `infoNotice*`, `figures*`, `demoNotice*`). Move the ones used **only** by About into `about.*`. Keys used by **both** pages (for example `stat*`, which the homepage trust section also uses) stay shared: move them to a neutral namespace such as `dataset.*`, or leave them in place and tell me which you chose.
- After changes, grep and delete keys with zero references.
- Apply identical key changes to `si.js` and `ta.js`.
- Write Sinhala and Tamil drafts for every new or changed string: plain and neutral. List every one, with its English source, in the final report under **"Needs native review."** Don't claim they're final.
- Run or add the i18n key-parity test (the homepage prompt may already have added it).

---

## Out of scope: do NOT change

- The meaning or logic of any verification state or missing-value state; `verificationForImportedFact()`, `normaliseClaim()`, and the three distinct absence states
- How any statistic is computed (only labels, formatting, and the new per-state counts helper)
- Data, database, sync, import scripts, identity overrides, slugs, `routeManifest`, CSP, the theme script
- `CorrectionsPage.jsx` behaviour and the corrections API. Shared strings may change wording only, and must stay honest in both connected and disconnected states.

## Tests to add or update

- `StatsCard` formats `1623` as `1,623` and leaves `1931` / `'—'` unchanged.
- The helper counting records per verification state returns correct counts for a small fixture, and its totals match the dataset.
- About page markup:
  - no duplicate "Official sources first"
  - no "Records update on a schedule"
  - no Election Commission mention unless verified in use
  - the "Not published anywhere" label present
  - `id="methodology"`, `id="labels"`, `id="limitations"` present
  - disconnected state shows "Online reports aren't connected yet" and no 4-step list
- Footer: no two links pointing at the same URL.
- Update existing tests asserting old copy to the new intended copy. Don't delete tests to make them pass.

## Verification (all must pass before reporting done)

```bash
npm run typecheck
npm run lint
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # separate terminal; heed the stale-build warning
npm run validate:crawlability # HARD GATE: must stay 1623/1623
```

Then, on `serve:dist` (not `npm run dev` or `npm run preview`):

1. Open the prerendered `dist/about/index.html` (or the path the build uses) and confirm all section content, legend counts and the disconnected corrections text are in the static HTML.
2. Check `/about` at ~1440px, ~1280×720 and ~390px, in **light and dark** themes:
   - no two-line section titles on desktop
   - definition grids collapse cleanly
   - alternating backgrounds
3. `/about#methodology`, `/about#labels` and `/about#limitations` scroll to the right sections without being hidden under the sticky nav.
4. Browser console: no hydration warnings.
5. Keyboard-only pass: visible focus on every link.
6. Homepage trust section: confirm the shared `stat*` wording changes read correctly there too.

## Final report format

1. Answers to each "verify" question (update mechanism, Election Commission use, what `sources`/`connectedSources` count, per-state counts, where "Not publicly verified" is used, what `/corrections` offers when disconnected)
2. Summary of changes per task (1–8)
3. Files changed, including any homepage-visible changes
4. Test and verification results, with the crawlability count
5. **Needs native review:** every new or changed Sinhala and Tamil string, with its English source
6. **Open decisions for Pasan:** brand name in the footer, anything you couldn't make both plain and accurate, anything skipped and why
