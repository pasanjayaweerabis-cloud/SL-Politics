# Homepage rebuild + the remaining pages: typography, motion and anti-slop pass

Copy-paste prompt for Claude Code. SL Politics (`javora-react`), React 19 + Vite,
prerendered static site, no router library, no CSS framework, 16 dependencies and
no more.

Read `CLAUDE.md` first. Its invariants outrank every line of this prompt. Where
this prompt and `CLAUDE.md` disagree, `CLAUDE.md` wins and you say so in the
report.

Scope in one line: **the homepage gets rebuilt; the five other pages that three
previous passes marked read-only finally get the typography, motion and anti-slop
treatment the portfolio profile already had.**

---

## 0. Skills: load these, in this order

### Use these

1. **`/animation-vocabulary`** first, before anything else. Name every effect with
   its exact glossary term (Pop in, Stagger, Crossfade, Origin-aware animation,
   Scroll reveal, Rubber-banding) and cross-check `docs/motion-vocabulary.md`,
   which lists the motion that already ships. If an effect has no name in either
   place you are probably inventing a fourth way to fade something in. Don't.

2. **`/pg-font-psychology-readability-relaxing`** for section 6. This is a civic
   reference site whose whole job is that people read long records without
   fatigue, so the readability layer outranks the motion layer. Apply its fixing
   order literally: contrast, then measure, then line height, then size, then
   hierarchy, then font count, then whitespace, then noise, then polish.

3. **`/find-animation-opportunities`** for section 7, in its intended read-only
   mode: sweep, gate, report. Its Part 2 (rejected candidates) is not optional
   output. The gate exists to produce zero suggestions sometimes, and on a
   records site that is the expected result for most surfaces.

4. **`/animate`** for implementing whatever survives that gate. Full build
   sequence every time: should this animate at all, what is the purpose, cheapest
   tool that works, which properties, easing and duration, interruption and exit,
   then reduced motion and pointer gating. Obey its "Never Ship" table. If
   `RECIPES.md` is missing from the install, continue with `SKILL.md` alone
   instead of blocking.

5. **`/emil-design-eng`** and **`/review-animations`** as the review pass at the
   end, not during the build. `/review-animations` requires the Before/After
   markdown table and an explicit Block or Approve verdict. Run it on your own
   diff before you report. Default to flagging your own work.

6. **`/apple-design`** for section 9 only: the translucent chrome, the three
   independent accessibility signals (`prefers-reduced-motion`,
   `prefers-reduced-transparency`, `prefers-contrast`), and its typography rule
   that tracking is size-specific. Do **not** import its gesture, velocity-handoff
   or momentum-projection material. There is no drag surface anywhere on this site
   and building one is out of scope.

7. **`/pg-frontend-professionalui-reduce-ai-looks`** for section 8, partially. Read
   section 8 of this prompt before you apply it: most of that skill targets
   marketing landing pages and portfolios, and its own section 13 says it is not
   for dense product UI. About a third of it applies here. The rest will actively
   damage this site if applied literally.

### Do not use these

- **`/animate-expo`**: React Native and Expo. Reanimated, Gesture Handler,
  expo-haptics. None of it exists here and installing any of it violates the
  no-dependencies rule. Use it for exactly one thing: as a reminder during the
  375px check that touch has no hover, so every affordance behind
  `@media (hover: hover)` needs a press or static equivalent. Import nothing.

- **`/pick-ui-library`**: every recommendation it makes is a dependency, and
  `CLAUDE.md` says the absence of a router, HTTP framework, ORM, state library and
  CSS framework is a documented position argued in the code. Do not install
  base-ui, Sonner, Motion, cmdk, Virtuoso, zustand, clsx or cva. If you find
  yourself wanting one, the correct output is a paragraph in the report arguing
  the case, not an `npm install`.

- **`/web-artifacts-builder`**: it scaffolds a throwaway React + Tailwind + shadcn
  project and bundles it to a single HTML file for a chat artifact. This repo is a
  real Vite app with a prerender pipeline and a crawlability gate. Wrong tool.

- **`/theme-factory`**: it applies one of ten canned themes to a deck or artifact.
  This project already has an authored two-mode theme called Civic Calm, with a
  measured contrast audit written into the token comments. Replacing it with a
  preset is a regression, not a theme.

---

## 1. Before editing: inventory, do not rebuild

Run `git status` first. There is **uncommitted work** in
`src/pages/HomePage.jsx`, `src/styles/components.css`, `src/styles/layout.css`,
`src/styles/tokens.css` and `public/wallpaper1.png`. There is **no git remote**.
A lost diff is gone permanently. Build on top of what is there. Do not revert,
reformat or tidy unrelated lines, and do not commit unless asked.

Three motion passes have already landed. Read `docs/motion-audit.md`,
`docs/motion-audit-pass-3.md` and `docs/motion-vocabulary.md` before you write a
line. The following already exist and must not be rebuilt, duplicated or
"improved" without a stated defect:

