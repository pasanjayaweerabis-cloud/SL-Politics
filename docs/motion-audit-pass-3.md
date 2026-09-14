# Motion pass 3 — Harsha de Silva portfolio + shared components

Implements the six findings in `docs/portfolio-and-shared-motion-pass-3-prompt.md`.
Scope: `src/pages/PortfolioProfile.{jsx,css}`, `src/components/Toast.jsx`,
`src/styles/components.css`, `src/styles/base.css`. Nothing outside that list
was touched.

## What shipped

1. **Copy confirmation at the point of the click** (finding #1). `CopyButton`
   now renders both its idle glyph and a `check` glyph, always, stacked in the
   button's single grid cell, and crossfades between them on `data-copied` —
   set for 1600ms on a *successful* copy only (`copyWithFeedback`'s resolved
   `true`/`false`, per `PortfolioProfile.jsx`'s `CopyButton`). The toast is
   unchanged; it remains the screen-reader announcement path.
2. **Repeat-copy re-acknowledgement** (finding #2). `toast()` now carries a
   monotonic `bump` field, incremented on every update to a stable id.
   `ToastItem` pulses `data-bump="true"` on its own node for 240ms whenever
   `entry.bump` changes past the first render, and
   `.toast[data-open="true"][data-bump="true"]` gives it a 120ms
   `scale(1.02)` — below every real press-scale tier, since this is an
   acknowledgement, not a press.
3. **Toast stack FLIP** (finding #3) — **shipped**, not documented as a
   non-goal. See "The FLIP, and the CSP problem it ran into" below.
4. **Hero portrait entrance** (finding #4). `width`/`height` corrected to
   180×180 (matching the CSS box), `decoding="async"` added, and the fade is
   gated on `portraitState` — `'instant'` when `img.complete` on mount (the
   common, cached/prerendered case), `'faded'` only for a genuinely
   still-loading image. Only the non-instant path pays the fade, so LCP is
   unaffected for the case that matters.
5. **Travelling tier-tab indicator** (finding #5) — **shipped, with a
   mechanism change from the brief.** See below.
6. **Stale comment** (finding #6). The dead `docs/animation-improvement-prompt.md`
   reference in `base.css` is gone; the comment now points at
   `src/lib/router.tsx`'s `useRouteTransition` and this audit.

## The CSP problem, and why two implementations changed shape

The brief's Task 5 used an inline `style={{ '--active-index': n }}` on a
wrapper div; Task 3's FLIP used direct `node.style.transform`/`.transition`
writes. Both are inline style. `scripts/prerender.mjs` ships this site's CSP
with `style-src 'self'` and **no** `unsafe-inline`, on the explicit,
documented basis that the codebase has zero inline style anywhere to
accommodate ("grepped across every .jsx/.tsx source file and every one of the
1,628 prerendered HTML files ... and found zero").

Verified against the real `serve:dist` build (not `npm run dev`, which
doesn't apply the production CSP at all): clicking a tier tab with the
brief's inline-style version logged, and had blocked,
`Applying inline style violates ... 'style-src'`. Two independent fixes:

- **Task 5**: the `--active-index` custom property became a `data-active-index`
  attribute, with one CSS rule per index (`.hds-profile__tabs-wrap[data-active-index="1"] .tabs::after { translate: 100% 0; }`,
  etc.) instead of `calc(var(--active-index) * 100%)`. Four tabs means four
  fixed offsets — a discrete attribute costs nothing over a computed custom
  property here. (This surfaced a second, unrelated bug while fixing the
  first: the per-index override rules initially had *lower* CSS specificity
  than the base `:root[data-hydrated] .hds-profile .tabs::after` rule they
  needed to beat, so the indicator silently never moved. Fixed by prefixing
  the overrides with `:root[data-hydrated]` too, matching specificity so
  source order decides.)
- **Task 3**: the manual `node.style.transition = 'none'; node.style.transform
  = ...` invert-and-play became `node.animate([...keyframes], { duration,
  easing })` — the Web Animations API. Confirmed, empirically, that
  `Element.animate()` neither sets the `style` attribute nor fires a
  `securitypolicyviolation` event under this CSP; it's the standard technique
  for CSP-strict apps that need JS-driven, arbitrary-value animation. This
  actually simplified the code: WAAPI animates from the given keyframe
  immediately, so the reflow-forcing `void node.offsetHeight` dance the
  manual version needed (to stop the two style writes being coalesced) isn't
  needed at all. `duration`/`easing` are read at runtime from
  `--dur-enter`/`--ease-out` via `getComputedStyle` rather than reused
  directly off a CSS transition (there is no CSS transition to reuse once the
  mechanism is WAAPI) — still token-sourced, just read into JS instead of
  referenced from CSS. The reduced-motion guard the brief specified
  (`window.matchMedia('(prefers-reduced-motion: reduce)')`) stays exactly as
  necessary, since WAAPI bypasses `base.css`'s transition-list override
  either way — the reasoning holds regardless of mechanism.

Both fixes are recorded as a standing rule in `docs/motion-vocabulary.md`'s
"Notes for anyone adding motion here", so the next motion pass doesn't
rediscover this by shipping a broken build.

## Verification

Full loop from the brief's §0 run after every task, not batched:
`npm test`, `npm run typecheck`, `npm run lint`, then
`VITE_SITE_ORIGIN=https://javora.lk npm run build`, `npm run serve:dist`,
`npm run validate:crawlability` (**1623/1623**, unchanged).

`npm test` has two pre-existing failures unrelated to this pass's scope
(`scripts/distSecretScan.test.mjs`'s stale `dist/.DS_Store` check and
`server/sync/personParity.test.ts`'s Harini Amarasuriya evidence-source
parity check) — present before this pass started and outside the five files
in scope; left untouched.

Manual verification against `serve:dist` (the only server that tells the
truth about the CSP and prerendering — `npm run preview` was not used, per
the invariant): confirmed via `MutationObserver`/instrumented
`Element.prototype.animate` that (a) the copy button's `data-copied`
transitions `true` → cleared after 1600ms, (b) a same-id re-copy sets
`data-bump="true"` on the existing toast node immediately, (c) two
overlapping toasts produce real `translateY` FLIP animations with plausible
deltas (~50–65px, matching toast height + gap) at 200ms/`cubic-bezier(0.23,
1, 0.32, 1)`, (d) the tab indicator lands at 0/100%/200%/300% for the four
tiers and stays put under arrow-key focus movement (manual activation
preserved), including at a 340px viewport, and (e) the hero portrait renders
with `data-instant="true"` and full opacity on a warm/local load.

## Rejected / not touched

Nothing from this pass's findings was rejected — see "What shipped" above.
No candidate from `docs/motion-audit.md` Part 2 was reopened.
