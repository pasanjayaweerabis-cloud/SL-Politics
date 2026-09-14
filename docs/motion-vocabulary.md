# Motion vocabulary

A reference for the motion already in this codebase. Read this before adding
new motion — reuse one of these effects rather than inventing a fourth way to
fade something in. Durations are the authored values; `var(--dur)` is 220ms
and `var(--ease)` is `cubic-bezier(0.32, 0.72, 0.29, 1)` (an ease-out curve),
both defined in [`tokens.css:466`](../src/styles/tokens.css).

| Effect | Where | Duration | Easing |
|---|---|---|---|
| Press feedback (buttons) | [`components.css:47`](../src/styles/components.css) `.btn:active` | 100ms | ease-out |
| Press feedback (icon buttons) | [`layout.css:184`](../src/styles/layout.css) `.icon-btn:active` | 100ms | ease-out |
| Hover effect — colour (buttons) | [`components.css:9`](../src/styles/components.css) `.btn` | 220ms | `var(--ease)` |
| Hover effect — colour (icon buttons) | [`layout.css:155`](../src/styles/layout.css) `.icon-btn` | 220ms | `var(--ease)` |
| Hover effect — icon nudge, fine-pointer only | [`components.css:110`](../src/styles/components.css) `.action-link:hover svg` | 220ms | `var(--ease)` |
| Hover effect — 2px lift, fine-pointer only | [`components.css:270`](../src/styles/components.css) `.profile-card:hover` | 120ms | ease-out |
| Hover effect — 2px lift, fine-pointer only | [`components.css:487`](../src/styles/components.css) `.stat:hover` | 120ms | ease-out |
| Hover effect — border/shadow, fine-pointer only | [`components.css:1674`](../src/styles/components.css) `.principle:hover` | 220ms | `var(--ease)` |
| Hover effect — border/shadow, fine-pointer only | [`components.css:2505`](../src/styles/components.css) `.gov-card:hover` | 140ms | `var(--ease)` |
| Scale in — filter checkbox checkmark | [`components.css:1065`](../src/styles/components.css) `.filter-option input::before` | 120ms | `var(--ease)` |
| Crossfade + rotate — theme toggle glyphs | [`layout.css:198`](../src/styles/layout.css) `.theme-toggle .icon-moon/.icon-sun` | 220ms | `var(--ease)` |
| Theme flip — sitewide colour crossfade | [`base.css:52`](../src/styles/base.css) `.theme-switching` | 220ms, scoped to a ~260ms window | `var(--ease)` |
| Slide in / slide out — drawer panel | [`layout.css:363`](../src/styles/layout.css) `.drawer__panel` | 220ms | `var(--ease)` |
| Fade in / fade out — drawer scrim | [`layout.css:351`](../src/styles/layout.css) `.drawer__scrim` | 220ms | `var(--ease)` |
| Interruptible exit — drawer open/close state machine | [`Primitives.jsx:25`](../src/components/Primitives.jsx) `Drawer` | (drives the two rows above) | — |
| Reduced motion override | [`base.css:15`](../src/styles/base.css) `@media (prefers-reduced-motion: reduce)` | 100ms (colour/opacity kept); transform removed entirely | default |
| Preventing a jarring change — background/border crossfade on scroll-to-anchor | [`PortfolioProfile.css:1404`](../src/pages/PortfolioProfile.css) `.hds-profile__source:target` | 220ms | `var(--ease)` |
| Hover effect — colour + border (bordered source-record link) | [`PortfolioProfile.css:1482`](../src/pages/PortfolioProfile.css) `.hds-profile__source-link:hover` | 220ms | `var(--ease)` |
| Hover effect — icon nudge, fine-pointer only | [`PortfolioProfile.css:1498`](../src/pages/PortfolioProfile.css) `.hds-profile__source-link:hover svg` | 120ms | `var(--ease-out)` |
| Hover effect — colour (numbered "Sources NN" refs) | [`PortfolioProfile.css:962`](../src/pages/PortfolioProfile.css) `.hds-profile__row-sources a:hover` | 220ms | `var(--ease)` |
| Hover effect — colour (disclosure trigger) | [`PortfolioProfile.css:297`](../src/pages/PortfolioProfile.css) `.hds-profile__disclosure summary:hover` | 220ms | `var(--ease)` |
| Interruptible expand/collapse — details-content block-size | [`PortfolioProfile.css:328`](../src/pages/PortfolioProfile.css) `.hds-profile__disclosure::details-content` | 140ms | `var(--ease-out)` |
| Hover effect — row tint, fine-pointer + desktop only | [`PortfolioProfile.css:918`](../src/pages/PortfolioProfile.css) `.hds-profile__table tbody tr:hover` | 220ms | `var(--ease)` |
| Reveal — Details row fade-in on un-hide | [`PortfolioProfile.css:1172`](../src/pages/PortfolioProfile.css) `.hds-profile__details-row` | 140ms | `var(--ease-out)` |
| Rotate — Details row chevron, keyed to `aria-expanded` | [`PortfolioProfile.css:1148`](../src/pages/PortfolioProfile.css) `.hds-profile__details-chevron` | 140ms | `var(--ease)` |
| Preventing a jarring change — background tint on a hash-landed indicator/intervention row | [`PortfolioProfile.css:930`](../src/pages/PortfolioProfile.css) `.hds-profile__table tbody tr:target` | 220ms | `var(--ease)` (reuses the row-hover transition already declared above it) |
| Press feedback (nav links) | [`layout.css:105`](../src/styles/layout.css) `.nav__link:active` | 120ms | ease-out |
| Hover effect — colour + background (nav links) | [`layout.css:80`](../src/styles/layout.css) `.nav__link` | 220ms | `var(--ease)` |
| Origin-aware animation — current-page underline grows in from the reading start | [`layout.css:120`](../src/styles/layout.css) `.nav__link[aria-current="page"]::after` | 220ms | `var(--ease-out)` |
| Press feedback (language switcher trigger) | [`layout.css:253`](../src/styles/layout.css) `.lang-switch:active` | 120ms | ease-out |
| Crossfade — language switcher label, remounted (`key={lang}`) on a language change | [`layout.css:274`](../src/styles/layout.css) `.lang-switch__label` | 140ms | `var(--ease)` |
| Stagger — drawer link entrance, capped at each group's first 4 items, entrance only | [`layout.css:424`](../src/styles/layout.css) `.drawer[data-open="true"] .drawer__link` | 200ms, steps of 30ms | `var(--ease-out)` |
| Press feedback (footer links) | [`layout.css:648`](../src/styles/layout.css) `.footer__links a:active` | 120ms | ease-out |
| Press feedback (action links) | [`components.css:104`](../src/styles/components.css) `.action-link:active` | 120ms | ease-out |
| Press feedback (source pill / EvidencePill link) | [`components.css:215`](../src/styles/components.css) `.source-pill:active` | 120ms | ease-out |
| Press feedback (dropdown option row) | [`components.css:901`](../src/styles/components.css) `.dropdown__option:active` | 120ms | ease-out |
| Press feedback (portfolio copy-link/copy-citation buttons) | [`PortfolioProfile.css:208`](../src/pages/PortfolioProfile.css) `.hds-profile__copy-btn:active` | 120ms | ease-out |
| Press feedback (portfolio intervention "Details" toggle) | [`PortfolioProfile.css:1139`](../src/pages/PortfolioProfile.css) `.hds-profile__details-link:active` | 120ms | ease-out |
| Slide/fade in — toast entrance, plus asymmetric exit (see the state-machine row below) | [`components.css:2659`](../src/styles/components.css) `.toast[data-open="true"]` | enter 200ms, exit 140ms | `var(--ease-out)` |
| Press feedback (toast dismiss button) | [`components.css:2711`](../src/styles/components.css) `.toast__dismiss:active` | 120ms | ease-out |
| Interruptible exit — toast dismissal state machine, retains the DOM node for one extra paint so the exit row above actually plays | [`Toast.jsx:147`](../src/components/Toast.jsx) `useVisibleToasts` | 140ms + 20ms buffer | (drives the row above) |
| Crossfade — copy button glyph confirmation, both glyphs always in the DOM, stacked in one grid cell | [`PortfolioProfile.css:215`](../src/pages/PortfolioProfile.css) `.hds-profile__copy-glyph` | 140ms | `var(--ease-out)` |
| Re-acknowledgement pulse — toast bumped by a stable-id update (e.g. the same copy button clicked twice) | [`components.css:2671`](../src/styles/components.css) `.toast[data-open="true"][data-bump="true"]` | 120ms | ease-out |
| Travelling indicator — tier-tab underline, position driven by a `data-active-index` attribute (not an inline style — see the note in the CSS) | [`PortfolioProfile.css:620`](../src/pages/PortfolioProfile.css) `.hds-profile .tabs::after` | 220ms | `var(--ease-out)` |
| Reveal — hero portrait fade-in, skipped for an already-decoded/cached image so the LCP element never pays a fade it doesn't need | [`PortfolioProfile.css:268`](../src/pages/PortfolioProfile.css) `.hds-profile__portrait` | 200ms | `var(--ease-out)` |
| FLIP — toast stack shift when a sibling enters/exits a `column-reverse` stack, played via `Element.animate()` (Web Animations API) rather than an inline `style.transform`, because this site's CSP ships `style-src 'self'` with no `unsafe-inline` | [`Toast.jsx:274`](../src/components/Toast.jsx) `Toaster`'s FLIP effect | duration/easing read at runtime from `--dur-enter`/`--ease-out` | `var(--ease-out)` |