| Already shipping | Where |
| --- | --- |
| Press scale on every pressable tier (`.btn` 0.97, `.action-link` 0.98, icon buttons 0.92, rows 0.99, cards 0.995) | `components.css`, `layout.css` |
| Origin-aware open/close on the typeahead and dropdown panels, `@starting-style` entrance, separate `--dur-exit` on close | `components.css:700+` |
| Drawer slide, scrim fade, interruptible exit state machine, link stagger | `layout.css:340+`, `Primitives.jsx` |
| Tab panel opacity crossfade via `@starting-style`, with `TabPanel` still rendering all children | `components.css` |
| Directory result reveal stagger at 25ms per `--reveal-index` | `components.css:394`, `Primitives.jsx:392` |
| Route View Transition, 160ms, `--ease-out`, skipped on `/directory` and under reduced motion | `router.tsx`, `base.css:229` |
| Theme toggle glyph crossfade, sitewide `.theme-switching` colour flip | `Chrome.jsx`, `base.css` |
| Global reduced-motion override that strips `transform` from every transition list | `base.css:192` |
| Hover gating behind `@media (hover: hover) and (pointer: fine)` in six places | `components.css` |
| Toast exit kept mounted one paint past dismissal so the closed state plays | `Toast.jsx` |

The motion vocabulary is settled. Your job is the pages that were fenced off, and
the homepage, not a fourth pass over the same components.

---

## 2. Scope: hard boundary

### Editable

- `src/pages/HomePage.jsx` (the rebuild, section 4)
- `src/pages/DirectoryPage.jsx`, `GovernmentPage.jsx`, `CorrectionsPage.jsx`,
  `NotFoundPage.jsx`, `PersonPage.jsx`
- `src/components/SearchTypeahead.jsx`, `SearchField.jsx` (section 5 only)
- `src/lib/typeahead.ts` (the Enter-confidence rule, section 5.3)
- `src/styles/components.css`: page-level selectors only. `.profile-card`,
  `.grid-cards`, `.grid-stats`, `.trust`, `.principle*`, `.divider-note`,
  `.section*`, directory and filter layout, `.gov-card`, typeahead panel internals.
- `src/styles/layout.css`: `.hero*` only
- `src/styles/tokens.css`: **extend only.** Add a token only when no existing one
  fits, and say in the report which one and why.
- `src/i18n/en.js`, `si.js`, `ta.js`: add keys for new copy. Every string you add
  needs all three locales. If you cannot write the Sinhala or Tamil, add the key
  with the English value and list it in the report as needing translation. Never
  ship a hardcoded English string in JSX.
- `docs/motion-vocabulary.md`: append rows, and fix file:line links on rows whose
  lines you moved. Do not rewrite other rows.

### Read-only, do not touch

- `src/pages/PortfolioProfile.jsx` / `.css`, `PersonDecisionPage.jsx`,
  `DecisionProfilePrototype.*`, `profile-decision.css`. Three passes already
  landed there.
- `src/services/repository.ts` with one exception, named in section 5.3.
- `src/lib/routeManifest.ts`, `src/lib/router.tsx`, `src/data/**`, `server/**`,
  `scripts/**`.
- `index.html`. Its inline theme script's sha256 is baked into the CSP. Editing it
  silently brings back the theme flash.
- `src/lib/externalUrl.test.ts`. It contains a deliberate NUL byte at offset 1914
  as attack-string test data. It is not corrupt. Do not repair it.

---

## 3. Constraints that fail the build if you break them

- **No dependencies.** Not one. CSS first (transitions, `@starting-style`,
  `::details-content`, `interpolate-size`, `scroll-snap`, `animation-timeline`),
  then WAAPI or `IntersectionObserver` in plain React if JS is genuinely required.
- **Crawlability is a hard gate.** `npm run validate:crawlability` currently passes
  1623/1623 and must still pass. Every chip, tile, avatar and card is a real
  `<a href>`. A card the directory declines to render is a profile with no
  crawlable link. Do not paginate by dropping links.
- **Never ship a rule whose default static state is invisible.** No `opacity: 0`,
  `visibility: hidden` or off-screen transform as the prerendered resting state.
  Entrances use `@starting-style`, a self-terminating keyframe that ends visible,
  or a hidden state applied from JS after mount and gated on
  `:root[data-hydrated]`.
- **Hydration.** No `localStorage`, `matchMedia`, `Date.now()` or `window` read
  during render to decide anything the server also rendered. `ThemeToggle` starts
  `dark=false` unconditionally; `NotFoundPage` uses `useSyncExternalStore` for a
  distinct server snapshot. Anything you add that reads client state follows the
  same pattern or React discards the whole prerendered tree on mismatch.
