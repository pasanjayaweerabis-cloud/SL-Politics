# SL Politics — Homepage Hero Build Prompt (pixel-exact spec)

> **How to use this file:** paste the whole thing to Claude in the `javora-react` repo,
> and attach the reference screenshot alongside it. The instruction is:
> **"Build the homepage hero exactly as specified below. Do not improvise, do not
> substitute, do not 'improve'. Match the reference 1:1. I will tell you what to
> change afterwards."**

---

## 0. Non-negotiable rules (project constraints)

These come from `CLAUDE.md` and override any styling convenience:

1. **Add no dependencies.** No Tailwind, no router, no CSS framework, no icon
   package, no animation library. Plain CSS (CSS Modules / the existing styling
   approach already in the repo) and hand-written inline SVG icons only.
2. **Components are `.jsx`.** Logic/types are `.ts`/`.tsx`. Do **not** convert
   `.jsx` → `.tsx`.
3. **Relative imports carry explicit file extensions** (`./Hero.jsx`, not `./Hero`).
4. **No data imports in components.** Anything dynamic (the 4 key figures, the
   `1,623` count) comes through `src/services/repository.ts` — the only data
   boundary — and is passed in as props.
5. **Prerender-safe.** The hero must render its full content in static HTML:
   - no `{mounted && ...}` gating, no client-only rendering of text or links,
   - every figure card must be a real `<a href>` present in the prerendered HTML,
   - `npm run validate:crawlability` must still pass 1623/1623.
6. **No hydration-divergent state.** Do not read `localStorage`, `window` or
   `matchMedia` during render. The theme toggle keeps its existing behaviour
   (starts `dark=false` unconditionally).
7. **CSP:** do not add a new inline `<script>` to `index.html`. If you must touch
   the existing inline theme script, its sha256 is baked into the CSP and has to
   be regenerated.
8. **Copy is factual.** Counts shown must come from the repository, not be
   hard-coded. If a figure isn't available, render the existing
   `Unavailable` / `Unrecorded` component — never invent a number.

---

## 1. What we are building

A single full-viewport hero section for the homepage (`/`), plus the floating
site header that sits on top of it. Everything below the hero is out of scope
for this task.

Overall impression: a dark, editorial, photo-led hero. A full-bleed sunrise
photograph of Sigiriya with a seated Buddha statue on the right, a soft dark
gradient over it, and a stack of glass-morphism panels floating on top in a
deep-green / mint palette. Serif display type for the headline, clean sans for
everything else.

---

## 2. Design tokens

Define these as CSS custom properties in one place and use them everywhere —
no raw hex values scattered through components.

### Colour

| Token | Value | Use |
|---|---|---|
| `--green-900` | `#0A3B2C` | Primary brand green — logo disc, Search button fill |
| `--green-800` | `#0E4A38` | Hover state for the Search button |
| `--mint-300` | `#A9D6BC` | Accent — the words "Sri Lanka" in the headline |
| `--white` | `#FFFFFF` | Headline, card titles, search field background |
| `--text-muted` | `rgba(255,255,255,0.72)` | Hero sub-paragraph |
| `--text-dim` | `rgba(255,255,255,0.55)` | Card roles, stat labels, footer line |
| `--glass-bg` | `rgba(10,32,26,0.55)` | Figure cards, stat strip |
| `--glass-border` | `rgba(255,255,255,0.12)` | 1px borders on all glass panels |
| `--pill-border` | `rgba(255,255,255,0.28)` | Popular-search pill outlines |
| `--header-bg` | `rgba(248,250,249,0.92)` | Floating header card (light) |
| `--header-text` | `#12211C` | Header nav + wordmark |

### Hero image overlay

Stack two layers over the photo, in this order (bottom → top):

```css
/* 1. horizontal scrim so the left-hand copy stays legible */
linear-gradient(90deg, rgba(4,18,14,0.82) 0%, rgba(4,18,14,0.55) 42%, rgba(4,18,14,0.10) 72%, rgba(4,18,14,0.00) 100%)
/* 2. vertical scrim so the bottom panels sit on a darker base */
linear-gradient(180deg, rgba(4,18,14,0.35) 0%, rgba(4,18,14,0.00) 28%, rgba(4,18,14,0.55) 100%)
```

### Typography

- **Display serif** for the H1 and the "Key public figures" heading and the big
  stat number. Use a serif already available to the project; if none exists, use
  a system serif stack (`Georgia, 'Times New Roman', serif`) rather than adding a
  webfont dependency. Weight 600–700, tight tracking (`-0.02em`).