## Notes for anyone adding motion here

- **Reuse `var(--dur)`/`var(--ease)`** unless the effect is hover/press
  feedback, where frequency of use argues for something shorter — this
  codebase's convention is 100–140ms for those, 220ms for everything else
  (theme flip, drawer, badge/tab colour changes).
- **Gate hover motion** (anything that moves `transform` or `box-shadow`, not
  plain colour) behind `@media (hover: hover) and (pointer: fine)`. Without it,
  `:hover` sticks after a tap on touch devices.
- **Never start a scale-in at `scale(0)`.** Pair it with `opacity: 0` and a
  small starting scale (this codebase uses 0.6) so it reads as growing, not
  materialising from nothing.
- **Prefer a transition on a state attribute over a keyframe animation**
  whenever the element can be opened and closed in quick succession (drawers,
  panels, menus). Keyframes always restart from their `from` frame; a
  transition retargets from wherever the element currently is, which is what
  makes it interruptible.
- **Compositing vs. paint.** `transform` and `opacity` are the only properties
  a browser can animate on the GPU without redoing layout or paint. Several
  effects above (card hovers, the drawer) also transition `border-color`,
  `background-color`, or `box-shadow` alongside `transform` — those channels
  still trigger paint, they're just cheap enough at this scale not to jank.
  Never animate `width`/`height`/`top`/`left` (layout thrashing).