- **`.jsx` stays `.jsx`.** Do not convert components to `.tsx`. ESLint covers only
  `.js`/`.jsx` because TypeScript 7 blocks `typescript-eslint`, so converting moves
  a component into the unlinted half. Decision logic goes in a `.ts` file, the way
  `lib/typeahead.ts` already does.
- **Relative imports carry explicit file extensions.** Node's ESM resolver needs
  them. `scripts/add-import-extensions.py` reproduces this and is dry-run by
  default.
- **Tokens only.** No raw `ms` values and no `cubic-bezier()` literals in component
  CSS. The full set:

  ```
  --ease          cubic-bezier(0.32, 0.72, 0.29, 1)   general purpose
  --ease-out      cubic-bezier(0.23, 1, 0.32, 1)      entrances and exits
  --ease-drawer   cubic-bezier(0.32, 0.72, 0, 1)      the drawer only
  --dur           220ms      --dur-press  120ms       --dur-fast   140ms
  --dur-enter     200ms      --dur-exit   140ms       (exit is always shorter)
  ```

  These already match the curve values `/animate` and `/emil-design-eng` specify.
  Do not add a parallel scale. Adding `--ease-out-strong` next to `--ease-out` is
  a defect, not a refinement.
- **The global reduced-motion override strips `transform` from every transition
  list and clamps animation duration to ~0.** Two consequences: every keyframe's
  end state must be the visible state, and pseudo-elements the `*` selector cannot
  reach (`::details-content`, `::view-transition-*`, `::after` on a
  `translate`-animated indicator) need their own explicit opt-out, as
  `base.css:216` and `:222` already do.
- **CLS stays at 0.** `transform`, `opacity` and colour channels only. Nothing that
  shifts layout after load. An unstable page reads as an untrustworthy page, which
  on this site is the whole product.
- **Do not run** `npm run db:migrate`, `db:seed`, `sync`, `sync:parliament` or
  `db:migrate:postgres`. They write `.data/javora.db`.
  `.data/backups/javora-2026-08-29T21-01-04-180Z.db` is a protected recovery
  artefact. Never delete it.

---

## 4. The homepage rebuild

### 4.1 What is wrong now, and what the last change cost

The current hero is a 1750x899 photograph sized to fill roughly a full screen,
carrying one search field and nothing else. The most recent diff deleted the brand
pill, the visible `h1`, the sub-line and the `home.searchingRecords` count, and
moved the `h1` into `visually-hidden`. The result:

1. Nothing on screen states what the site is. A first-time visitor sees scenery and
   an input, and cannot tell whether to type a name, a district or a date.
2. The search box has no scent. `home.searchingRecords` was the only thing saying
   the box searches people, and the only proof the archive is large enough to be
   worth searching.
3. Everything that establishes credibility (featured records, the 1,623 / 6,649 /
   7-sources figures, the methodology block) sits below the fold, behind a 1.9 MB
   PNG on the LCP path.
4. The visible `h1` is gone on a site whose documented premise is crawlability.

Restoring these is not a style preference. Items 1, 2 and 4 are regressions.

### 4.2 Hero structure to build

Keep the photograph. Give it a content column and a scrim. Cap the hero so the
section below it peeks above the fold.

```
.hero
  .hero__media        <img>, unchanged mechanism
  .hero__veil         gradient scrim, see 4.3
  .container.hero__inner   max-width 640px, left-aligned
    .hero__label      eyebrow + lion logo        (restore from git)
    h1#hero-heading   VISIBLE, home.heroTitle    (un-hide)
    .hero__sub        home.heroSub               (restore)
    .hero__search     SearchTypeahead
    .hero__offices    the rail, section 4.4      (new)
    .hero__hint       home.searchingRecords + link to /directory  (restore)
```

Hard rules for this block, taken from `/pg-frontend-professionalui-reduce-ai-looks`
section 4.7, which does apply here:

- Headline at most 2 lines on desktop. The current `home.heroTitle` is 8 words and
  fits.
- Sub-line at most 20 words and at most 4 lines. `home.heroSub` is 19 words and
  passes as written, so restore it verbatim rather than rewriting it. If it runs
  past 4 lines at any width, that is a font-size error, not a copy-length error.
  Note that it contains an em-dash, which section 8's open decision covers.
- Exactly one small text element besides headline, sub and search. You have an
  eyebrow and a hint line, which is one too many. Pick one. The record count is
  worth more than the brand pill, so if you drop one, drop the pill.
- Replace `aspect-ratio: 1750 / 899` with `min-height: clamp(520px, 68vh, 720px)`
  and `max-height: 720px`. Never `100vh` and never `h-screen`; use `dvh` units if
  you need viewport-relative height at all, so the mobile address bar does not
  jump the layout.
- Hero top padding caps at 6rem (`--space-24`) on desktop. More than that and the
  content floats halfway down and reads as a layout bug.

### 4.3 The scrim, and why the current veil is not enough

