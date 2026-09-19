# Readability & calm-reading pass — /person/harsha-de-silva (PortfolioProfile only)

Copy-paste prompt for Claude Code. Scope is deliberately narrow: two files,
one page. Nothing else on the site changes.

---

Improve the typography, readability and calm-reading quality of exactly one
page in this codebase: the portfolio profile at
`http://127.0.0.1:5173/person/harsha-de-silva` (`npm run dev`).

## Skill to load first

`/pg-font-psychology-readability-relaxing` — load it before reading any CSS.
Work its three layers **in order** and never trade an earlier one away for a
later one:

1. **Legibility** — contrast, size, measure, spacing.
2. **Readability** — hierarchy, rhythm, chunking.
3. **Psychology** — fluency, restraint, whitespace, "keep reading".

Use its Workflow B fix-order (§8B) as the order of work, and its §8C audit
checklist as the exit gate. A "calmer" page that reads worse is a regression.

## Scope — hard boundary

Editable:
- `src/pages/PortfolioProfile.css`
- `src/pages/PortfolioProfile.jsx` — only where a CSS-only fix is impossible
  (e.g. a wrapper element for a measure cap, `lang` attributes, a `<col>`
  change). Do not restructure the sections or reorder the content.

Editable **only if you argue for it first** and keep the edit to prose shape,
never to a claim:
- `src/data/harshaDeSilva.ts` — paragraph chunking (see finding 6). Every
  string there is a published civic record. You may split a sentence into two
  or reorder clauses for front-loading. You may **not** soften, strengthen,
  merge or drop a factual claim, a caveat, an evidence status or a source.

Read-only, for context: `src/styles/tokens.css`, `src/styles/base.css`,
`src/styles/components.css`, `src/pages/PersonPage.jsx`,
`docs/typography-audit-2026-09-04.md`.

Do not touch: any other page or stylesheet, `Chrome.jsx`, `Primitives.jsx`,
the router, i18n files, `src/data/**` (other than the file named above),
`server/**`, the build scripts.

## Context you must respect

- **The site-wide typography audit is already done and applied.**
  `docs/typography-audit-2026-09-04.md` fixed body size (15px → 16px), added
  `--measure: 66ch` on `p, li, .lede, dd`, fixed paragraph rhythm, set a 12px
  micro floor, measured and lifted contrast, added `font-synthesis: none`,
  `text-wrap: pretty`, `tabular-nums` and the dark-mode weight pin. **Do not
  redo any of it, and do not re-derive its numbers.** This pass is about one
  page that opted *out* of several of those fixes locally.
- **Tokens already exist — use them, never invent a value.** Sizes
  `--text-micro` 12px / `--text-xs` 13 / `--text-sm` 14 / `--text-base` 16 /
  `--text-md` 17 / `--text-lg` 19 / `--text-xl` 22 / `--text-2xl` 26 /
  `--text-3xl` 32. Leading `--lh-tight` 1.15 / `--lh-heading` 1.25 /
  `--lh-snug` 1.45 / `--lh-body` 1.6 / `--lh-relaxed` 1.7. Measure
  `--measure` 66ch / `--measure-wide` 72ch / `--measure-lede` 60ch. Tracking
  `--track-display` −0.02em / `--track-body` 0 / `--track-label` 0.08em /
  `--track-button` 0.015em. Spacing `--space-1..24` on a 4px base. If you
  need a value that does not exist, say why in your report rather than
  hardcoding a rem.
- **The three-family system is settled and correct.** Source Serif 4
  (headings) + IBM Plex Sans (body/UI) + IBM Plex Mono (section numbers,
  source numbers, tabular accents) is exactly the skill's ceiling
  (§1: two families + mono). **Do not add, swap or remove a family.** Only
  400/500/600 are self-hosted and `font-synthesis: none` is set, so any
  weight outside those three will silently not render — check before you use
  one.
- **Do not touch the colour hues.** Every text colour in
  `src/styles/tokens.css` carries a measured ratio in its comment
  (`--text-muted: #4B5759` = 7.02:1 on `--background`, 6.66:1 on
  `--surface-soft`). If you believe something fails, **measure it and quote
  the ratio**; do not adjust a hex on instinct. Remember the skill's §4
  correction: AA 4.5:1 is the floor, 7:1 is AAA — do not report a compliant
  value as a failure.
- **This page is prerendered.** `npm run build` runs `vite build --ssr` plus
  `scripts/prerender.mjs`, and `npm run validate:crawlability` is a hard gate
  on the static HTML. Nothing you add may hide text by default or depend on
  JS to become readable.
