# Claude Code prompt — Harsha de Silva decision profile (single-person prototype)

Paste everything below the line into Claude Code, run from the repo root.

---

Build a **single, hardcoded prototype page** for ONE politician — Harsha de Silva — that
demonstrates a new "decision-first" profile layout for SL Politics. This is a
design prototype, not a production feature: it must NOT touch the importer, the
repository boundary, the route manifest, or any existing profile component.

## Scope rules (read these first, they are absolute)

1. **One person only.** Every value on this page is hardcoded for Harsha de Silva.
   Do not generalise, do not add props, do not build it for the whole dataset.
   No loops over the people universe. No `getPersonBySlug`.
2. **Do not modify any existing file** except adding the one new route entry
   described in step 6. Specifically do not touch `src/services/repository.ts`,
   `src/lib/routeManifest.ts` logic, the adapters, `server/`, or `scripts/`.
3. **New file only:** `src/pages/DecisionProfilePrototype.jsx` (`.jsx`, per the
   project convention — do NOT write `.tsx` for components). Relative imports
   carry explicit file extensions.
4. **Add no dependencies.** No CSS framework, no chart library, no icon package.
   Plain CSS in a co-located `DecisionProfilePrototype.css`, or a `<style>` block
   in the component — your choice, but self-contained.
5. **THE NUMBERS IN SECTION 02 ARE FAKE PLACEHOLDERS.** The ministry budget
   figures, spend percentages and audit-finding counts below are invented to show
   the layout. Render every one of them wrapped in a visible
   `PROTOTYPE — ILLUSTRATIVE FIGURES, NOT REAL DATA` banner pinned at the top of
   the page, and add a code comment marking each fake value. Under no
   circumstance may this page be linked from the live site or added to the
   sitemap while those numbers are present. Real figures come from the Auditor
   General and Treasury and are not yet imported.

## Design tokens — use these exact values

```css
--bg:      #0d1512;   /* page background */
--panel:   #111c18;   /* card background */
--panel2:  #152420;   /* nested tile inside a card */
--line:    #22352e;   /* all borders and rules */
--ink:     #e8f0ec;   /* primary text */
--muted:   #8ea79c;   /* secondary text */
--dim:     #678075;   /* labels, captions, "not published" */
--gold:    #c8a86a;   /* accent: section numbers, source tags, left border */
--good:    #5fb08a;   /* "currently serving" dot, favourable delta */
--warn:    #d9a441;   /* caveat heading */
--bad:     #d1685f;   /* unfavourable delta */
```

Typography:
- Display / headings: `'Iowan Old Style','Palatino Linotype',Georgia,serif`, weight 500.
- Body: system UI stack, 15px / 1.55.
- All numbers and dates: `ui-monospace,'SF Mono',Menlo,monospace`.
- Uppercase micro-labels: 10.5–11px, `letter-spacing:.09em`, colour `--dim`.

Layout: single column, `max-width:1080px`, centred, `padding:0 28px`.
Cards: `border-radius:8px`, `1px solid var(--line)`, background `--panel`.
No shadows. No gradients except the two noted below. No rounded pills except chips.

## Page structure — five blocks, in this order

**Top bar.** `◈ SL Politics` in serif on the left; `Home · Current Government ·
Directory · Compare` on the right, 13px, colour `--muted`. Bottom border `--line`.

**Hero.** Two-column grid `118px 1fr`, gap 24px.
- Left: 118×142px portrait placeholder, `border-radius:4px`, background
  `linear-gradient(160deg,#2b3d36,#1a2a24)`.
- Right: `<h1>` "Harsha de Silva" at 40px serif, `letter-spacing:-.4px`.
  Subtitle "Member of Parliament — Colombo District" in `--muted`.
  Three chips below: `● Currently serving` (text `--good`, border `#2c4d40`),
  `Samagi Jana Balawegaya`, `Every fact below links to its source`.

**Fact strip.** Four equal cells in a 1px-gap grid whose gap colour is `--line`
(grid background `--line`, each cell background `--panel`), single rounded border
around the whole strip. Each cell: uppercase micro-label, then a 19px serif value,
then an 11.5px `--dim` note.

| Label | Value | Note |
|---|---|---|
| AGE | 62 | born 30 Aug 1964 |
| IN PARLIAMENT | 15 yrs | since 2010, 4 terms |
| BEFORE POLITICS | Economist | PhD, Univ. of Missouri |
| POSITIONS OF POWER | 5 | 2 ministries, 3 deputy |

**Section header pattern** (reused four times): a monospace gold number
(`01`–`04`), a 23px serif heading, and a right-aligned italic `--dim` question.
Bottom border `--line`, 9px padding below.

---

### 01 — Before politics
Question: *"What did he do before we gave him power?"*
Two cards side by side, 1fr 1fr, gap 14px. Inside each: rows with the label left
and the value right-aligned in `--muted` 12.5px, separated by
`1px dashed #1e2f29` (last row no border). Values that are absent render in
italic `--dim` as the literal words **not published** — never as a blank, a dash,
or a zero.

Card "EDUCATION":
- PhD, Economics → Univ. of Missouri, USA
- MA, Economics → Univ. of Missouri, USA
- G.C.E. Advanced Level → *not published*
- School → *not published*

Card "WORK & PROFESSION":
- Stated profession → Economist
- Employers before 2010 → *not published*
- Professional licences → *none on record*
- Board / company roles → *not published*

Note the deliberate distinction: *not published* (nobody published it) vs
*none on record* (the source states there are none). Keep them different — this
mirrors the project's existing Unavailable/Unrecorded/NotVerified rule.

---