`--hero-veil` and `--hero-focus` are both `none` in the light theme, so today the
text is carried entirely by `--hero-text-shadow`. That works only where the crop
happens to be light. The photo runs from bright sky to dark rock, and the crop
changes with viewport width, so contrast is currently being carried by luck.

Add a real directional scrim on `.hero__veil` as a token, not a hardcoded gradient:

- Light theme: a left-to-right linear gradient from the surface colour at roughly
  82% opacity to transparent by about 58% of the width, so the left column sits on
  a readable ground and the right two-fifths of the photo stays clean.
- Dark theme: the same shape from the dark background colour.
- Verify at 1440px, 1024px and 390px. The measurement that matters is the text's
  contrast at its **lowest-contrast point**, not its average.
- Body-size text in the hero needs 4.5:1. The `h1` at 32px qualifies as large text
  and needs 3:1, but this palette can do better, so target 4.5:1 there too.

Keep `--hero-text-shadow` as defence in depth. Do not remove it.

### 4.4 The offices rail, replacing the scattered circles

The sketch behind this had five overlapping circles of different sizes labelled
p1 to p5, floating on the photo directly under the search bar. Three separate
problems, all fixable:

1. **They collide with the typeahead.** The suggestion panel hangs below the search
   field, `z-index: 20`, and `layout.css:489` carries an explicit comment about not
   clipping it. Anything placed directly under the field gets covered on every
   keystroke. The rail therefore sits **below** the panel's maximum extent, or the
   panel gets an explicit gap, and you verify with the panel open at 1440px, 1024px
   and 390px.
2. **Different sizes encode nothing.** Office precedence is ordinal, not
   continuous, so a diameter cannot represent it. One size, one row.
3. **"Featured politicians" is an editorial act on a politics record site.** Select
   the *offices*, not the people. President, Prime Minister, Speaker, Leader of the
   Opposition, Minister of Finance, resolved live from `currentGovernment()`. The
   rule is public, neutral and self-updating. Label the rail with the
   **`home.officesRailLabel`** key reading "Offices", never "Popular", "Featured" or
   "Trending".

Build it as:

- A single horizontal row of equal 56px avatars on desktop, 48px below 640px, with
  the person's name on one line beneath each, truncated with `text-overflow` at a
  fixed width so the row never reflows.
- Each item is an `<a href={personHref(view)}>`, wrapping avatar and name. Not a
  click handler. This is the crawlability gate.
- Overflow on narrow viewports uses `scroll-snap-type: x proximity` with
  `scroll-snap-align: start` on the items and `-webkit-overflow-scrolling` left
  alone. No carousel, no library, no arrows.
- Press feedback matches the existing card tier: `transform: scale(0.98)` at
  `--dur-press` `--ease-out`. Hover lift goes behind
  `@media (hover: hover) and (pointer: fine)` and must also fire on
  `:focus-visible`.
- The rail sits on a solid `--surface` panel, or inside the scrimmed column. Never
  as loose chips on open photography.
- **No decorative status dots** before the names, no `01 / 05` counters, no pills
  overlaid on the avatars.

If `currentGovernment()` returns fewer than three resolvable holders in
demonstration mode, render nothing rather than padding the row. An empty rail is
honest; a half-filled one looks broken.

### 4.5 The question band, directly below the hero

This is the piece the site is actually missing. Most visitors arrive with a
question, not a name, and an empty search box is a wall for them.

Six tiles, each a real prebuilt directory query and each a real `<a href>`:

- Who is in cabinet now?
- Who represents Kandy?
- Who has held Finance since 1948?
- Who left office this term?
- Which records cite Parliament directly?
- Who has served longest?

Before building, **verify each one against `queryPeople()` and `facetOptions()`**.
Ship only the tiles the directory can genuinely answer today and report the ones
you dropped. A tile that lands on an empty result set is worse than no tile.

Layout constraints:

- CSS Grid, `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`, one
  column below 768px. Not flexbox percentage maths.
- Exactly as many cells as you have tiles. No blank tile to square off the grid.
- This must not be the third consecutive left-image/right-text split on the page,
  and it must not repeat a layout family used elsewhere on the homepage. Counting
  hero, question band, featured cards, stats and methodology, the homepage has five
  sections and needs at least three distinct layout families.
- Each tile is a question and a one-line answer shape ("12 records"), nothing more.
  No eyebrow, no icon row, no micro-meta sentence underneath.

### 4.6 Eyebrow budget for the whole page

`/pg-frontend-professionalui-reduce-ai-looks` section 4.7 caps eyebrows at
`ceil(sectionCount / 3)`. The homepage has five sections, so **at most two
eyebrows total**, and the hero's counts as one. `SectionHead` currently renders a
title and description per section, and `.eyebrow` appears on the methodology block.
Count the instances of `uppercase tracking` micro-labels above section headings
across the finished page. If the count exceeds two, delete the excess. The
headline alone is enough; a section's position on the page already categorises it.

### 4.7 LCP