- **UI sans** for everything else — the existing body font stack.
- Sizes (desktop, 1712px-wide reference):
  - H1: `clamp(2.6rem, 4.6vw, 4.6rem)` / line-height `1.06`
  - Eyebrow: `0.78rem`, `600`, `letter-spacing: 0.18em`, uppercase
  - Sub-paragraph: `1.1rem` / line-height `1.55`
  - Nav links: `0.95rem` / `500`
  - Card name: `1.05rem` / `600`
  - Card role: `0.9rem`
  - Stat number: `2.6rem` / `700`

### Shape & depth

- Header card: `border-radius: 18px`
- Glass cards and stat strip: `border-radius: 16px`
- Search field, search button, pills, language selector: fully rounded (`999px`)
- Glass panels: `backdrop-filter: blur(14px) saturate(120%)` with a
  `background-color` fallback for browsers without it
- Panel shadow: `0 18px 48px rgba(0,0,0,0.32)`

### Layout

- Content column: `max-width: 1520px`, centred, `padding-inline: 40px`
- Hero section: `min-height: 100svh`, content bottom-aligned with the scroll row
  pinned to the bottom edge

---

## 3. Component breakdown (exact, top to bottom)

### 3.1 Floating header

A rounded card that floats **over** the hero, inset from the top and sides
(≈16px inset, ≈76px tall), light background, dark text, sticky on scroll.

Left → right inside it:

1. **Logo lockup**
   - 40px circular disc filled `--green-900`, containing a white spiral /
     swirl mark (inline SVG — draw a simple two-turn spiral, do not use an
     image file).
   - Wordmark **"SL Politics"** — display serif, `1.35rem`, weight 700, colour
     `--header-text`.
2. **Vertical hairline divider**, 1px, `rgba(18,33,28,0.18)`, ~28px tall.
3. **Tagline**, small sans `0.82rem`, colour `rgba(18,33,28,0.62)`:
   `People · Offices · Facts · For a more informed Sri Lanka`
   (middots are real `·` characters with thin spacing).
4. **Spacer** (flex: 1).
5. **Primary nav**, horizontal, gap 28px:
   `Home` · `Current Government` · `Directory` · `Institutions` · `About`
   - `Home` is the active item: slightly darker text plus a **2px underline bar**
     directly beneath it, ~28px wide, colour `--green-900`, offset ~18px below
     the text baseline.
   - Active state must be derivable at prerender time from the current route,
     not from a client-side effect.
6. **Language selector**: rounded pill with a 1px border
   `rgba(18,33,28,0.16)`, ~44px tall, containing a globe outline icon, the word
   `English`, and a small chevron-down. Button element, `aria-haspopup="listbox"`.
7. **Search icon button** — magnifier outline, 20px, colour `--header-text`.
8. **Theme toggle** — crescent-moon outline, 20px. Keep the repo's existing
   `ThemeToggle` behaviour exactly.

All three icon controls are ≥44×44px hit targets with `aria-label`s.

### 3.2 Hero background

- `public/` background photograph, full-bleed `object-fit: cover`,
  `object-position: center`.
- It is the LCP element: `fetchpriority="high"`, `loading="eager"`,
  `decoding="async"`, explicit `width`/`height` to reserve the box.
- **Note:** `public/wallpaper1.png` is 1.9 MB and already flagged in the repo
  audit. Serve a modern format (`.avif` with `.webp` fallback via `<picture>`),
  keep the PNG as the final fallback, and do **not** silently replace the asset
  path without saying so.
- `alt=""` — decorative; the headline carries the meaning.

### 3.3 Eyebrow

A horizontal row, ~24px above the H1:

`— TRUSTED DATA. STRONGER DEMOCRACY. ———————`

- A short 1px rule (~18px) before the text, and a longer 1px rule (~70px) after,
  both `rgba(255,255,255,0.45)`, vertically centred with the caps.
- Text uppercase, letterspaced as specced above, colour `rgba(255,255,255,0.88)`.

### 3.4 Headline (H1)

Two lines, hard-wrapped exactly as shown:

```
Source-linked public records
of Sri Lanka<span class="accent">n</span> public figures.
```

Precisely: the words **"Sri Lankan"** are coloured `--mint-300`; everything else
is white. Line break after "records". Max width ~ 15ch–20ch so the wrap holds
naturally; do not force it with `<br>` if a `max-width` achieves the same wrap,
but a `<br>` is acceptable and must be `aria-hidden`-neutral.

### 3.5 Sub-paragraph