- **No dependencies.** No font loader, no CSS framework, no polyfill. All 16
  current dependencies are used and the absence of the rest is a documented
  position.
- **The brief is restraint.** This is a civic accountability record whose
  evidence statuses include "Not established" and "Intended only". Typography
  here exists to make an honest record easy to read, never to make a finding
  look more or less certain than the source supports. Do not let a
  readability fix change which claim looks loudest.

## Findings — this is my read; argue with it

In the skill's fix-order. Verify each in the browser before acting; if a
finding is wrong, say so and skip it.

### 1 — Prose opts out of the site-wide measure cap · high

`base.css:344` caps `p, li, dd` at `--measure-wide` (72ch). `PortfolioProfile.css`
overrides that back to `max-width: none` in six prose places:

| Line | Selector |
|---|---|
| 186 | `.hds-profile__focus-note` |
| 220 | `.hds-profile__disclosure p` |
| 304 | `.hds-profile__section-intro` |
| 390 | `.hds-profile__prose-card--scope p` |
| 444 | `.hds-profile__note` |
| 466 | `.hds-profile__evidence-note` |

The container is `--container: 1200px`, so at `--text-sm` these run roughly
**150–165 characters per line** — about double the skill's 45–75 CPL band and
well past WCAG 1.4.8's 80-CPL AAA ceiling. Measure it in the browser rather
than trusting my estimate.

This is the highest-leverage item on the page, and Baymard's finding is the
sharp end of it: full-width text does not merely read worse, it gets *skipped*.
The text being skipped here is the page's epistemic caveats — "not this
person's full political career", "'Not established' … does not mean the event
did not occur". Those are the sentences that most need to be read.

Note which of the six are boxed notes with their own padding
(`.hds-profile__note`, `.hds-profile__evidence-note`): the box may stay
full-width if that reads better; the **line** must not. Cap the text, not
necessarily the container.

The line-105 `max-width: none` on `.hds-profile__heading` is a different case
— it overrides the global 26ch heading cap so section titles do not wrap into
narrow stacks. Leave it; headings are not the paragraphs this finding is about.
`.hds-profile__prose-card p` (line 408) already uses `max-width: var(--measure)`
with `--lh-relaxed` — that rule is the model, extend it, don't rewrite it.

### 2 — Load-bearing prose sits at 14px · high

`--text-sm` (14px) currently carries `.hds-profile__focus-note` (188),
`.hds-profile__disclosure p` (226), `.hds-profile__section-intro` (306),
`.hds-profile__note` (449) and `.hds-profile__evidence-note` (471). The skill's
floor for primary body copy is 16px, and the site-wide audit already moved
body to `--text-base` everywhere else.

Decide per-item whether each is genuinely secondary (a caption, a label) or is
body copy wearing a caption's clothes. My read: `focus-note`, `disclosure p`
and `evidence-note` are body copy — a reader is expected to *read* them, not
glance at them. `section-intro` is arguable. Move what qualifies to
`--text-base`, keep `--lh-body` or `--lh-relaxed`, and say in your report which
you left at 14px and why.