`public/wallpaper1.png` is 1.9 MB on the LCP path and `CLAUDE.md` already flags it
as a known trade-off. The shorter hero reduces the required source size, so take
the win: emit AVIF and WebP alongside the PNG via a `<picture>` element, keep the
PNG as the final fallback, and keep `fetchPriority="high"`. Do not add an image
pipeline dependency; a one-off `scripts/` conversion is fine. Target LCP under
2.5s on a throttled 4G profile and report the before and after numbers.

---

## 5. Search behaviour

`SearchTypeahead` is already a correct ARIA combobox: `role="combobox"` on the
input, `role="listbox"` on the panel, `aria-activedescendant` tracking, 150ms
debounce on the query only, Escape closes without losing text, decisions factored
into `lib/typeahead.ts` as pure functions. Do not restructure it. Add the following.

### 5.1 Empty-state panel on focus

Today `showPanel = open && text.trim().length > 0`, so focusing an empty field
shows nothing at all. This is the single highest-value change in the whole prompt.

Open the panel on focus with three labelled groups:

- **Recent**: the last three profiles opened. Client-only. Renders as an absent
  group on the server and fills after mount, via the same `useSyncExternalStore`
  pattern `NotFoundPage` uses. A `localStorage` read during render fails hydration
  and discards the prerendered tree.
- **Offices**: the same institutional entries as the hero rail, so the two agree.
- **Try searching**: three example chips that teach the index, one name, one party,
  one district. `suggestPeople` already indexes party, district, office and
  profession and nobody guesses that from a placeholder.

Groups use the existing `.typeahead__panel` shell and its `@starting-style`
entrance. Add a group header row style; do not add a second panel component.

`aria-activedescendant` must keep working across groups: the flat option index
still runs continuously through every group, and `moveActiveIndex` in
`lib/typeahead.ts` continues to operate on that flat list.

### 5.2 Grouped results while typing

`suggestionRank` in `repository.ts:754` already returns 0 for a direct name hit, 1
for an alias, 2 for an office and 3 for anything else. Surface that structure
instead of one flat list:

- **People**: ranks 0 to 2, as today.
- **Jump to**: district and office matches as chips linking to filtered
  `/directory` URLs. Real hrefs, so they are crawlable.
- **Or**: a single "See all N matches" row.

No animation on the group swap. This re-renders on every keystroke, which is the
100+/day tier where `/animate` and `/find-animation-opportunities` both say no
animation, ever. The panel's own open and close transition already brackets the
interaction. `docs/motion-audit.md` already rejected animating this for exactly
this reason; do not re-litigate it.

### 5.3 Enter behaviour: gate the jump on confidence

Currently the top result is auto-highlighted the moment a result set arrives, so a
plain Enter teleports the user into a profile. That is right for "ranil" and wrong
for "kandy", where someone typed a place and lands on one person's biography with
no explanation.

Change the rule to: **auto-jump only when the top result's `suggestionRank` is 0
and the second result's rank is strictly worse.** Otherwise Enter goes to
`/directory?q=…` with the full set. Arrow key or click still jumps to any row,
always, because the user pointing at a row is itself the confidence signal.

This needs `suggestPeople` to return the rank alongside each view. That is the one
sanctioned `repository.ts` change in this prompt. Keep it additive: a second
exported function, or an options flag, so no existing caller changes shape. The
decision itself belongs in `lib/typeahead.ts` as a pure function with its own unit
tests, matching how `resolveKeyAction` is already structured.

### 5.4 No results

Today the empty state says "press Enter". Give it three exits:

- **Did you mean**: transliteration is a real problem here. Wickremesinghe,
  Wickramasinghe and Wickremasinghe are one person to a reader and three different
  strings to `startsWith`. Handle it with a spelling-variant pass on the no-results
  path only. **Do not loosen the fuzzy thresholds.** `CLAUDE.md` documents that on
  this dataset the President's two spellings are edit distance 8 apart while two
  different members are distance 3, so any threshold that merges him merges them
  first.
- **Browse instead**: a link to `/directory` with the query dropped.
- **Record missing?**: a link into the corrections form. A failed search is the
  best moment in the whole site to ask for a correction, and `POST /api/corrections`
  plus its threat model already exist.

### 5.5 Mobile and keyboard

- Below 640px, promote the field to a full-screen sheet on tap using a native
  `<dialog>`: input pinned under the nav, results filling the rest, one Cancel.
  A dropdown under a hero photo on a 390px screen shows about four rows before the
  fold and the on-screen keyboard eats two of them. `<dialog>` gives you the focus
  trap and Escape handling without a dependency.
- `/` focuses the nav search from any page. Guard it so it does not fire inside an
  input, a textarea or a `contenteditable`. **No animation on this**: it is a
  keyboard-initiated action, which `/animate` treats as a disqualifier rather than
  a judgement call.

---

## 6. Typography pass on the five fenced-off pages