Two lines, `--text-muted`, max-width ~52ch:

```
Explore public offices, position histories, timelines and qualifications —
each presented alongside the institutional record it should be traceable to.
```

Use a real em dash. Margin-top 20px.

### 3.6 Search bar

A single white pill, ~770px wide, ~74px tall, `border-radius: 999px`,
shadow `0 10px 30px rgba(0,0,0,0.28)`. Inside:

- Magnifier outline icon, 22px, colour `rgba(18,33,28,0.45)`, 28px from the left.
- `<input type="search">`, transparent background, no border, no default
  focus ring — instead the **pill** gets a visible 2px `--mint-300` focus ring
  via `:focus-within` (never remove focus visibility).
- Placeholder: `Search people, offices, parties, or roles...` (three dots, not an
  ellipsis character).
- **Search button** flush inside the right edge with ~8px inset: fill
  `--green-900`, white text `Search`, a small right-arrow `→` icon after the
  label, `border-radius: 999px`, padding `0 28px`, full inner height.
  Hover: `--green-800`. This is a real `<form>` submit.

Margin-top 34px.

### 3.7 Popular searches row

`Popular searches:` label in `--text-dim`, then five pills, gap 12px:

`President` · `Prime Minister` · `Ministers` · `Parliament` · `Political Parties`

Pill style: transparent fill, 1px `--pill-border`, white text `0.9rem`,
height 40px, padding `0 20px`, `border-radius: 999px`.
Hover: background `rgba(255,255,255,0.10)`, border `rgba(255,255,255,0.45)`.
Each is an `<a>` to the corresponding directory/search route — real hrefs,
present in the prerendered HTML.

Margin-top 22px.

### 3.8 "Key public figures" heading

Serif, white, `1.5rem`, weight 700, followed by a small `›` chevron glyph
(a link to the full directory). Margin-top 44px, margin-bottom 16px.

### 3.9 Key-figure cards (4 across)

A 4-column grid, gap 20px, each card equal width.

Card: glass panel (`--glass-bg`, 1px `--glass-border`, blur, radius 16px),
height ~96px, padding `16px 20px`, `display: flex; align-items: center; gap: 16px`.
The **whole card is one `<a>`**.

Inside each card:

1. **Avatar** — 64px circle, `object-fit: cover`, 2px white ring
   (`box-shadow: 0 0 0 2px rgba(255,255,255,0.9)`). Keep the existing
   `Avatar` component's `onError` fallback behaviour.
2. **Text stack**
   - Name, white, weight 600, wrapping onto two lines where needed.
     In the reference, the surname is **underlined** on cards 1, 2 and 4
     (`text-decoration: underline; text-underline-offset: 3px;
     text-decoration-thickness: 1px; text-decoration-color: rgba(255,255,255,0.5)`)
     — this is the link affordance, so apply it consistently to the name,
     and let the natural wrap put the surname on line two.
   - Role beneath, `--text-dim`, `0.9rem`.
3. **Chevron `›`** pushed to the right edge, `rgba(255,255,255,0.5)`, 18px.

Hover: border → `rgba(255,255,255,0.28)`, background lightens ~6%,
`transform: translateY(-2px)`, 160ms ease. Honour `prefers-reduced-motion`.

**Content comes from the repository, not hard-coded.** The reference shows:

| Avatar | Name | Role |
|---|---|---|
| photo | Anura Kumara Dissanayake | President |
| photo | Harini Amarasuriya | Prime Minister |
| photo | Sajith Premadasa | Leader of Opposition |
| photo | Jagath Wickramaratne | Speaker of Parliament |

Select these by **office**, not by name, and resolve each person through the
repository so the merged-identity override for the President applies and the
slug is the canonical one. If an office is vacant or unresolved, render the
existing `Unavailable` treatment in that slot rather than dropping the card.

Margin-top 16px.

### 3.10 Stats strip

One full-width glass panel, radius 16px, ~92px tall,
`display: flex; align-items: center`, padding `0 32px`, margin-top 24px.

- **Left block:** a document/records outline icon (28px) then the number
  **`1,623`** in display serif `2.6rem` white, with `public records` beneath it
  in `--text-dim` `0.9rem`. The number is `repository`-derived (total people)
  and locale-formatted; it is **not** a string literal.
- Then **four items**, evenly distributed across the remaining width, each
  separated by a 1px vertical divider `rgba(255,255,255,0.14)` running ~48px tall.
  Each item is `icon + two-line text`:

