# Home page responsive audit — fix prompt

Paste this whole file into Claude Code at the repo root (`javora-react`).

---

## Task

Fix the responsive defects on the home page (`src/pages/HomePage.jsx`, styled in
`src/styles/layout.css` + `src/styles/components.css`). Each item below names the
exact file, rule and reason. Do not refactor beyond these rules. The project's
`CLAUDE.md` invariants still hold — in particular do not touch `.hero`'s
`isolation: isolate` / `z-index: 1`, and do not add `overflow: hidden` to `.hero`
(the typeahead panel hangs outside its box by design).

Verify with `npm run build && npm run serve:dist`, then `npm run validate:crawlability`.
Judge nothing by `npm run dev` — it does not prerender.

Test widths: **320, 360, 390, 480, 520, 640, 768, 860, 1024, 1280, 1440**.
Also test: landscape phone (`740×360`), 200% browser zoom, and a forced long-string
locale (Sinhala/Tamil copy is ~30–50% longer than English).

---

## P0 — content escapes the hero box and paints over the next section

**File:** `src/styles/layout.css`, `.hero`

```css
min-height: clamp(520px, 68dvh, 720px);
max-height: 720px;
display: flex;
```

`max-height` is a hard cap on a container whose height is content-driven. As soon
as the stack (h1 + sub + search + offices rail + hint) exceeds 720px — landscape
phones, 200% zoom, larger default font size, or longer translated strings — the
content overflows the hero's box. Because `.hero` is `isolation: isolate` with
`z-index: 1`, the overflowing content **paints on top of the question band below
it**. That is the overlap in the screenshots; it is not a z-index bug, it is this
`max-height`.

**Fix:** remove `max-height` entirely. Keep the intent (don't let a tall desktop
viewport become a full-screen wall) with the existing `min-height` clamp only:

```css
min-height: clamp(520px, 68dvh, 720px);
/* no max-height: the hero must be allowed to grow to fit its own content */
```

Add a regression test asserting the hero's `scrollHeight <= offsetHeight` at
`360×640`, `740×360` and 200% zoom.

---

## P0 — hero text block is centred on wide screens, misaligned with every section below

**File:** `src/styles/layout.css`, `.hero__inner`

```css
.hero__inner { max-width: 640px; width: 100%; }
```

`.hero__inner` also carries `.container`, which sets `max-width: var(--container)`
(1200px) **and `margin-inline: auto`**. The 640px override wins on `max-width`, so
above ~1250px the hero copy is centred in the viewport while every section below
starts at the container's left gutter. The heading and the "Who is in Cabinet"
tiles no longer share a left edge.

**Fix:** keep the container's gutter and cap the *measure*, not the block:

```css
.hero__inner { max-width: var(--container); margin-inline: auto; }
.hero__inner > * { max-width: 640px; }
```

(or wrap the copy in an inner `<div class="hero__copy">` with `max-width: 640px`
and leave `.hero__inner` as a plain `.container`.)

---

## P1 — horizontal overflow at ≤360px

**File:** `src/styles/base.css` (`h1`) and `src/styles/layout.css` (`.hero h1`)

`h1` is `clamp(2rem, 1.35rem + 2.6vw, 3.05rem)` — 32px floor. At 320px the
container leaves ~280px of content width, and a long unbroken token in the serif
face plus `text-wrap: balance` can push past it. There is no break guard.

**Fix** on `.hero h1` and `.hero__sub`:

```css
overflow-wrap: break-word;
hyphens: auto;
```

Also add a hard page-level guard so this class of bug fails loudly instead of
shipping. Add a test that, at each of the widths listed above, asserts
`document.documentElement.scrollWidth <= innerWidth` on `/`.

---

## P1 — offices rail: native scrollbar, clipped avatars, no edge bleed

**File:** `src/styles/layout.css`, `.hero__offices-list`

```css
overflow-x: auto;
scroll-snap-type: x proximity;
```

Three defects:

1. A permanent native scrollbar renders under the row on desktop and on any
   always-visible-scrollbar OS setting (visible in the screenshots).
2. The scroller starts and ends at the container's *padding* edge, so the last
   avatar is sliced mid-portrait inside the gutter — it reads as a clipping bug,
   not as "scroll for more".
3. `scroll-snap-type` with no `scroll-padding-inline`, so a snapped or
   keyboard-focused item lands flush against the clipped edge.

**Fix:**

```css
.hero__offices-list {
  display: flex;
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scroll-padding-inline: var(--space-1);
  scrollbar-width: none;                    /* Firefox */
  /* bleed to the viewport edge so cut-off cards read as "more this way" */
  margin-inline: calc(var(--space-6) * -1);
  padding-inline: var(--space-6);
  /* soft right edge instead of a hard slice */
  mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 32px), transparent 100%);
}
.hero__offices-list::-webkit-scrollbar { display: none; }

@media (max-width: 640px) {
  .hero__offices-list { margin-inline: calc(var(--space-5) * -1); padding-inline: var(--space-5); }
}

.hero__office-item { flex: 0 0 auto; scroll-snap-align: start; scroll-margin-inline: var(--space-6); }
```