**First, a real finding to fix.** `docs/typography-audit-2026-09-04.md` is cited
five times, by `tokens.css:471`, `base.css:264`, `base.css:343`,
`docs/portfolio-profile-anti-slop-prompt.md:91` and
`docs/portfolio-profile-typography-prompt.md:42`, and **the file does not exist**.
`CLAUDE.md`'s "Known-stale documentation" section currently claims nothing
known-stale remains, which is no longer true. Either reconstruct the audit from
the numbered rationale already written into the token comments, or change the five
citations to point at those comments. Do not leave the dangling references. Report
which you did.

That audit already rebuilt the scale. Body is 16px,
line heights are unitless tokens, `--measure` is 66ch, tracking tokens exist,
`--text-micro` is a 12px floor. Do not redesign any of that. Apply it to the pages
that never received it.

For `DirectoryPage`, `GovernmentPage`, `CorrectionsPage`, `NotFoundPage` and
`PersonPage`, in `/pg-font-psychology-readability-relaxing`'s fixing order:

1. **Contrast.** Measure every text colour against its actual background, plus
   every hover, focus and active state independently. AA 4.5:1 is the floor for
   body, 3:1 for large text and for every non-text boundary: input borders, focus
   rings, icon strokes. Target AAA 7:1 on body copy where the palette allows. Do
   not round up; `#777` on white is 4.47:1 and fails. Report the measurements.
2. **Measure.** Any prose not capped at `--measure` (66ch) gets capped. Check the
   *column* width in multi-column layouts, not the viewport.
3. **Line height.** Nothing below 1.4 for paragraphs.
4. **Size.** Nothing below 16px for primary reading copy, nothing below
   `--text-micro` anywhere.
5. **Hierarchy.** Two or three visibly distinct heading levels per page. Semantic
   `h1` to `h6` in order, exactly one `h1` per page. Space above a heading exceeds
   space below it; proximity is what tells a reader which text a heading owns.
6. **Font count.** Three families is already the ceiling and this project is at it
   (Plex Sans, Plex Mono, Source Serif 4). Do not add a fourth. Do not introduce a
   display serif; `/pg-frontend-professionalui-reduce-ai-looks` specifically bans
   Fraunces and Instrument Serif as defaults and this project needs neither.
7. **WCAG 1.4.12.** Override line-height to 1.5x, letter-spacing to 0.12x and
   word-spacing to 0.16x of font size in DevTools on each page. The layout must
   reflow, not overflow. Fix anything that clips.
8. **Tabular numerals.** `font-variant-numeric: tabular-nums` on every column of
   digits: the stats cards, position date ranges, the directory result counts.
   Fifteen usages already exist; find the ones that were missed.