| Icon | Title (white, 0.95rem, 600) | Sub (`--text-dim`, 0.85rem) |
|---|---|---|
| person outline | People | Current and historical profiles |
| classical-building outline | Offices | Roles and responsibilities |
| clock outline | Timelines | Position history over time |
| document outline | Sources | Linked institutional records |

All icons are hand-written inline SVG, 22px, `stroke: currentColor`,
`stroke-width: 1.5`, `fill: none`, colour `rgba(255,255,255,0.75)`.

### 3.11 Bottom row

Pinned to the bottom of the hero, ~40px below the stats strip:

- **Left:** a 44px circle, 1px border `rgba(255,255,255,0.35)`, containing a
  down-arrow, followed by the text `Scroll to explore` in `--text-dim`.
  It's a `<button>` (or an anchor to the next section id) that smooth-scrolls
  to the section below — guarded by `prefers-reduced-motion`.
- **Right:** a 64px 1px rule `rgba(255,255,255,0.35)` then
  `A more informed Sri Lanka` in `--text-dim`.

---

## 4. Responsive behaviour

| Breakpoint | Changes |
|---|---|
| ≥1400px | As specced above. |
| 1100–1399px | Header tagline hidden. H1 scales down via `clamp`. Figure cards stay 4-up but shrink; avatar 56px. |
| 900–1099px | Figure cards → 2×2 grid. Stats strip wraps: count on its own row, the four items 2×2 beneath, dividers become bottom borders. |
| 640–899px | Header collapses to logo + hamburger (nav in a panel; it must still exist in the prerendered HTML — hide with CSS/`hidden`, never with `{open && ...}`). Search button collapses to an icon-only circle. Popular-search row scrolls horizontally with a hidden scrollbar. |
| <640px | H1 ~2.4rem, three lines is fine. Figure cards 1-up, full width. Stats strip becomes a 2×2 grid with the count above it. Bottom row stacks; the "A more informed Sri Lanka" line may be hidden. Side padding 20px. |

At every width: no horizontal page scroll, and a minimum 16px side gutter.

---

## 5. Accessibility requirements

- One `<h1>` on the page — the hero headline.
- `<header>` → `<nav aria-label="Primary">`; active item carries `aria-current="page"`.
- The search is a `<form role="search">` with a visually-hidden `<label>`.
- Figure cards: one link each, accessible name = person's name + role
  (`aria-label`), avatar `alt=""` so it isn't announced twice.
- Every text/background pair meets **WCAG AA 4.5:1**. The scrim values above were
  chosen for that; if a change lightens the photo, re-check contrast rather than
  keeping the scrim.
- Visible focus ring on every interactive element — 2px `--mint-300` with a 2px
  offset. Never `outline: none` without a replacement.
- Full keyboard path: logo → tagline skipped → nav → language → search icon →
  theme → search field → search button → pills → figure cards → scroll button.
- All motion inside `@media (prefers-reduced-motion: no-preference)`.

---

## 6. Deliverables

1. `src/components/home/HomeHero.jsx` (+ its stylesheet) — the hero.
2. `src/components/layout/SiteHeader.jsx` (+ stylesheet) — the floating header,
   if the repo does not already have an equivalent to extend.
3. Small presentational children where they earn their place:
   `KeyFigureCard.jsx`, `StatStrip.jsx`, `SearchPill.jsx`, and an `icons/` module
   of inline SVGs.
4. Wiring in the homepage route so the hero receives repository-derived props.
5. Tests: extend `src/lib/prerenderContent.test.ts` to assert the prerendered
   homepage HTML contains the H1 text, all five nav links, all five popular-search
   links and all four figure-card `href`s.

## 7. Verification before you report done

Run all of these and paste the real output:

```bash
npm run typecheck
npm run lint
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # in one shell
npm run validate:crawlability # in another — must stay 1623/1623
```

Then screenshot the built page from `serve:dist` (**not** `npm run dev`, and
**never** `npm run preview`) at 1712px and at 390px, and compare against the
reference image side by side. Report any place you knowingly deviated and why.

## 8. Explicitly do not

- Do not add a dependency, including for icons, fonts, or animation.
- Do not restyle anything outside the hero and header.
- Do not change routes, slugs, or the route manifest.
- Do not touch data, the sync scripts, the database or the corrections endpoint.
- Do not "clean up" `slugify`, the NUL byte in `externalUrl.test.ts`, or the
  bundled-dataset size while you're in there.
- Do not hard-code `1,623` or the four people's names as literals.
- Do not invent copy. Every string in this spec is final for v1; I will tell you
  what to add or remove after I see the exact build.