- **No inline `style`, ever — including from JS.** This site's CSP
  (`scripts/prerender.mjs`) ships `style-src 'self'` with no `unsafe-inline`,
  hash or nonce, on the documented basis that the codebase has zero inline
  style to accommodate. Confirmed against the real prerendered build: both a
  React `style={{...}}` prop and a JS `element.style.x = ...` write trigger
  and get blocked by that policy. A per-element custom property (e.g. a
  computed grid position) needs a discrete `data-*` attribute plus one CSS
  rule per value instead of a computed inline value; an animation that needs
  an arbitrary runtime value (a FLIP delta) can use `Element.animate()` (the
  Web Animations API) instead — confirmed, empirically, not to touch the
  `style` attribute or fire a `style-src` violation. WAAPI also means
  `base.css`'s reduced-motion override (which only strips `transform` from
  *CSS transition* lists) never reaches it, so any WAAPI animation needs its
  own explicit `prefers-reduced-motion` check in JS.

## Motion that doesn't fit the named vocabulary

- **`.filter-group__chevron` rotation** ([`components.css:975`](../src/styles/components.css))
  — a plain 180° rotate tied to a `<details>` element's open/closed state.
  It isn't a slide, scale, pop, or crossfade; it's closest to the rotate half
  of "Crossfade + rotate" above, minus the crossfade. Left un-renamed rather
  than forcing it into a term that doesn't quite fit.
- **The drawer's double-`requestAnimationFrame` entrance** ([`Primitives.jsx:56`](../src/components/Primitives.jsx))
  is implementation plumbing (giving a freshly-mounted element a real first
  frame to transition from), not a named effect in its own right — it's how
  the slide-in above gets triggered, not a distinct motion.