Do not go below `--text-micro` (12px) anywhere, and do not combine 12px +
uppercase + `--track-label` + `--muted` on anything longer than two words —
that stack costs three legibility penalties at once (audit #4).

### 3 — Paragraph rhythm inside the page · medium

Check the vertical gap between consecutive prose blocks against the skill's
rule: paragraph gap ≥ 1.5× line height, and space **above** a heading greater
than the space below it. `.hds-profile__section` uses `--space-10` padding and
several rules set `margin: 0 0 var(--space-4)`. At 16px/1.6 the line box is
~26px, so a 16px gap is roughly half of what the rule asks. Fix with the
spacing scale; do not introduce new values.

### 4 — The programmes table is below the short end of the measure band · medium

`colgroup` widths at lines 514–520 are 20/11/17/16/10/11/15%. On a ~1150px
content width at `--text-sm` that is roughly **16–33 CPL per cell** — under the
45-CPL floor, where constant line breaks fragment the sentence. The table is
therefore failing the measure rule from the *other* direction, and every cell
holds a full sentence, not a datum.

Options to weigh and argue in your report, cheapest first: raise the cell font
size and leading; widen the two narrative columns at the expense of `Type` and
`Financial evidence`; or let the table alone exceed the container while prose
stays capped. **Do not solve it by removing a column or truncating a cell** —
the seven columns are the record, and the CLAUDE.md invariants treat a dropped
fact as a regression, not a simplification.

Also verify the 900px card-layout breakpoint (line 811) still reads as rows of
labelled facts once cell sizes change.

### 5 — Dark-mode weight pin does not reach this page's text elements · low

`base.css:258–274` pins `body, p, li` to 400 in dark mode, because light-on-dark
strokes bloom (audit #7; the `GRAD` axis is unavailable since `/fonts` ships
static cuts). This page puts a lot of its prose in `dd` (the glance list),
`td` and `th` (the programmes table) — none of which that selector list
covers. Confirm in dark mode, and if it blooms, extend the pin **locally in
`PortfolioProfile.css`**, not in `base.css`.

While you are in dark mode: confirm no pure `#000`/`#fff` (tokens use `#10191B`
/ `#E7EEEB` — they are fine) and that the five evidence-status pill colours
(628–632) each still pass 4.5:1 against their own backgrounds in *both* themes.
Those pills are the one place on the page where colour carries meaning, so
also confirm the label text is doing the work and the colour is only
reinforcement — the skill's "never colour alone" rule.

### 6 — Chunking and front-loading in the content · medium, needs your argument first

`src/data/harshaDeSilva.ts` holds several 40–60-word single-sentence
paragraphs (`hero.focusExplainer`, `responsibilities.roleSummary`,
`responsibilities.scope`). The skill asks for 2–4 sentence paragraphs with the
point front-loaded, because a wall signals effort and gets abandoned.

Propose the rewrites as a diff in your report **before** applying them, and
hold the line stated in the Scope section: shape may change, claims may not.
If you cannot split a sentence without changing what it asserts, leave it.

### 7 — Polish, only after 1–6 land

- `font-variant-numeric: tabular-nums` reaches `table` and `time` globally
  (`base.css:555`) but not the dates rendered as plain text in
  `.hds-profile__source-meta` ("18 May 2019"). One line if it looks better.
- `text-wrap: balance` is on the h1; check whether the `SectionHeading` h2s
  want it too, especially the long section-03 title.
- Confirm the mono section numbers and `Sources 02 · 04` refs are tracked and
  sized so they read as navigation, not as data.
- `--track-label` (0.08em) on uppercase micro-labels: confirm it is applied
  everywhere caps appear, and nowhere lowercase body does.

## What is deliberately NOT in scope

- The font families and the three-family ceiling.
- The colour hues, and any token whose comment already records a measured
  ratio.
- The dark-theme architecture (`--d-*` indirection, two entry points).
- Decorative border colours — darkening them meets a rule that does not apply
  and costs the calm the palette was built for.
- The section order, the seven table columns, the evidence statuses, the
  source list, and every factual claim on the page.

## Verification — run before calling this done

Browser checks on `npm run dev`, both themes, at 1440 / 900 / 720 / 390px:

- [ ] Every prose block measures 45–75 CPL (measure the rendered column, not
      the container); nothing exceeds 80
- [ ] No body-copy paragraph below 16px; nothing on the page below 12px
- [ ] Body line-height ≥ 1.5, unitless
- [ ] Body text ≥ 4.5:1 (target 7:1); pills, links, focus rings ≥ 3:1 — quote
      the measured ratios in your report, do not assert "passes"
- [ ] Hover, focus and `:target` states each pass contrast independently
- [ ] Paragraph gap ≥ 1.5× line height; space above headings > space below
- [ ] Still 3 families, still 3 weights (400/500/600)
- [ ] Heading levels still semantic and in order (h1 → h2 → h3), still
      visibly distinct
- [ ] WCAG 1.4.12: apply line-height 1.5×, letter-spacing 0.12em,
      word-spacing 0.16em via DevTools — the page and the 7-column table must
      **reflow, not clip**
- [ ] Dark mode: no bloom, no pure black/white
- [ ] `prefers-reduced-motion` still honoured; nothing you added animates
- [ ] Tested with the longest real strings on the page (the section-03
      heading, the "Non-Cabinet Minister of Economic Reforms & Public
      Distribution" role, the seven institution names)

Then the code gates:

```bash
npm test
npm run typecheck
npm run lint
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist          # in one terminal
npm run validate:crawlability   # must stay 1623/1623
```

`npm run preview` is not a substitute for `serve:dist` — it answers deep
routes with the SPA shell and will make a broken build look fine.

## Report format

Finish with a short written report, not a wall of diff:

1. Which findings you confirmed, which you rejected, and the measured number
   behind each call (CPL, px, ratio).
2. The before/after for each change, in tokens.
3. Anything you chose not to fix, and why — including any place where the
   calm-reading goal and the record's honesty pulled against each other, and
   which one you let win.