9. **Polish.** `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs.
   Tracking stays size-specific per `/apple-design`: `--track-display` on large
   headings, `--track-body` at zero for body, `--track-label` on uppercase labels.
   A single fixed `letter-spacing` is wrong somewhere by definition.

Two additions the audit did not cover:

- **Dark mode weight.** Light-on-dark strokes bloom optically. Reduce body weight
  slightly in dark mode. IBM Plex Sans is not variable in this install, so use the
  400/450 pairing rather than a `GRAD` axis, and verify it does not cause reflow.
- **Sinhala and Tamil.** Both need more line height than Latin and a font with real
  coverage. Check every page at `si` and `ta` with the longest realistic string.
  The `--font-sans` stack currently falls through to system fonts for those scripts.
  If clipping or cramped leading shows up, report it; do not add a webfont without
  discussing the LCP cost first.

---

## 7. Motion pass on the same five pages

Run `/find-animation-opportunities` properly: sweep, gate all four questions, cap
the output at five to seven suggestions for the whole app, and **report the
rejected candidates**. On a records site most candidates should die at the gate.

Sweep these seams specifically:

- Pressable elements with no `:active` state. This is the one category that is
  almost always a genuine defect rather than an opportunity. `git grep` for
  `onClick` and for `.btn`-adjacent classes in the five pages and check each one
  has press feedback at the right tier.
- Content that swaps or appears instantly: the directory's filter application, the
  government page's tab content, the corrections form's success state.
- Surfaces that appear with no connection to their trigger.
- Anything that exits by a different path than it entered.

Gate every candidate against:

| Frequency | Verdict |
| --- | --- |
| 100+/day, keyboard-initiated | Reject outright. No animation, ever. |
| Tens/day | Reject, or near-imperceptible only |
| Occasional | Eligible, standard animation |
| Rare or first-time | Eligible, this is where the delight budget lives |

Then name the purpose in one of these words or drop it: feedback, spatial
consistency, state indication, preventing a jarring change, explanation, delight.
"It looks cool" is not on the list.

Two things to reject before you start, so you do not spend the budget on them:

- **Scroll-reveal on the directory's 1,623 cards.** This is data the reader is
  scanning. Decoration on information-dense UI hinders. The existing 25ms
  `--reveal-index` stagger on result changes is the ceiling for that surface, and
  it is already there.
- **Any animation on the filter controls.** Same reason, plus the frequency tier.

Budgets for whatever survives: press feedback 100 to 160ms, tooltips and small
popovers 125 to 200ms, dropdowns 150 to 250ms, modals and drawers 200 to 500ms.
UI stays under 300ms. Anything longer needs a written reason.

Implement with `/animate`'s sequence and with existing tokens only.

---

## 8. Anti-slop pass: which parts of the skill apply here

`/pg-frontend-professionalui-reduce-ai-looks` is written for landing pages and
portfolios, and its own section 13 says it is not for dense product UI. Apply
this subset and consciously skip the rest.

### Apply

- **Hero discipline** (4.7): covered in section 4.2 above.
- **Eyebrow budget** (4.7): covered in section 4.6 above.
- **Colour consistency lock** (4.2): one accent for the whole site. This project
  has `--primary`, `--secondary` and `--deep-teal` as an authored family. Audit for
  any component that introduces a hue outside it.
- **Shape consistency lock** (4.4): one radius system. The project has
  `--radius-xs` through `--radius-full`, which is a documented scale rather than a
  mixed system, but verify every component draws from it rather than a literal.
- **Button and form contrast checks** (4.5, 4.6): fold into section 6.1.
- **CTA wrap ban** (4.5): no button label wraps to two lines at desktop. Check the
  `si` and `ta` locales too, where labels run longer.
- **No duplicate CTA intent** (4.5): count the distinct phrasings for "browse the
  directory" across nav, hero, methodology block and footer. There should be one.
- **Label above input, never placeholder-as-label** (4.6): audit the corrections
  form.
- **Page theme lock** (4.11): no section inverts mid-page.
- **No `border-t` plus `border-b` on every row** of a long list (9.F): check the
  directory's result rows and the government page's tables.
- **Copy self-audit** (4.9): re-read every visible string in all three locales for
  broken grammar, unclear referents and AI-flavoured cleverness. Rewrite anything
  flagged as a plain functional sentence.
- **Real names, no fake-precise numbers** (9.D): the dataset is real, so the only
  risk is invented figures in new copy. Every number you write comes from
  `datasetStats()`.
- **Scroll cues, locale strips, version labels, decorative status dots, section
  numbering eyebrows, `01 / 4` counters, pills overlaid on images** (9.F): none of
  these exist today. Do not introduce any of them.

### Skip, and why

- **Icon library rules** (3.C). The project uses a hand-built `lib/icons.jsx`.
  Installing Phosphor is a dependency and the no-dependencies rule wins.
- **Image strategy** (4.8), which requires real photography in every section. This
  is a public record, not a marketing page. Portraits come from sources with
  provenance or they do not appear. Never generate a politician's image, never
  substitute a stock photo for a missing portrait. The `Avatar` initials fallback
  is correct and stays.
- **Bento grids, marquees, sticky-stacks, horizontal scroll hijacks, magnetic
  hover, glassmorphism panels, GSAP skeletons** (5, 5.A, 5.B, 10). All of them are
  dependencies, motion-intensity theatre, or both.
- **Tailwind, Next.js, RSC, `next/font`, shadcn** (3.A, 2.A). None of this stack is
  here and none of it is coming.
- **The dial system** (1). This is a public record, which maps to that skill's own
  "trust-first / public-sector / regulated" row: variance 3 to 4, motion 2 to 3,
  density 4 to 5. State those values in the report and then note that the project's
  existing restraint already satisfies them, so the dials change nothing.

### One decision to bring back rather than execute

The skill bans the em-dash character outright, everywhere visible: headlines,
labels, buttons, body copy, alt text. That rule exists because the em-dash is an
LLM stylistic tell on generated marketing pages. This repo's `en.js`, `si.js` and
`ta.js` currently use them throughout, and so do the docs. Applying the ban means
a copy edit across three locales.

**Do not do that unilaterally.** Put it in the report as a yes/no decision with a
count of affected strings per locale, and wait.

---

## 9. Theme, materials and the two accessibility signals nobody added

### 9.1 What is missing

`prefers-reduced-motion` is handled thoroughly. The other two signals
`/apple-design` names are absent from the codebase entirely: zero occurrences of
`prefers-reduced-transparency` and zero of `prefers-contrast`.

- **`prefers-reduced-transparency: reduce`**: there are four `backdrop-filter`
  usages. Each needs a solid fallback that raises background opacity and drops the
  blur. Browser support for the query is uneven, so the design must also hold
  without blur. Test it.
- **`prefers-contrast: more`**: near-solid backgrounds with a defined contrasting
  border. The existing `--control-border` at 3.34:1 is the right starting point;
  under this query it should step up.

### 9.2 Chrome as a material

The nav is currently a solid bar. `/apple-design` section 12 argues for a
translucent layer with content scrolling underneath, and for a scroll edge effect
(a small blur or gradient mask where content meets floating chrome) instead of a
1px divider.

This is a genuine improvement and it is also a taste call on a records site. Build
it behind the two queries above, keep the nav height at its current 64px
(`--nav-height`), and if the result reads as decoration rather than structure,
revert it and say so in the report. Never stack a light translucent surface on
another; legibility collapses.

### 9.3 Theme flip

Do not add `background-color` or `color` transitions that double up with the
existing `.theme-switching` sitewide flip. `/apple-design` section 14 also asks
that a dark/light change be eased rather than abrupt, which `.theme-switching`
already does.

---

## 10. Never ship

Self-check before you report. Each of these is an automatic block in
`/review-animations`:

| Never | Instead |
| --- | --- |
| `transition: all` | Name the exact properties |
| `transform: scale(0)` entrance | `scale(0.95)` to `scale(0.98)` plus `opacity: 0` |
| `ease-in` on a UI element | `--ease-out` |
| A raw `cubic-bezier()` or `ms` literal in component CSS | The token |
| Animation on a keyboard shortcut or a 100+/day action | No animation |
| UI duration over 300ms with no stated reason | 150 to 250ms |
| `transform-origin: center` on a trigger-anchored panel | The trigger's edge. Modals are exempt and stay centred |
| Keyframes on anything triggered rapidly | CSS transitions, which retarget from the current value |
| Animating `width`, `height`, `margin`, `padding`, `top`, `left` | `transform` and `opacity` |
| Ungated `:hover` motion | `@media (hover: hover) and (pointer: fine)` |
| A hover effect with no `:focus-visible` equivalent | Both, always |
| An animated focus ring | Never animate focus rings |
| Driving a child's transform from a CSS variable on the parent | Set `transform` on the element directly |
| Everything entering at once | 30 to 80ms stagger, or nothing |
| A new dependency | Plain CSS, WAAPI, or a report entry arguing the case |
| A `<div>` with a click handler where a link belongs | `<a href>` |
| `h-screen` or `100vh` on the hero | `clamp()` with `dvh` |

---

## 11. Verify

Run all of these. The crawlability gate is not optional.

```bash
npm run typecheck
npm run lint
npm test                                    # 784 tests, 46 files
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist                          # in one terminal
npm run validate:crawlability               # in another. must stay 1623/1623
```

Notes that will save you an hour:

- **Only `serve:dist` tells the truth about production.** It resolves directory
  indexes, returns real 404s and applies the generated CSP. `npm run preview` is
  the trap: it answers deep routes with the SPA shell, so a broken build looks
  fine. `npm run dev` prerenders nothing and injects CSS through JS, so its first
  paint differs by construction. Edit against `dev`, judge against `serve:dist`.
- `serve:dist` warns at startup when `dist/` is older than the source. Heed it, or
  the hard gate passes on code you are no longer running.
- Node 24 or newer is required, not preferred.

Then check by hand:

- Both themes, and the un-stamped system-preference state, which is a third case
  and not the same as either stamp.
- All three locales on every page you touched.
- 1440px, 1024px, 768px, 390px.
- Reduced motion on. Then reduced transparency on. Then increased contrast on.
- Keyboard only: tab through the hero, the rail, the question tiles, the typeahead
  and the mobile search sheet. Every interactive element reachable, every focus
  state visible, focus never trapped except inside the `<dialog>`, where it must be.
- Play the hero and panel transitions at 3x duration in the DevTools animation
  inspector and step them frame by frame. Look for two states overlapping in a
  crossfade, an origin scaling from the wrong point, and properties drifting out of
  sync. Then look again the next day with fresh eyes before calling it done.

---

## 12. Report format

Two parts, in this order, and nothing else.

### Part 1: findings table

One markdown table, one row per change. Never a Before:/After: list.

| Before | After | Why |
| --- | --- | --- |

### Part 2: verdict

Grouped by impact tier, highest first, omitting empty tiers:

1. Feel-breaking regressions
2. Missed simplifications, things that should be deleted rather than fixed
3. Performance
4. Interruptibility and timing
5. Origin, physicality and cohesion
6. Accessibility

Then close with:

- **Held for approval**: anything that changes the feel of something that already
  animates deliberately, the em-dash decision from section 8, any tile from section
  4.5 you dropped, and any case where a skill's rule conflicts with `CLAUDE.md`.
- **New tokens added**, if any, with the reason no existing one fit.
- **New i18n keys**, with which locales still need real translations.
- **Numbers**: crawlability count before and after, test count, LCP before and
  after, and the contrast measurements from section 6.1.
- **Feel-checks you could not settle from code**, named explicitly rather than
  guessed at.

State plainly where you disagreed with a skill and followed `CLAUDE.md` instead.
A short list of high-confidence changes beats a long padded one, and "this surface
is already right" is a valid result.
