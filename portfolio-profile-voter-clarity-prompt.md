# Portfolio profile cleanup: one role, one clear path (every portfolio page)

Copy-paste prompt for Claude Code. Run from the repo root. Paste everything below the line.

---

You are working in the `javora-react` repo (SL Politics). **Read `CLAUDE.md` first and follow it.** Its invariants override anything in this brief. Correctness, provenance and honesty outrank looks. If any instruction below conflicts with `CLAUDE.md` or with what the code and data actually do, **stop and tell me** instead of forcing it.

**This supersedes** `docs/portfolio-profile-tiered-tabs-prompt.md` (the four tabs and the pill sub-tabs go away) and `docs/portfolio-profile-restructure-prompt.md`. It **keeps** the evidence model from earlier passes: sourcing and outcome are two separate axes, pending references are never links, and rows people compare stay in real tables.

## Decisions already made (do not reopen)

1. **One focus role per page.** A portfolio page covers the single highest-ranking office the person has held, and only that office. It is not a whole-career page.
2. **One guided scroll, no tabs.** Sections run in the order a voter reasons. A sticky "On this page" bar handles jumping.
3. **The page never tells the reader what to conclude.** No takeaways, no "potentially positive", no strengths or weaknesses, no scores, grades or percentages. It shows facts, dates, sources and honest gaps in a sensible order, and the reader decides.
4. **This is a template, not a Harsha de Silva page.** `PortfolioProfile.jsx` must work for any person added later in `src/data/profileContent.ts`, including people with very little researched content. `/person/harsha-de-silva` is only the reference example.

## The reader's path (target structure)

Top to bottom, a citizen should be able to answer these questions in this order:

| # | Section (nav label) | Question it answers | What it contains |
|---|---|---|---|
| 0 | Hero (not in nav) | Who is this, and which office is this page about? | Portrait, name, office title, term, one neutral sentence on why this office, one "Today" line, record-level sourcing state |
| 1 | The office | What was this job responsible for? | Appointments with dates, gazetted duties, institutions under the office |
| 2 | What was done | What happened under this office, and what came of it? | One merged table: action, the person's documented role, what the sources show, status |
| 3 | Decisions & votes | How did they act on this office's subjects during the term? | Term-bounded decisions and votes, or one honest empty line |
| 4 | Not in this record | What can this page not tell me? | Short derived list of standard questions with no sourced answer |
| 5 | Other offices held | Where does this office sit in their record? | Closed `<details>`, one line per office, derived from the repository |
| 6 | Sources | Where can I check it myself? | Numbered sources, with what each one supports |

Nothing else renders.

---

## What is wrong now (the evidence)

Found by reviewing seven full-page screenshots of `/person/harsha-de-silva` (all four tabs, legend open and closed) against the code and bundled data. Tasks below refer to these IDs. **Verify each one before acting on it.**

### A. Honesty and correctness (fix first)