### 02 — What he was responsible for
Question: *"What happened in the country while he held it?"*

Three cards, each with `border-left:3px solid var(--gold)`.
Header row: office name in 20px serif on the left, tenure in monospace `--muted`
right-aligned (`2015 — 2017 · 2 yrs`). Under the name, a `--muted` 13.5px line
beginning `Scope:` describing what that office actually controls.

Then a 3-column grid of indicator tiles, background `--panel2`, border `--line`,
radius 6px: uppercase micro-label, 16px monospace value, 11.5px delta line
coloured `--bad` when the direction is unfavourable, `--good` when favourable,
`--muted` when neutral.

Card 1 — **Deputy Minister of Foreign Affairs**, `2015 — 2017 · 2 yrs`
Scope: diplomatic missions, visa policy, foreign service budget
- MINISTRY BUDGET → `Rs 8.1bn → 9.4bn` / +16% over tenure (bad colour)
- BUDGET ACTUALLY SPENT → `86%` / of allocation (muted)
- AUDIT FINDINGS → `3 raised` / 1 unresolved (bad colour)

Card 2 — **State Minister of National Policies & Economic Affairs**, `2017 — 2018 · 1 yr`
Scope: national planning, economic policy coordination
- MINISTRY BUDGET → `Rs 24.6bn` / no prior-year figure (muted)
- BUDGET ACTUALLY SPENT → `71%` / Rs 7.1bn unspent (good colour)
- AUDIT FINDINGS → *not published* rendered in italic `--dim` at 14px in the
  body font, NOT in monospace — an absent value must never look like a number.
  Delta line: "report not online".

Card 3 — **Member of Parliament** with a 12px `--dim` suffix "— no ministry",
tenure `2010 — 2015, 2024 — now`, left border colour `#2b4038` instead of gold
(no ministry = no accountability data). Scope line: "voting, questions, committee
work. No budget under his control." No indicator tiles. Just the caveat box
reading: *"An ordinary MP controls no ministry, so there is nothing to measure
here except how he used the seat — attendance, votes and questions."* with
**Not yet loaded on SL Politics.** in `--warn` bold.

**Source line** under the tiles on cards 1 and 2: an `S007` monospace tag
(border `--line`, gold text, 10px), then 11.5px `--dim` text naming the source
and years, then an underlined "See the exact pages".

**Caveat box** on card 1 (background `#16211d`, `1px dashed #2b4038`, radius 6px,
12.5px `--muted`), opening with **Read this carefully.** in `--warn` bold:
*"These are national figures for the ministry during his term. They are not a
score, and they are not proof he caused them — a minister inherits budgets,
crises and staff. Use them as a starting question, not a verdict."*
This caveat is not optional decoration; do not remove or shorten it.

---

### 03 — What nobody publishes about him
Question: *"What you are not being told"*
One card, rows separated by `1px solid #1a2a24`. Each row: a 7px `--dim` dot, the
item name, and a right-aligned 12px `--dim` reason.

- Assets & liabilities declaration → filed by law — not made public in Sri Lanka
- Campaign funding & donors → no public register exists
- Election results & preference votes → Election Commission — not yet connected
- Court cases or investigations → SL Politics does not publish allegations

Below the card, 12.5px `--dim`: *"An empty line above means **nobody published
it** — not that he is clean, and not that he is guilty."*

---

### 04 — Go deeper
Question: *"for journalists & researchers"*
One panel, `1px solid #2a3d34`, background `linear-gradient(180deg,#14201c,#111c18)`.
Heading (17px serif): "The full record — every vote, question, bill, committee and
attendance figure". Body in `--muted`, max-width 600px: "4,180 raw records for this
member, with source links and a CSV export, so you can run your own analysis
instead of trusting ours. Built for newsrooms, researchers and civil society."
Then an outlined button, gold border and gold text, radius 5px: `See what's inside →`.
The button is inert in this prototype — no href, no handler.

**Footer.** Top border `--line`, centred 12px `--dim`:
"SL Politics by Javora — public records, clearly presented and traceable to their
source. Last retrieved 29 Aug 2026."

## Behaviour and quality bar

- **Static and accessible.** No client-side state, no tabs, no accordions, no
  animation. The entire page is visible in the DOM on first paint, so it
  prerenders and stays crawlable by construction.
- Semantic HTML: one `<h1>`, `<h2>` per section, `<dl>` or a table where the
  content is genuinely label/value pairs. Every colour pairing must clear WCAG AA
  for its text size — check `--dim` on `--panel` in particular and lighten `--dim`
  if it fails.
- Responsive: below 720px the fact strip becomes 2×2, the two "before politics"
  cards stack, and the indicator tiles become one column. Nothing scrolls
  horizontally.
- Print-safe is not required.

## Route

Add exactly one prototype route: `/prototype/decision-profile`. Wire it the same
way the codebase already resolves routes — **do not invent a router and do not add
one as a dependency**. Read `src/lib/routeManifest.ts` first to see how routes are
declared, follow that pattern, and **exclude this route from the sitemap and from
prerendering** (it is a prototype with fake figures; it must not be indexed).
If excluding it cleanly is not possible without changing manifest logic, stop and
tell me rather than editing the manifest's behaviour.

## When you are done

1. Run `npm run typecheck` and `npm run lint` — both must pass clean.
2. Run `npm test` — the existing 784 tests must all still pass. You have changed
   no shared code, so any failure means you touched something you should not have.
3. Start `npm run dev` and give me the URL.
4. Report in three lines: the files you created, the one file you edited for the
   route, and confirmation that the prototype route is out of the sitemap.

Do not commit anything.
