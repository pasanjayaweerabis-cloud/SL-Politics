# Motion pass — /person/harsha-de-silva (PortfolioProfile only)

Copy-paste prompt for Claude Code. Scope is deliberately narrow: two files.

---

Add motion to exactly one page of this codebase: the portfolio profile at
`http://localhost:61994/person/harsha-de-silva` (dev server: `npm run dev`).
Nothing else on the site changes.

## Skills to load first, in this order

1. `/animation-vocabulary` — name every effect before you build it. If an effect
   has no name in that glossary or in `docs/motion-vocabulary.md`, you are
   probably inventing a fourth way to fade something in.
2. `/find-animation-opportunities` — run it scoped to the two files below only,
   not the repo.
3. `/animate` — the web skill. **Not `/animate-expo`**: this is React 19 + Vite
   for the browser, not React Native.
4. `/emil-design-eng` — for the craft bar on the implementation.
5. `/improve-animations` — as a final self-review pass over your own diff.

## Scope — hard boundary

Editable:
- `src/pages/PortfolioProfile.jsx`
- `src/pages/PortfolioProfile.css`
- `docs/motion-vocabulary.md` (append new rows only, never rewrite existing ones)

Read-only, for context: `src/styles/tokens.css`, `src/styles/base.css`,
`src/styles/components.css`, `src/pages/PersonPage.jsx`.

Do not touch: any other page, `Chrome.jsx`, `Primitives.jsx`, the router, the
i18n files, `src/data/**`, `server/**`, the build scripts.

## Context you must respect

- **No animation libraries.** Runtime dependencies are `react`, `react-dom`,
  `pg`. Do not install framer-motion, GSAP, motion, or anything else. CSS and
  native browser APIs only. If JS is genuinely required, plain
  `useEffect` + `IntersectionObserver` inside `PortfolioProfile.jsx`.
- **This page is prerendered.** `npm run build` runs `vite build --ssr` plus
  `scripts/prerender.mjs`, and `npm run validate:crawlability` gates on the
  static HTML. So: never ship a rule whose *default* CSS state is
  `opacity: 0` / `visibility: hidden`. Any entrance must either be a
  self-terminating keyframe animation that ends at the visible state, or use
  `@starting-style`, or have its hidden state applied from JS on mount. A
  scroll-reveal that hides content for a crawler or a no-JS reader is a
  regression on this project, not polish.
- **Motion tokens already exist — use them, do not invent numbers**
  (`src/styles/tokens.css`): `--ease` `cubic-bezier(0.32,0.72,0.29,1)`,
  `--dur` 220ms, `--ease-out` `cubic-bezier(0.23,1,0.32,1)`, `--dur-press`
  120ms, `--dur-fast` 140ms, `--dur-enter` 200ms, `--dur-exit` 140ms.
  House convention: 100–140ms for hover/press, 220ms for everything else.
- **A global reduced-motion override already exists** (`src/styles/base.css`,
  the `@media (prefers-reduced-motion: reduce)` block): it strips `transform`
  out of every transition site-wide and clamps `animation-duration` to
  0.001ms. Your work inherits it. Two consequences to verify rather than
  assume: (a) any keyframe entrance you write gets clamped to ~0ms, so its
  **end state must be the visible state** or reduced-motion readers get a
  blank page; (b) where the global rule is not enough, add an explicit
  `@media (prefers-reduced-motion: reduce)` opt-out inside
  `PortfolioProfile.css`.
- **Gate hover motion.** Anything moving `transform` or `box-shadow` goes
  behind `@media (hover: hover) and (pointer: fine)` — house rule, because
  `:hover` sticks after a tap otherwise. Plain colour changes are exempt.
- **`PortfolioProfile.css` currently has zero transitions and zero keyframes.**
  This is a greenfield motion pass on an otherwise finished page, not a repair.
- **The brief is restraint.** This is a civic accountability record with
  evidence statuses like "Not established" and "Conflicting". Motion here
  exists to orient the reader and confirm their actions. It must never
  dramatise a finding or make an evidence tag look like a notification.