Keep the mask off when `prefers-reduced-transparency` — or simply skip the mask
and use the bleed + hidden scrollbar alone if the mask fights the hero photo.

---

## P1 — hero veil only covers the left ~68% of the image

**File:** `src/styles/tokens.css`, `--hero-veil` / `--d-hero-veil`

```css
linear-gradient(90deg, … 0%, … 45%, rgba(…, 0) 68%)
```

That horizontal ramp was tuned for a 640px copy block on a wide hero. On phones
the copy spans the **full** width, so the right half of the heading and subhead
sit over unveiled, bright sky. `--hero-text-shadow` is carrying contrast alone
there, which is not enough for AA on the pale band.

**Fix:** make the veil vertical (or full-bleed) below the breakpoint where the
copy stops being a left column:

```css
@media (max-width: 860px) {
  .hero__veil {
    background-image:
      var(--hero-focus),
      linear-gradient(180deg,
        color-mix(in srgb, var(--background) 72%, transparent) 0%,
        color-mix(in srgb, var(--background) 58%, transparent) 55%,
        color-mix(in srgb, var(--background) 30%, transparent) 100%);
  }
}
```

Then measure contrast on the heading, `.hero__sub` and `.hero__hint` against the
lightest pixel of the image behind each, at 360px. Target ≥ 4.5:1 for body,
≥ 3:1 for the heading.

---

## P2 — landscape phones get a 520px hero on a 360px-tall viewport

**File:** `src/styles/layout.css`

The `@media (max-width: 640px)` block drops the height clamp, but a landscape
phone is ~740px wide and never matches it, so `min-height: 520px` applies to a
360px-tall viewport: the user scrolls a screen and a half of photograph before
reaching the search field.

**Fix:** add a height-based escape hatch alongside the width one:

```css
@media (max-height: 520px) and (orientation: landscape) {
  .hero { min-height: unset; padding-block: var(--space-8) var(--space-10); }
  .hero__office .avatar { width: 44px; height: 44px; }
}
```

---

## P2 — office names always truncate to an ellipsis

**File:** `src/styles/layout.css`, `.hero__office` / `.hero__office-name`

`width: 88px` + `white-space: nowrap` + `text-overflow: ellipsis` means every Sri
Lankan name renders as "Anura Kumar…", "Harini Amara…" at **every** breakpoint,
including 1440px where there is plenty of room. The rail is a wayfinding element;
a row of identical ellipses is not wayfinding.

**Fix:** allow two lines and drop the nowrap; keep a consistent item height.

```css
.hero__office { width: 96px; }
.hero__office-name {
  max-width: 100%;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.25;
  min-height: 2.5em;            /* reserve both lines so the row never jitters */
}
```

Add `title={member.name}` on the anchor in `HomePage.jsx` so the full name is
still reachable when it does clamp.

---

## P2 — `scroll-padding-top` assumes a constant nav height

**File:** `src/styles/base.css`

```css
scroll-padding-top: calc(var(--nav-height) + var(--space-6));
```

`--nav-height` is a fixed `64px` token. If the nav ever wraps (long locale, large
text setting) the `#methodology` anchor jump lands under the bar.

**Fix:** measure once and expose it, or use a safer floor:

```css
scroll-padding-top: calc(var(--nav-height) + var(--space-6) + env(safe-area-inset-top, 0px));
```

and verify the `/#methodology` jump at 320px with 200% text zoom.

---

## P3 — press feedback is below the perceptual floor

**File:** `src/styles/components.css`

`.question-tile:active { transform: scale(0.995); }` — 0.5% is not perceivable.
Emil's floor for press feedback is 0.95–0.98.

| Before | After | Why |
| --- | --- | --- |
| `.question-tile:active { transform: scale(0.995) }` | `transform: scale(0.98)` | 0.5% is invisible; the tile reads as unresponsive to touch |
| `.hero__office:active { transform: scale(0.98) }` | keep | Already correct |

---

## Acceptance criteria

1. No horizontal scrollbar on `/` at any of the listed widths — asserted by a test,
   not by eye.
2. Hero content never paints outside `.hero`'s border-box (no overlap with the
   question band) at `360×640`, `740×360`, and 200% zoom.
3. Hero copy shares a left edge with the sections below it at 1280px and 1440px.
4. The offices rail shows no native scrollbar, bleeds to the viewport edge, and a
   keyboard-focused item is never clipped.
5. Heading, subhead and hint meet WCAG AA contrast over the photo at 360px in both
   themes.
6. `npm test`, `npm run typecheck`, `npm run lint` pass; `npm run validate:crawlability`
   still reports 1623/1623.