- **A1. "Verified" bypasses the site's verification rules.** `PortfolioProfile.jsx` has its own `VERIFICATION_STATUS` map (~line 220) and never calls `normaliseClaim()`. Site-wide (`src/lib/verification.ts`), Verified requires evidence **and** a check date; otherwise the claim becomes Pending review. On this page, "Current position" (`cf1`) is Verified with no citation at all, and every other Verified badge sits next to "Source pending", which means a reference with no source record behind it. The same page also says "Record status: Source-linked", which site-wide means "not yet checked". This is the floor `CLAUDE.md` says must not be weakened.
- **A2. Two numbering systems that look the same.** Rows cite "Sources 02" (the Food Commissioner's Department report). Career cards cite "source pending: S2" (a different, unlisted reference, used for the Committee on Public Finance). A reader will take S2 to mean source 02. Many facts also cite `S1` as "source pending" while source `s1` (Parliament MP profile, with a working URL) is already listed on the page. They may be the same document.
- **A3. Term dates disagree on the same page.** The hero says 11 Jan 2019 - 21 Nov 2019. The career card and positions table say 2018–2019. The bundled Parliament record (`parliamentMembers.json`, id 3201, reached through `getPersonBySlug`) has two back-to-back appointments: "Non Cabinet Minister of Public Distribution and Economic Reforms", 21 Dec 2018 to 11 Jan 2019, then "Non Cabinet Minister of Economic Reforms and Public Distribution", 11 Jan 2019 to 21 Nov 2019. Every date on the page is hand-typed.
- **A4. The duties may belong to a different office.** "Documented responsibilities" cites Gazette Extraordinary No. 2066/09 of 9 Apr 2018, and the "Food supply & distribution policy" row says "Gazetted Apr 2018". The canonical record starts this office on 21 Dec 2018. In April 2018 the record has him as State Minister of National Policies & Economic Affairs (31 May 2017 to 26 Oct 2018).
- **A5. The two institution lists contradict each other.** The "Position" section lists 7 portfolio institutions, including "1990 Suwaseriya Foundation". "Career detail" lists 4 and calls the "1990 Suwa Seriya Foundation" a "proposal, not a formal portfolio institution". Names also drift: Food Commissioner's Department / Department of Food Commissioner, Data Analysis Unit / Data Analytics Unit, Suwaseriya / Suwa Seriya.
- **A6. One 2015 office has three names.** "Deputy Minister of Policy Planning / Economic Affairs" (career), "Deputy Minister of National Policies and Economic Affairs" (Suwa Seriya row), and Parliament's own "Deputy Minister of Policy Planning, Economic Affairs, Child, Youth and Cultural Affairs".
- **A7. Time-dependent facts are stored as text.** "Current", "Current (recent Parliament record)", "Tenth Parliament", "Chair, Committee on Public Finance". `CLAUDE.md` says nothing time-dependent is stored. These go stale silently.
- **A8. A "Not established" card contradicts the bundled data.** "Years in office" says the source gives no exact Seventh Parliament start date. The bundled record has `startDate: "2010-04-21"`.
- **A9. Group citations are shown as row citations.** Programmes `p1`–`p5` all cite `s2, s4, s5`, and the data file's own header says this is a domain-level grouping, not a per-claim citation. Under each row it reads "Sources 02 · 04 · 05", which looks like a citation for that row. `CLAUDE.md`: a row naming only a source is an institution reference, not a citation.
- **A10. Internal jargon in public copy.** "Referenced in dossier §4", "this dossier", "for this prototype", "research file", "transcribed".
- **A11. The Port City vote is dated "2022 (committee stage)".** The Colombo Port City Economic Commission Act is usually cited as Act No. 11 of 2021. Check the date against Hansard before it appears anywhere again.

### B. The page contradicts its own scope

- **B1.** The hero says the page "does not cover this person's full political career". The Role & career tab says it "covers his full documented career across all roles".
- **B2.** "Why this role?" says the page is "not a ranking of this person's most important office". The product rule is now the highest-ranking office.
- **B3.** Most content falls outside the office's term (21 Dec 2018 to 21 Nov 2019): the 2015 Suwa Seriya proposal, the 2015 one-million-jobs pledge, 2015–2017 statements, all four votes (Mar 2018, Apr 2018, Nov 2018, "2022"), attendance and questions across four Parliaments, and the 2015 employment baseline.

### C. Repetition

- **C1.** Office and term appear four times: the hero "Focus role" box, "Portfolio at a glance", "Role summary", and the career card plus positions table.
- **C2.** The same facts appear in three places. Dambulla cold storage: `oi6`, `pr4`, `pi4`. Suwa Seriya: `oi4`, `oi5`, `pi1`. Enterprise Sri Lanka loan figures: `oi3` and `pi2`, word for word. Employment 7,830,976 → 8,180,693: `oi1` and `pr1`, word for word. Social-market economy: `pr2`, `pi5`, `pp1`. Export orientation: `pr3`, `pp2`, `pi5`.
- **C3.** Two tables with nearly the same name: "Major programmes and interventions documented during …'s tenure" and "Programmes & interventions".
- **C4.** A grid of career fact cards, followed straight away by a positions table listing the same positions.
- **C5.** Record status is shown twice (glance strip and page foot).
- **C6.** Two institution lists (see A5).

### D. Editorialising (telling the voter)

- **D1.** The "What it tells the voter" column: "Shows substantial programme scale", "Shows durable scale-up of a service first proposed by de Silva".
- **D2.** The "Effect on people" column: five of six rows say "Potentially positive…". "Longer-term outcome" predicts: "Could strengthen…", "Can reduce…", "Better data can improve…". This is speculation, and it only points one way.
- **D3.** Research notes: "Evidence-backed strengths to investigate further", "Mixed / incomplete outcome signals", "What the voter should still verify". That is evaluation framed as strengths, followed by instructions to the reader.
- **D4.** National employment and unemployment lead the default "Performance" tab while their own caution column says they are not minister metrics. Leading with them invites the attribution the page disclaims.

### E. Low-information content

- **E1.** Major programmes table: all six rows are "Intended, not established" with "Financial evidence: Not established". Seven columns that say "we don't know" six times.
- **E2.** "Responsibility & attribution": three generic definition cards that would read the same on every politician's page. That is methodology, not record.
- **E3.** "Role summary" and "Scope" restate the title in gazette boilerplate and add advice ("Specific expenditure authority should be assessed against…").
- **E4.** Meta-commentary about the UI itself: "This is a portfolio summary, not an evidence-graded record…", "Distinct from the 'Portfolio at a glance' panel above…". If a page needs a note explaining its own layout, the layout is wrong.
- **E5.** Section intros are 2–4 sentence methodology defences ("No indicator is collapsed into a subjective 'politician score'…").
- **E6.** Voting record: Year and Evidence-type filters plus "4 of 4 records shown", for four rows.
- **E7.** A whole "Policy positions" tab for two rows.
- **E8.** "Census & Statistics administration" presents an agency's routine running costs ("Government spends on statistical operations") as a programme.
- **E9.** "Major policy areas (derived)" is the site's own summary, not a sourced fact.
- **E10.** A "For researchers" pill floats above a collapsed section.

### F. Label overload

- **F1.** The legend explains 10 labels in two lists, plus a paragraph about numbering, before the reader reaches a single fact.
- **F2.** "Not established" means two different things: "no source establishes this fact" on one axis, and "sources don't establish the outcome" on the other.
- **F3.** "Source-linked" is an outcome label on this page (`EVIDENCE_STATUS`) but a sourcing/record label everywhere else on the site.
- **F4.** Four ways to say "we don't know": Not established, Unable to verify, Source pending, URL unavailable. Promise statuses are free text ("Partially completed", "Unable to verify", "Delayed").
- **F5.** A "Verified" badge on almost every row, so the badge carries no signal.

### G. Broken or inconsistent UI

- **G1.** Programmes & interventions: the Details column is `width: 4%` (`PortfolioProfile.css` ~1277), so "Details" renders one letter per line and "No further detail" breaks mid-word.
- **G2.** Promises and Major programmes tables have `min-width: 1150px` (CSS ~1251, ~1262). Result: horizontal scroll inside a desktop container, 15-line cells, and "SOURCE PENDIN G" / "Not independ ently sourced" breaking mid-word.
- **G3.** A "See in 01" link (JSX ~738) points at section numbers that no longer exist.
- **G4.** The outcome table header "2015 / Baseline" is hard-coded in the component (JSX ~516, ~530), though rows use 2016, 2018 or "—". It also breaks the template for anyone else.
- **G5.** Three citation formats: "SOURCE PENDING · S19, S28" (block), "(source pending: S1)" (inline), "Sources 02 · 04" (linked).
- **G6.** Dates: monospace in the hero box, serif in the glance strip, and "Apr 2018", "2022 (committee stage)", "2015 – 2017", "2018 – 2019", "Proposed 2015 · Launched 2016", "Current". Separators mix hyphen, en dash and middle dot.
- **G7.** Badge placement varies: beside the label on some career cards, wrapped under it on others; under the row title in one table, in its own column in the next.
- **G8.** Too many tiny all-caps labels. `PortfolioProfile.css` has 15 uppercase rules and uses `--text-micro` 17 times and `--text-xs` 14 times: eyebrow, FOCUS ROLE, PORTFOLIO AT A GLANCE, ROLE, TERM, card labels, SOURCE PENDING. On a dark background this is tiring to read.
- **G9.** Colour meanings collide. The amber accent is used for a link ("Why this role?"), source numbers, the "Partially verified" warning, and "Intended, not established".
- **G10.** The hero "Focus role" is a bordered panel that looks like a button or an input.
- **G11.** "URL unavailable" is drawn as an outlined button next to real "Visit" buttons, but it does nothing.
- **G12.** Partial-width `<hr>` rules under the glance strip and under tables, plus dividers between every section.
- **G13.** The career card grid has uneven heights, and "Years in office" sits alone on its own row.
- **G14.** Only the toast strings go through `t()`. Every heading, column and label is hard-coded English, so picking සිංහල or தமிழ் in the header leaves this whole page in English with no notice.

---

## Files involved (verify before editing)

- `src/pages/PortfolioProfile.jsx`, `src/pages/PortfolioProfile.css`
- `src/data/profileContent.ts`: `PortfolioProfileContent`, `getProfileContent`
- `src/data/harshaDeSilva.ts`: content and row types
- `src/pages/PersonPage.jsx`: `PersonPage` dispatch, `PortfolioPersonPage`. `src/App.jsx`: the retired `/politician/harsha-de-silva` route
- `src/services/repository.ts`: `getPersonBySlug`, `getSource`, `evidenceFor`, `sourcesCitedBy`
- `src/data/roles.ts`: `ROLE_TYPES`, `precedenceFor`, `roleTypeName`
- `src/lib/verification.ts`: `normaliseClaim`, `VERIFICATION_PRESENTATION`, `presentVerification`
- `src/components/Primitives.jsx`: `VerifiedBadge`, `Unavailable`, `Unrecorded`, `NotVerified`, `TenureValue`. `Period` lives in `src/pages/PersonPage.jsx`
- `src/components/SectionNav.jsx`: `SectionNav`, `useActiveSection`
- `src/lib/date.ts` (`formatDate`), `src/lib/positions.ts` (`sortPositions`, `isCurrent`)
- `src/i18n/en.js`, `si.js`, `ta.js`, `src/i18n/keyParity.test.ts`
- Tests: `src/pages/PersonPage.test.jsx` (the "PortfolioProfile — tab structure" suite), `src/pages/PortfolioProfile.copy.test.jsx`, `src/lib/prerenderContent.test.ts`, `src/lib/routeManifest.test.ts`
- **Read only, for prior thinking:** `src/pages/PersonDecisionPage.jsx` (imported nowhere today) and `src/pages/DecisionProfilePrototype.jsx`. Don't wire up or delete either.

## Ground rules

- **Step 0, safety.** Run `git status` and `git diff --stat` and show me the output. There is **no git remote**. Don't `checkout`, `restore`, `stash`, `reset` or commit on your own. Ask me whether to make a WIP checkpoint commit first, and wait for my answer.
- **Plan first.** Read every file above, then show me a short plan: files, the new content contract (exact TypeScript), the per-item scope table from Task 2d as it applies to the real data, answers to every **Verify** question, and risks. Wait for my OK before editing.
- Components stay `.jsx`. Relative imports keep explicit file extensions. **Add no dependencies.**
- Everything renders in the prerendered HTML. Collapsible content uses native `<details>`. Hidden table detail rows use the `hidden` attribute, never conditional rendering. Don't read `window` or `document` during render. No hydration mismatches.
- **Don't invent anything.** No new facts, figures, sources, URLs or dates, and no web research in this pass. You may only move, merge, cut, relabel, derive from bundled data, or map an existing reference to an existing source when the data proves they are the same document.
- **Nothing removed is lost.** Every researched item you take off the page goes, verbatim and with its cite ids, into `docs/research/harsha-de-silva-out-of-scope.md`, with a one-line reason for each.
- Don't touch the database, sync, importers, identity overrides, slugs, the `routeManifest.ts` route list, the CSP or the theme script. Don't change `normaliseClaim()` or `verificationForImportedFact()`.
- Grep before renaming or deleting any export, id, CSS class or i18n key.

---

## Task 1: Honesty and correctness (highest priority)

### 1a. One verification system (A1, F5)
- Every sourcing label on this page comes from `normaliseClaim()` + `VERIFICATION_PRESENTATION`, rendered with the site's `VerifiedBadge`. Delete the local `VERIFICATION_STATUS` map.
- Build each row's sourcing as a `Claim` (`verification`, `evidenceIds`, `verifiedAt`) in **one** small adapter. A row whose only citations are unlisted references, or that cites nothing, gets whatever `normaliseClaim` returns. It cannot come out Verified.
- **Verify** how the tabbed layout turns records into claims, and reuse that path. Don't write a parallel rule.
- Report how many rows changed label, and from what to what.

### 1b. Citations (A2, A9, G5)
- One citation component, one visible format. Real sources show as linked numbers that match the Sources list.
- Unlisted references never look like source numbers. Show the plain text "Source not yet listed" and keep the `S…` ids only in a `data-` attribute. They are never links.
- **Verify** whether the unlisted `S1` is the Parliament MP profile already listed as `s1`: compare what the S1-cited facts say (party, date of birth, Parliaments served, "official profile snapshot") with that record. Map it only if the data proves it. Report the result for every S-id.
- Group citations (`sourceIds` on `p1`–`p5`): either show them once at section level as background sources for those rows, or keep them per row with a visible "covers this group" label. Either way they can't raise a row above what `normaliseClaim` allows. Pick the simpler option and explain why.

### 1c. Derive office facts from the canonical record (A3, A6, A7, A8)
- Name, office title(s), appointment dates, term, the "Today" line and "Other offices held" all come from `getPersonBySlug(slug)` positions, formatted with `formatDate`.
- Back-to-back appointments to the same office (like the two title orders above) display as one continuous term, with both appointments listed under "The office". Don't merge them in the data.
- Delete the hand-typed `hero.tenure`, `careerDetail.facts` and `careerDetail.positions`.
- "Current" and "today" are derived at render, using the same date source the tabbed layout uses, so prerender and client agree. Never store them.

### 1d. Duties and institutions (A4, A5)
- **Verify**, from the data file's own citations, which office Gazette 2066/09 (9 Apr 2018) assigned.
- If it predates this office, don't present its text as this office's duties. Move it to the archive file and show duties through `Unavailable`, for example "No gazetted duty statement for this office is on record here."
- Produce **one** institutions list, one spelling per institution, containing only institutions a source ties to this office. The Suwa Seriya Foundation is included only if a source says it sat under this office.

### 1e. Remove internal jargon (A10)
Banned in visible copy: dossier, prototype, research file, transcribed, tier, §.

### 1f. Port City date (A11)
Flag it in the archive file as "check against Hansard". Task 2 takes it off the page anyway.

---

## Task 2: Scope the page to the focus role (B1–B3)

### 2a. Pick the focus role by rule, not by hand
- Focus role = the person's position(s) with the lowest `precedenceFor(roleType)` in `ROLE_TYPES`. Tie: the longest total time in that office. Still tied: the most recent.
- Back-to-back appointments to the same office count as one.
- The content file declares which canonical position(s) it documents. Add a test that fails if that declaration doesn't match the rule's result.
- For Harsha de Silva this should be `non-cabinet-minister` (precedence 12), 21 Dec 2018 to 21 Nov 2019. **Verify.**

### 2b. Replace "Focus role", "Why this role?" and the scope note (B1, B2)
- Delete `hero.focusNote` and `hero.focusExplainer`.
- One derived sentence under the name, for example: "This page covers {name}'s highest-ranking office on record: {office}, {start} to {end}."
- Never say "best", "most powerful" or "most important".
- Link to an explanation of how offices are ranked only if `/about` already has one. Don't build that section in this pass.

### 2c. Inclusion rule
An item stays on the page only if **one** of these is true:
1. It defines the office: duties, institutions, appointments.
2. It happened during the term **and** concerns the office's subjects or institutions.
3. It is a later, sourced result of something started or run under this office during the term (for example, the completion status of a project begun in the term). Show it with its "as of" date.

Everything else leaves the page and goes to the archive file.

### 2d. Expected result for Harsha de Silva
**Check each against the data before acting.** If the data says otherwise, follow the data and tell me.

| Item(s) | Expected | Why |
|---|---|---|
| `p1`–`p5` Food Commissioner programmes | Keep, merged into "What was done" | Institution under the office; 2019 reporting. Verify the report covers the term |
| `p6` Census & Statistics administration | Remove as a row | Routine agency running, not an action (E8). The department may stay in the institutions list if sourced |
| `pi3` Food supply & distribution policy | Depends on 1d | Gazette date predates the office |
| `pi4` + `pr4` + `oi6` Dambulla cold storage | Keep as **one** row | Initiated 30 Mar 2019, inside the term. The 2024 status is a later result |
| `pi1` + `oi4` + `oi5` 1990 Suwa Seriya | Remove | Proposed in 2015 as Deputy Minister, before this office |
| `pi2` + `oi3` Enterprise Sri Lanka | Remove, unless a source ties it to this office | Launched 2018 under the finance agenda; the only stated link is that he "publicly promoted" it |
| `oi1`, `oi2`, `pr1` Employment, one million jobs | Remove | 2015 baseline, government-wide, and self-declared as not attributable (D4) |
| `pr2`, `pp1`, `pi5` Social-market economy statements | Remove | 2015–2017, before this office |
| `pr3`, `pp2` Export orientation | Remove | 2015 |
| `vr1`–`vr4` Votes | Remove | All fall outside 21 Dec 2018 to 21 Nov 2019 |
| `oi7`, `oi8` Attendance, questions asked | Remove | Whole-MP activity across four Parliaments, not this office |
| Career facts grid, positions table, education, "Major policy areas (derived)" | Remove | Out of scope. Office facts are now derived (1c); "Other offices held" gives the context |
| Research notes, Responsibility & attribution, full legend, "For researchers" | Remove | D3, E2, F1, E10 |

### 2e. Expected consequence
"Decisions & votes" will be empty for Harsha de Silva. Render one honest line through the right primitive, for example "No recorded votes or decisions on this office's subjects during the term have been located." **Don't widen the rule to fill it.** List it under open decisions.

---

## Task 3: Remove editorialising (D1–D4, E3, E5)

- **Delete these fields and their columns:** `voterTakeaway` ("What it tells the voter"), `peopleEffect` ("Effect on people"), free-text `attributionCaution`, `researchNotes`, `responsibilityAttribution`, `responsibilities.scope`, `responsibilities.authorityNote`, and `roleSummary` wherever it only restates the title.
- **No predictions.** Remove "Longer-term outcome" text that forecasts ("Could…", "Can…", "Better data can improve…"). A row states what a source says was intended (as "Stated aim") and what is recorded as having happened. If nothing is recorded, the status says so.
- **Attribution becomes a fixed enum** with fixed neutral labels, one per row. Starting point for the plan:
  - `documented-personal-action`: "Documented action by {name}"
  - `office-institution`: "Run by an institution under this office"
  - `government-wide`: "Government-wide; not attributable to this office"
  
  Final wording lives in i18n; propose it in the plan.
- **Neutral wording rule:** positive and negative results get equal treatment. No judgement adjectives (substantial, durable, strong, real-world, successful, failed). No instructions to the reader (should, compare, verify). Use numbers with units and dates instead.
- The political / institutional / implementation explanation leaves the profile. If `/about` has no place for it, don't build one now; list it as an open decision.

---

## Task 4: New page structure (single scroll)

### 4a. Remove tabs from this page only
- Remove `Tabs`/`TabPanel` usage, `PROFILE_TABS`, the per-tab jump rows and the tab activation inside `useHashNavigation`.
- `Tabs.jsx` and the `TabPanel` invariant stay exactly as they are for the tabbed layout.
- One sticky `SectionNav` under the hero, listing only the sections that actually render.

### 4b. Hero (C1, C5, G10)
- Portrait, name (`h1`), office title, portfolio areas as one plain line, term in the single date format, the scope sentence from 2b.
- **"Today" line**, derived: current office(s), party and district when the record has them. Parts that don't exist simply don't render. A person with no current office gets the existing site wording for that.
- **Record-level sourcing state once**, as a compact `VerifiedBadge` with a one-line native `<details>` explanation. Reuse the tabbed layout's `trust-bar` pattern.
- Delete `GlanceStrip`, the bordered "Focus role" box and the foot-of-page "Record status" block.

### 4c. The office
A plain definition list, not cards:
- appointments (each, with dates)
- gazetted duties in 1–2 sentences, or `Unavailable`
- institutions (the one list from 1d)

### 4d. What was done
- One table, **at most 4 visible columns** on desktop:

  | Action (title, with period underneath) | {Name}'s documented role (attribution label + one sentence) | What the sources show (recorded result, with "as of" date) | Status |
  |---|---|---|---|

- An expandable detail row, using the existing `RowMoreCell` pattern at **all** widths, holds: stated aim, the sourcing label (only if it differs from the record-level state) and citations.
- **One status enum:** Completed · Partly completed · Delayed · Not completed · Intended, outcome not established · Outcome not established · Sources conflict. Map the old free text (for example "Unable to verify" becomes "Outcome not established") and report every mapping.
- Rows in date order, oldest first. Date order is neutral; "most significant first" is a judgement.

### 4e. Decisions & votes
- Columns: Date | Matter | {Name}'s recorded action | Result.
- When a row is a reported public position rather than a recorded roll-call vote, show that as a short visible label. It changes what the row means, so it can't hide behind a tap.
- No filters and no "N of M shown" unless there are more than about 15 rows.

### 4f. Not in this record
- Derived from a fixed question list used for **every** portfolio page: gazetted duties, budget allocated, money spent, audit findings, votes and decisions during the term, measured results.
- List only the questions with no sourced answer, one short line each, using `Unavailable` semantics ("not recorded here"). Never imply that no such record exists.
- If nothing is missing, the section doesn't render.

### 4g. Other offices held
- Native `<details>`, closed by default, derived from canonical positions. One line each: title and dates.
- Reuse `Period` (exported from `src/pages/PersonPage.jsx`): "Present" only when a source says the role is ongoing, otherwise "end not recorded". No badges.
- Reason: a slug mapped to a portfolio page never renders the tabbed layout, so without this the person's sourced offices would be unreachable anywhere on the site.

### 4h. Sources
- Keep the collapsible numbered list, the copy-link and copy-citation buttons, and `safeExternalHref`.
- Add a derived "Used for:" line naming the rows that cite each source.
- Replace the "URL unavailable" pseudo-button with muted text: "No link on record" (G11).
- Unlisted references appear once, as a single count line at the end: "{n} further references are not yet listed as sources."

### 4i. Labels explanation (F1)
Replace `LabelLegend` with a small closed `<details>`, "What the labels mean", listing **only the labels that actually render on this page**. Descriptions come from `VERIFICATION_PRESENTATION` and the status enum.

### 4j. Old links keep working
- Keep `#hds-sources` and `#hds-source-*`.
- Map the retired ids (`hds-glance`, `hds-labels`, `hds-outcomes`, `hds-promises`, `hds-programmes`, `hds-interventions`, `hds-indicator-*`, `hds-intervention-*`, `hds-votes`, `hds-attribution`, `hds-policies`, `hds-role`, `hds-career`, `hds-research`) to the nearest new section, in one small table inside the hash handler, so old shared links still land somewhere sensible.

---

## Task 5: One label system (F2–F4)

The two axes stay, but:
- **Sourcing axis** = the site's vocabulary only (Task 1a). "Not established" never appears on this axis.
- **Outcome axis** = the Task 4d status enum only. Remove `source-linked` from `EVIDENCE_STATUS`; it is a sourcing state.
- **Show by exception.** The record-level state appears once, in the hero. A row shows a sourcing label only when its state differs from the record-level state.
- No state is conveyed by colour alone: icon plus text.

---

## Task 6: Visual consistency and broken layout

- **Tables (G1, G2):** no table needs horizontal scroll at 1024px or wider. Delete the `min-width: 1150px` rules and the 4% details column. The details control sits in the title cell or works as a full-row toggle. Nothing breaks mid-word.
- **Leftovers (G3, G4):** delete "See in 01" and the hard-coded "2015 / Baseline".
- **Dates (G6):** one format from `formatDate` (for example "21 Dec 2018") and one way of writing ranges everywhere. **Verify first:** `Period` in `PersonPage.jsx` joins ranges with an en dash, while `docs/portfolio-profile-anti-slop-prompt.md` told this page to use a hyphen. Use whatever `Period` uses so this page matches the rest of the site, and tell me. Month-only or year-only dates show as recorded ("Apr 2018"), never padded with an invented day. Dates use the body font, not monospace.
- **Badges (G7, G13):** always in the same place within a component, after the text on the same baseline. The uneven card grid is gone with the career section.
- **Type (G8):** body content never below `--text-sm`. `--text-micro` and uppercase are only for table column headers and badges. Remove eyebrows and caps labels elsewhere. Section intros are at most one sentence, about 65 characters per line at most.
- **Colour (G9):** accent = links and focus only. Warning tone = warning states only (Delayed, Partly completed, Sources conflict, lower sourcing states). Write the mapping down in a short CSS comment block.
- **Dividers (G12):** one divider style, between top-level sections only. No partial-width rules.
- **Contrast:** check muted text and badges against WCAG AA (4.5:1 for text, 3:1 for non-text) in both dark and light themes, using the real token values. Report the numbers.
- **Mobile (below 768px):** stacked rows show title, period and status; the rest sits behind "More details". The sticky nav scrolls horizontally and never covers a heading (`scroll-margin-top`).
- **Dead CSS:** delete styles for removed pieces (glance strip, legend, tabs wrap, triple grid, career grid, tier pill, voting controls, and the intervention detail row if unused). Grep each class name first.

---

## Task 7: Make it a real template

- **New `PortfolioProfileContent` contract** (exact TypeScript in the plan). Content supplies only researched material: `slug`, the focus position(s) it documents, `portfolioAreas`, duties and institutions with citations, `actions[]`, `decisions[]`, `sources[]`.
- **Derived, never authored:** name, term, "Today" line, other offices, scope sentence, record-level state, "Not in this record" list, legend entries. Keep the existing portrait handling.
- Every row type carries **structured dates** (ISO start, optional end, plus a display string only where the source is less precise), so scope checks, sorting and "during the term" are computable.
- **No person-specific text in the component:** no "de Silva", no year in a column header. Headings interpolate `{name}`.
- **Defined empty behaviour for every section:** The office, What was done, and Decisions & votes each render one honest empty line. Not in this record, Other offices held and the labels explanation don't render when empty. Never an empty table.
- **Second fixture to prove it:** in the test file only, render the component for a real slug from the bundle whose record includes a ministerial position, with an empty content object (no actions, no decisions, no sources). It must render cleanly. Don't register it in `profileContent.ts` or make it reachable by any route.
- Update the doc comment in `profileContent.ts` with a short "Adding a person" checklist: highest-ranking office rule, inclusion rule, citation rules, archive file, tests.
- Fix the stale header comment in `harshaDeSilva.ts` ("does not generalise to anyone else") to match what the file now is.

---

## Task 8: Languages (G14)

- Every UI string on this page goes through `t()` with keys in `en.js`, `si.js` and `ta.js`: headings, nav labels, column headers, status and attribution labels, empty states, the scope sentence template, "Today", "Used for", and the labels explanation. `keyParity.test.ts` must pass.
- Researched content stays in English. When the language isn't English, show one translated line near the top: "The details of this record are available in English only." Don't machine-translate claims.
- Put Sinhala and Tamil drafts of every new string in the final report under **"Needs native review"**.

## Task 9: Copy rules for everything visible

- Plain words, short sentences, active voice. A 15-year-old should be able to follow it.
- One idea per cell. Numbers carry units and "as of" dates.
- No methodology defences in section intros; that belongs on `/about`.
- No judgement adjectives, no predictions, no instructions to the reader, no scores, grades, rankings or percentages of promises kept.
- No internal vocabulary (list in 1e). No new em dashes in visible strings.

---

## Tests to add or update

The "PortfolioProfile — tab structure" suite in `src/pages/PersonPage.test.jsx` asserts things this brief removes on purpose (the tablist, jump rows per tab, 01–10 ordering, at least six tables, the "No further detail" count). Rewrite those assertions to the new intent. **Don't delete tests just to make them pass.**

Add (markup-only, no jsdom):
1. No `role="tablist"` on the portfolio page. Sections render in the order office → what was done → decisions & votes → (not in this record) → (other offices held) → sources, and the nav lists exactly the sections that rendered.
2. Hero term and appointments equal the canonical positions from `getPersonBySlug('harsha-de-silva')` formatted with `formatDate`, read from the data in the test, not string literals.
3. The content file's declared focus position(s) match the precedence rule's result (2a).
4. Every action and decision in `harshaDeSilva.ts` falls inside the term, or is marked as a later result of an in-term action.
5. No row renders "Verified" unless `normaliseClaim()` returns VERIFIED for that row's claim.
6. The labels explanation lists exactly the labels that render.
7. None of these appear in the rendered markup: "What it tells the voter", "Effect on people", "Potentially positive", "strengths", "should still verify", "dossier", "prototype", "research file", "transcribed", "Tier", "See in 01", "2015 / Baseline", "records shown".
8. Unlisted references are never links and never print a bare `S` + digits token.
9. The empty-content fixture from Task 7 renders with no empty `<table>`.
10. Content inside closed `<details>` and hidden detail rows is present in the SSR markup.
11. The retired `/politician/harsha-de-silva` checks in `routeManifest.test.ts` and everything in `PortfolioProfile.copy.test.jsx` still pass.

## Verification (all must pass before you report done)

```bash
npm run typecheck
npm run lint
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # separate terminal; heed the stale-build warning
npm run validate:crawlability # HARD GATE: must stay 1623/1623
```

Then check the real output on `serve:dist`, not `npm run dev` or `npm run preview`:
1. Open `dist/person/harsha-de-silva/index.html` and confirm the term, both appointments, every section, the closed "Other offices held" list and the sources are in the static HTML.
2. `/politician/harsha-de-silva` still resolves and declares the `/person/...` URL canonical.
3. Check at about 1440px, 1280×720, 1024px, 768px and 390px, in dark and light themes: no horizontal page or table scroll at 1024px and up, nothing breaks mid-word, the sticky nav never covers a heading.
4. Browser console: **no hydration warnings.**
5. Keyboard only: Tab reaches the nav, every row toggle, every `<details>`, and every source button, with visible focus.
6. Old links: open `#hds-votes`, `#hds-outcomes` and `#hds-source-s1` directly; each lands on a sensible section.
7. Switch the language to Sinhala and Tamil: page chrome changes, the English-only notice appears, nothing overflows.

## Out of scope: do NOT change

- Database, sync, importers, identity overrides, slugs, route list, CSP, theme script.
- `TabbedPersonPage`, `Tabs.jsx`/`TabPanel` and their invariant.
- `PersonDecisionPage.jsx` and `DecisionProfilePrototype.jsx` (report on them only).
- Site header, footer, homepage, directory and About page content.
- New sources, new research or new data categories (budgets, audits). Gaps are shown, not filled.
- Renaming the `hds-` class and id prefix.

## Final report format

1. Summary of changes per task (1–9).
2. Files changed.
3. Test and verification results, with command output summaries and the crawlability count.
4. The Task 2d scope table as actually applied, with the archive file path.
5. S-reference table: each S-id, whether it mapped to a listed source, and why.
6. Data conflicts (A3–A6, A8, A11): what the data showed and what the page shows now.
7. Label changes: rows whose sourcing label changed under `normaliseClaim`, and every old-to-new status mapping.
8. Contrast ratios measured.
9. **Needs native review:** every new or changed Sinhala and Tamil string, with its English source.
10. **Open decisions for Pasan:**
    - "Decisions & votes" is empty for Harsha de Silva under the term rule. Keep it that way, or widen to subject-related votes at any time?
    - Keep the "Today" line and the closed "Other offices held" list, or cut them too?
    - Where the attribution explanation and the office-ranking rule should live on `/about`.
    - `PersonDecisionPage.jsx` is imported nowhere and refers to a missing `docs/accountability-data-roadmap.md`.
    - The `hds-` prefix is named after one person inside a shared template.
    - Anything you skipped, and why.