## The gate — apply before writing a single line

For each candidate, state its frequency tier (100+/day → no animation;
tens/day → under 150ms or nothing; occasional → standard; rare → the delight
budget) and its purpose in one word (feedback, spatial consistency, state
indication, preventing a jarring change, explanation). Anything that fails the
gate ships zero lines, and you say so.

## Candidates — this is my read; argue with it

Likely yes:

1. **Source-anchor landing (`#hds-source-<id>`, `:target`).** Clicking
   "Sources 02 · 04" under a programme title jumps to section 04 with no
   confirmation of which record it landed on. A background/border crossfade on
   the targeted `.hds-profile__source` closes that loop. Purpose: explanation.
   Highest-value item on the page — build this one first.
2. **`.hds-profile__source-link` hover/focus** — colour plus a small icon nudge
   on the external-link glyph, matching `.action-link:hover svg` in
   `components.css`. 140ms. Purpose: feedback.
3. **`.hds-profile__row-sources a` hover/focus** — these numbered refs are the
   page's main interactive element and currently read as static text.
4. **`.hds-profile__disclosure` ("Why this role?") open/close.** Use an
   interruptible transition (`::details-content` + `interpolate-size`), never a
   keyframe — a `<details>` can be double-clicked. Note that `base.css` already
   carries a precedent for opting `::details-content` out under reduced motion.
   Must degrade to an instant open where unsupported.
5. **`.hds-profile__table tbody tr:hover`, desktop only** — a row tint helps
   cross-read a 7-column table. Colour only, no lift, and confirm it does not
   apply below 720px where rows become stacked cards.

Probably no — reject these unless you can make a real argument:

- Staggered entrance for table rows or the sources list. Rare-tier by
  frequency, but this is evidence; stagger makes a record feel like a landing
  page, and it fights prerendering.
- Count-up on the `.hds-profile__glance` figures.
- Hero fade-in, portrait parallax, scroll-linked section reveals, sticky or
  animated section numbers (`.hds-profile__sec-no`).
- Anything on `.hds-profile__status-tag` or `.hds-profile__evidence-note`
  beyond hover/focus feedback.

## Constraints

- `transform`, `opacity` and colour channels only. Never `width`, `height`,
  `top`, `left`, `margin`, `flex`. The one permitted exception is `block-size`
  on `::details-content`, where there is no alternative — flag it explicitly if
  you use it.
- No scroll-jacking, and do not override `scroll-behavior` or
  `scroll-padding-top` — `html` already sets both in `base.css`.
- Keyboard parity: every `:hover` effect also fires on `:focus-visible`. Never
  animate the focus ring away; the existing focus style at the top of
  `PortfolioProfile.css` stays exactly as it is.
- Dark theme: this page inherits the sitewide `.theme-switching` colour
  crossfade. Do not add `background-color`/`color` transitions that will
  double up during a theme flip.
- Zero layout shift. CLS must stay 0.
- Comment in this file's existing voice — this codebase writes *why* comments,
  not *what* comments. Match that or leave it uncommented.

## Deliverables

1. The edits to the two files.
2. New rows appended to the table in `docs/motion-vocabulary.md` — effect /
   where (with file:line link) / duration / easing, following the existing
   format exactly.
3. A short report: one row per candidate → tier, purpose, verdict, and what you
   rejected and why. No padding.
4. Verification, all of which must pass: `npm run lint`, `npm run typecheck`,
   `npm run test`, `npm run build`, `npm run validate:crawlability`. Then grep
   the prerendered HTML for `/person/harsha-de-silva` in `dist/` and confirm
   every section's text is still present and no element is left at `opacity: 0`
   in the static markup.
5. A manual check list for me: reduced motion enabled, keyboard-only tab pass,
   375px width, dark theme, and clicking a "Sources NN" ref from the programmes
   table.

## Rules of engagement

- Do not present me options. Make the call, give one line of reasoning, write
  the code.
- If the honest answer for a candidate is "this shouldn't animate", say it and
  ship nothing for it.
- Do not ask me questions before starting. Work through the whole thing and
  report at the end.
