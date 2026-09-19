# Motion pass 3 — Harsha de Silva portfolio + shared components

**For:** Claude Code, working in `SL Politiccs by Javora-React`.
**Scope:** `src/pages/PortfolioProfile.{jsx,css}` and the shared UI it uses
(`src/components/Toast.jsx`, `src/components/Tabs.jsx`, `src/styles/components.css`,
`src/styles/base.css`). **Nothing else.** Do not touch `DirectoryPage.jsx`,
`PersonPage.jsx`, `GovernmentPage.jsx`, `HomePage.jsx`, the server, or any dataset.

---

## 0. Read this before you write a line

This codebase has already had **two motion passes and a formal audit**. The
results are in `docs/motion-audit.md` and the effect ledger is
`docs/motion-vocabulary.md`. **Read both first.** The audit's Part 2 lists
candidates that were deliberately **rejected** — filtered-table row animation,
typeahead empty-state swaps, clip-path duplicated tab labels, drag-to-dismiss.
**Do not re-open any of them.** Nothing in this document overturns a decision
recorded there.

Standing project rules that bind this work:

- **Add no dependencies.** No Framer Motion, no spring library. CSS transitions,
  `@starting-style`, and small amounts of React state only.
- **Every value comes from `src/styles/tokens.css`.** Invent no new duration,
  easing, or scale number. The ones you will need:
  `--dur: 220ms`, `--dur-press: 120ms`, `--dur-fast: 140ms`, `--dur-enter: 200ms`,
  `--dur-exit: 140ms`, `--ease: cubic-bezier(0.32, 0.72, 0.29, 1)`,
  `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.
- **Press-scale tiers are settled** (`docs/motion-audit.md` §5.1): icon-only
  buttons `0.92`, boxed triggers `0.97`, text/pill controls `0.98`, full-width
  rows `0.99`, cards `0.995`. Use these; do not add a sixth number.
- **Prefer a transition on a state attribute over a keyframe** wherever the
  element can be retriggered quickly — keyframes restart from `from`, transitions
  retarget from wherever the element is.
- **Never animate `width`/`height`/`top`/`left`.** `transform` and `opacity` only,
  plus cheap paint channels (`color`, `background-color`, `border-color`) where
  already conventional.
- **Gate any hover *transform* behind** `@media (hover: hover) and (pointer: fine)`.
- **Reduced motion is handled globally** in `base.css` (it strips `transform` from
  every transition list and caps duration at 100ms). You only need a local
  `prefers-reduced-motion` rule for pseudo-elements the global `*`/`*::before`/
  `*::after` selector cannot reach (e.g. `::details-content`) — `PortfolioProfile.css:343`
  is the existing example.
- **Prerendering is a hard constraint.** These pages are statically prerendered and
  `npm run validate:crawlability` is a gate. Never make content conditional on JS.
  Anything that would leave a page broken without hydration must be gated on
  `:root[data-hydrated]` (set in `src/main.jsx:31`) — that idiom already exists at
  `components.css:388` (`.profile-card--revealing`), `components.css:428`
  (`.avatar img`), and `components.css:2091` (`[role="tabpanel"]`).
- `.jsx` stays `.jsx`. Do not convert to `.tsx`.

**Verification after every task below:**
```bash
npm test && npm run typecheck && npm run lint
npm run build            # needs VITE_SITE_ORIGIN=https://javora.lk
npm run serve:dist       # in one terminal
npm run validate:crawlability   # must stay 1623/1623
```
`npm run preview` lies about deep routes — never judge by it.

---

## 1. Findings this pass (all verified at the cited line)

| # | Sev | Category | Location | Finding |
|---|---|---|---|---|
| 1 | MED | Feedback / proximity | `PortfolioProfile.jsx:117` `CopyButton` | A copy action's only confirmation is a toast in the opposite corner of a ~4,000px page. The button the user is looking at does not change at all. |
| 2 | MED | Feedback / dead click | `Toast.jsx:106` `toast()` + `PortfolioProfile.jsx:133` | `toastId` is stable per button (`copy-link-${id}`). Clicking the *same* copy button twice replaces the entry with an identical message — the DOM does not change, so the second click produces **no visible response whatsoever**, though the copy did happen. |
| 3 | MED | Jarring change | `components.css:2606` `.toaster` / `.toaster__region` | Flex `column-reverse` with `gap`. "Copy link" then "Copy citation" produce two distinct ids, so a second toast enters and **teleports** the first upward by its own height + gap with no transition; on unmount after `EXIT_MS` the survivor snaps back down. Every other stack-shift in this codebase is deliberately smoothed (`.grid-cards` dip at `components.css:461`, the `display`-out-of-the-tabpanel-transition reasoning at `components.css:2083`). |
| 4 | MED | Missing entrance | `PortfolioProfile.jsx:978` `<img class="hds-profile__portrait">` | The 180×180 hero portrait is a raw `<img>` with no load handling — it hard-pops in. Every 52px thumbnail on the site has a hydration-gated fade (`components.css:428` `.avatar img`), so the *largest* image on the page is the one effect missing. It also declares `width="96" height="96"` while CSS renders it at 180×180 — the pre-CSS box is the wrong size. |
| 5 | LOW | Spatial continuity | `PortfolioProfile.css:565` `.hds-profile .tabs__tab` | The active tier's 2px amber underline only transitions `border-color`: it fades out under one tab and in under another. Four equal columns in one row are a spatial set; a travelling indicator says "you moved here", a crossfade says "a different thing lit up." (This is **not** the clip-path label duplication rejected in the audit — no DOM duplication, no `aria-hidden` surface.) |
| 6 | LOW | Hygiene | `base.css:219` | The `::view-transition-*` block is labelled `PROVISIONAL — see docs/animation-improvement-prompt.md section 5b`. **That file does not exist** in `docs/`. The decision it defers to is now settled and documented in `src/lib/router.tsx:251-283`. |

**Already correct — do not "fix":** the toast exit state machine (`Toast.jsx:147`),
the drawer's interruptible open/close, the nav underline's `scaleX(0)`
`@starting-style` (a line drawn from its own anchor, the documented exception),
the tabpanel opacity-only fade, `.hds-profile__disclosure::details-content`'s
block-size transition and its local reduced-motion opt-out, and
`.notice--result`'s commented 260ms exception.

---

## 2. Task 1 — Confirm the copy at the point of the click (finding #1)

**Files:** `src/pages/PortfolioProfile.jsx`, `src/pages/PortfolioProfile.css`

### Current code — `PortfolioProfile.jsx:117`

```jsx
function CopyButton({ iconName, ariaLabel, getText, successMessage, toastId }) {
  const { t } = useI18n();
  const handleClick = e => {
    e.preventDefault();
    e.stopPropagation();
    copyWithFeedback(getText(), { toastId, successMessage, failureMessage: t('toast.copyFailed') });
  };
  return <button type="button" className="hds-profile__copy-btn" aria-label={ariaLabel} onClick={handleClick}>
    <Icon name={iconName}/>
  </button>;
}
```

### What to build

On a **successful** copy only, swap the button's glyph to a check for 1600ms,
crossfading the two icons — the same "crossfade + rotate" idiom the theme toggle
already uses at `layout.css:198`, minus the rotate.

1. `copyWithFeedback` already resolves to `true`/`false`. Use that return value:
   only enter the confirmed state when it resolves `true`.
2. Add `const [copied, setCopied] = React.useState(false)` to `CopyButton`.
   On `true`, `setCopied(true)` and start a 1600ms timer that sets it back to
   `false`. **Clear the timer on unmount and on re-click** (store it in a ref) so
   a rapid double-click doesn't leave a stale timer, and so React never warns
   about setting state on an unmounted component.
3. Render **both** glyphs, always, stacked in the same grid cell — do not
   conditionally render one, or there is nothing to crossfade:

```jsx
<button
  type="button"
  className="hds-profile__copy-btn"
  data-copied={copied ? 'true' : undefined}
  aria-label={ariaLabel}
  onClick={handleClick}
>
  <Icon name={iconName} className="hds-profile__copy-glyph hds-profile__copy-glyph--idle"/>
  <Icon name="check" className="hds-profile__copy-glyph hds-profile__copy-glyph--done"/>
</button>
```

`check` exists in `src/lib/icons.jsx:42`. Do not add an icon.

4. Keep the toast exactly as it is. It is the screen-reader announcement path
   (`Toaster`'s `role="status"` region) and removing it would regress
   accessibility. The icon swap is *additional*, visual-only feedback.
5. The button is 26px with a 14px glyph (`PortfolioProfile.css:172-186`). Stack
   the two glyphs with `grid-area: 1 / 1` inside the existing
   `display: inline-grid; place-items: center`.

### Exact CSS to add, after the existing `.hds-profile__copy-btn:active` rule

```css
/* Feedback at the point of action: the copy's only confirmation used to be a
   toast in the opposite corner of a page this long. Both glyphs are always in
   the DOM, stacked in the button's single grid cell, so this is a crossfade —
   the theme toggle's idiom (layout.css:198) minus the rotate — not a swap.
   Opacity only: the glyph must not move inside a 26px box. */
.hds-profile__copy-glyph {
  grid-area: 1 / 1;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.hds-profile__copy-glyph--done { opacity: 0; }

.hds-profile__copy-btn[data-copied="true"] .hds-profile__copy-glyph--idle { opacity: 0; }
.hds-profile__copy-btn[data-copied="true"] .hds-profile__copy-glyph--done { opacity: 1; }
```

Note `.hds-profile__copy-btn` is `opacity: 0` until hover/focus on fine pointers
(`PortfolioProfile.css:190-198`). The confirmed state must not force it visible —
if the pointer has already left, the button fades out carrying the check, and
that is correct. Do **not** add a rule keeping it visible while `data-copied`.

### Out of scope
No progress ring, no colour change, no scale bounce, no tooltip. One crossfade.

---

## 3. Task 2 — Make a repeat copy visible (finding #2)

**File:** `src/components/Toast.jsx`

Task 1 largely covers this at the button, but the toast itself still silently
replaces identical content. Add a minimal re-acknowledgement.

### Current code — `Toast.jsx:106`

```js
export function toast(message, options = {}) {
  const { id = nextId(), description, duration = DEFAULT_DURATION, variant = 'default' } = options;
  const entry = { id, message, description, duration, variant };
  const isUpdate = toasts.some(t => t.id === id);
  ...
}
```

### What to build

1. Give the entry a monotonic `bump` field. On an update, `bump` is the previous
   entry's `bump + 1`; on a fresh entry it is `0`. This gives `ToastItem` a value
   that changes even when the message text is identical.
2. In `ToastItem`, drive a short attribute pulse from it: a `React.useEffect`
   keyed on `entry.bump` that (skipping the first run, where the entrance
   animation already covers it) sets `data-bump="true"` on the node, then clears
   it after `--dur-press * 2` (240ms). Use a ref to the node and a ref for the
   timer; clear on unmount.
3. CSS in `components.css`, immediately after the `.toast[data-open="true"]` rule:

```css
/* Re-acknowledgement: toast() replaces an entry with a matching stable id in
   place, so clicking the same copy button twice produced an identical DOM and
   no visible response at all. A transition, not a keyframe — this is exactly
   the rapidly-retriggerable case where a keyframe would restart from `from`
   and stutter. 1.02 is deliberately below every press-scale tier: this is an
   acknowledgement, not a press. */
.toast[data-open="true"][data-bump="true"] {
  transform: translateY(0) scale(1.02);
  transition: transform var(--dur-press) var(--ease-out);
}
```

The `translateY(0)` must be restated because it shares the `transform` property
with the open-state rule. Under `prefers-reduced-motion` the global override in
`base.css:209` strips `transform` from the transition list, so this becomes an
instant no-op — which is the right degradation; do not add a local media query.

### Out of scope
Do not change `MAX_VISIBLE`, `DEFAULT_DURATION`, the pause/resume timers, the
`useVisibleToasts` exit machine, or the two live regions. Those are all settled.

---

## 4. Task 3 — Smooth the toast stack shift (finding #3)

**Files:** `src/components/Toast.jsx`, `src/styles/components.css`

This is the highest-risk task in this document. **Read the whole section before
starting, and if the measured result does not clearly feel better, stop and
write the finding up as a documented non-goal in `docs/motion-vocabulary.md`
instead of shipping a half-working FLIP.** That is an acceptable outcome.

### The problem, precisely

`.toaster__region` (`components.css:2620`) is `display: flex; flex-direction:
column-reverse; gap: var(--space-2)`. Entries are prepended to the store
(`Toast.jsx:112`, `[entry, ...toasts]`), so a new toast renders at the **bottom**
of the visual stack and every toast above it is displaced upward by its own
height plus the gap, **on the same frame, with no transition**. Flex layout
position is not a transitionable property, so no CSS-only fix exists.

### The approach — FLIP, transform-only, hydration-only

In `Toaster`, measure and invert. Do **not** reach for a library.

1. Keep a `React.useRef(new Map())` of `id -> DOMRect.top`, and a
   `React.useRef(new Map())` of `id -> HTMLElement` populated by a `ref`
   callback on each `ToastItem`'s root node (thread a `nodeRef` prop through, or
   forward the ref — either is fine, but keep `ToastItem`'s existing props and
   behaviour otherwise untouched).
2. In a `React.useLayoutEffect` that runs after every render of `combined`:
   for each element still present in both the previous and current maps, compute
   `delta = previousTop - currentTop`. If `Math.abs(delta) < 1`, skip it.
3. For a non-zero delta, apply the invert-and-play in the standard two-step:
   ```js
   el.style.transition = 'none';
   el.style.transform = `translateY(${delta}px)`;
   // force a style flush so the browser does not coalesce the two writes
   void el.offsetHeight;
   el.style.transition = '';       // falls back to the CSS transition
   el.style.transform = '';        // back to the .toast[data-open] value
   ```
   Because `.toast[data-open="true"]` already declares
   `transition: transform var(--dur-enter) var(--ease-out)`, clearing the inline
   values lets the element animate home on the component's own token values.
   **Do not write a duration or easing into JS.**
4. Record the new positions into the previous-positions map at the end of the
   effect, and delete entries for ids no longer rendered.
5. **Skip the entire effect when the entering toast is the one being measured** —
   a brand-new node has no previous position, and its `@starting-style` entrance
   (`components.css:2657`) must not be fought with an inline transform.
6. **Skip the entire effect under reduced motion:**
   ```js
   if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
   ```
   An inline `transform` written by JS bypasses `base.css`'s global
   `transition-property` override, so this is the only place in the codebase that
   needs an explicit JS-side check. Put a comment saying exactly that.
7. **Server safety.** `Toaster` renders on the server (`entry-server.jsx`) with an
   empty list. `useLayoutEffect` does not run on the server, but React warns about
   it during SSR — the file already uses `useSyncExternalStore` with a
   `getServerSnapshot`, so follow the same discipline: the effect body must never
   touch `window` outside the effect, and the empty-list case must return early
   before any measurement.

### Verification (feel-check, mandatory)

There is no test that can judge this. Add a temporary dev-only trigger, or use
the page itself: open `/person/harsha-de-silva`, click a section heading's
**Copy link** button, then within four seconds click a source record's **Copy
citation** button. Watch the first toast.

- In DevTools, set the animation speed to 10% and confirm the first toast
  *travels* upward rather than jumping.
- Confirm no horizontal movement at any point.
- Confirm the second toast's own entrance is unchanged (fade + 8px rise).
- Dismiss the lower toast with its × and confirm the survivor *travels* down
  after the 160ms exit, rather than snapping.
- Enable "Emulate prefers-reduced-motion: reduce" and confirm both toasts appear
  and disappear with no movement at all and no console errors.
- Confirm the page does not jank: the toaster is `position: fixed` and only
  `transform` is written, so nothing here may trigger layout on the document.

### Out of scope
Sonner-style scale-and-stack-behind, swipe-to-dismiss (explicitly rejected in
`docs/motion-audit.md` Part 2), expanding-on-hover stacks, and any change to
`.toaster`'s positioning or `z-index`.

---

## 5. Task 4 — Hero portrait entrance (finding #4)

**Files:** `src/pages/PortfolioProfile.jsx`, `src/pages/PortfolioProfile.css`

### Current code — `PortfolioProfile.jsx:978`

```jsx
<img
  className="hds-profile__portrait"
  src={data.portraitUrl}
  alt={data.name}
  width="96"
  height="96"
/>
```

### What to build

Mirror the existing `.avatar img` idiom at `components.css:426-433` exactly.
**With one critical addition the avatar does not need:** this portrait is at or
near the LCP element, and fading an LCP image in from `opacity: 0` delays the
recorded LCP. So the fade must apply **only to an image that was not already
complete on mount.**

1. `width`/`height` → `180`/`180`, matching the CSS box at
   `PortfolioProfile.css:232-233`. The current `96` reserves the wrong
   pre-stylesheet box.
2. Add `decoding="async"`. Do **not** add `loading="lazy"` — this is above the
   fold and lazy-loading it would make the LCP worse, not better.
3. In `PortfolioProfile`, add a ref and mark the image:
   ```jsx
   const portraitRef = React.useRef(null);
   const [portraitReady, setPortraitReady] = React.useState(false);
   // A cached or already-decoded portrait (the common case on a prerendered
   // page) is complete before this effect runs — it must appear instantly, or
   // the fade delays the page's LCP. Only a genuinely-still-loading image
   // gets the entrance.
   React.useEffect(() => {
     const img = portraitRef.current;
     if (img && img.complete) setPortraitReady(true);
   }, []);
   ```
   and on the element: `ref={portraitRef}`, `onLoad={() => setPortraitReady(true)}`,
   `data-loaded={portraitReady ? 'true' : undefined}`, plus
   `data-instant` when `img.complete` was true at mount — or, simpler and
   preferred: track one state with three values (`'pending' | 'instant' | 'faded'`)
   and emit `data-loaded="true"` for both non-pending values while emitting
   `data-instant="true"` only for the cached case.
4. CSS, placed directly after the `.hds-profile__portrait` rule:

```css
/* Gated on data-hydrated for the same reason .avatar img is (components.css:428):
   without it a prerendered page, or a JS failure, leaves the portrait permanently
   invisible behind this fade. `data-instant` covers the cached/already-decoded
   case — this image is at or near the LCP element, and fading it up from 0 would
   push the LCP out by the fade's own duration for no benefit. */
:root[data-hydrated] .hds-profile__portrait:not([data-instant="true"]) {
  opacity: 0;
  transition: opacity var(--dur-enter) var(--ease-out);
}

:root[data-hydrated] .hds-profile__portrait[data-loaded="true"] { opacity: 1; }
```

5. **Do not add a broken-image fallback, initials, or a skeleton.** The site's
   `Avatar` has a fallback system; this page deliberately does not use `Avatar`,
   and adding one here is a design change, not a motion change.

### Verification
- With DevTools network throttled to Slow 3G, hard-reload
  `/person/harsha-de-silva` and confirm the portrait fades rather than pops.
- Reload with a warm cache and confirm it appears **instantly**, with no fade.
- Run a Lighthouse LCP check on `serve:dist` before and after; LCP must not
  regress. If it does, the `data-instant` path is not firing — fix it rather
  than shipping the fade.
- Disable JavaScript entirely and confirm the portrait is visible.

---

## 6. Task 5 — Travelling tier-tab indicator (finding #5)

**Files:** `src/pages/PortfolioProfile.css`, `src/pages/PortfolioProfile.jsx`

### Why this is safe where clip-path was not

`docs/motion-audit.md` Part 2 rejected duplicating the four tab labels in the
DOM for a clip-path colour transition — real crawlability and `aria-hidden`
surface for a marginal gain. This is different: **no DOM duplication, no label
copies, no ARIA impact.** `.hds-profile .tabs` is
`grid-template-columns: repeat(4, minmax(84px, 1fr))` — four *equal* columns —
so an indicator's position is pure arithmetic on a CSS custom property. **No JS
measurement, no `ResizeObserver`.** This also holds when the strip overflows
below ~360px: at overflow all four columns are 84px, so 25% of the content box
is still exactly one column.

### What to build

1. On the `Tabs` wrapper in `PortfolioProfile.jsx`, set an index custom property.
   `Tabs` does not accept arbitrary props, and **you must not change
   `src/components/Tabs.jsx`** — it is shared with every other profile page and
   its roving-tabindex / manual-activation behaviour is load-bearing. Instead,
   wrap the existing `<Tabs …/>` in a `<div className="hds-profile__tabs-wrap">`
   carrying `style={{ '--active-index': TIER_TABS.findIndex(t => t.id === activeTab) }}`.
2. CSS:

```css
.hds-profile__tabs-wrap { display: contents; }

/* The active tier's underline used to only crossfade its border-color: it
   vanished under one tab and appeared under another, which reads as two
   separate things lighting up rather than one indicator moving. Four equal
   grid columns mean the position is arithmetic, not measurement.
   Hydration-gated: the per-tab border-bottom below is the no-JS baseline and
   must keep working in the prerendered HTML. */
:root[data-hydrated] .hds-profile .tabs {
  position: relative;
}

:root[data-hydrated] .hds-profile .tabs::after {
  content: "";
  position: absolute;
  inset-block-end: -1px;
  inset-inline-start: 0;
  inline-size: 25%;
  block-size: 2px;
  background: var(--amber);
  translate: calc(var(--active-index, 0) * 100%) 0;
  transition: translate var(--dur) var(--ease-out);
  pointer-events: none;
}

/* With the travelling indicator present, the per-tab underline would double it. */
:root[data-hydrated] .hds-profile .tabs__tab--active {
  border-bottom-color: transparent;
}
```

Note the use of the **`translate` property**, not `transform` — `base.css:209`'s
reduced-motion override strips `transform` from transition lists but not
`translate`, so add the pseudo-element to that opt-out explicitly:

```css
/* in base.css, inside the existing @media (prefers-reduced-motion: reduce) block,
   beside the .filter-group::details-content line and for the same reason —
   ::after on a specific element is reached by *::after, but `translate` is not
   in the global transition-property allowlist, so state it here. */
.hds-profile .tabs::after { transition: none; }
```

Alternatively use `transform: translateX(...)` and rely entirely on the global
override. **Either is acceptable — pick one and comment which and why.** Do not
ship both mechanisms.

3. `--active-index` must not be a custom property React stringifies badly.
   Pass it as a number; React writes custom properties verbatim.
4. Confirm the indicator is invisible to assistive tech (it is a `::after` with
   no content) and that `aria-selected` still carries the state.

### Verification
- Click through all four tiers and confirm the bar slides. At 10% animation speed
  confirm it travels rather than fades.
- Arrow-key across the tabs **without** pressing Enter and confirm the indicator
  does **not** move — this tab set uses manual activation deliberately
  (`Tabs.jsx:6-14`); an indicator that follows focus would break that contract.
- Narrow the viewport below 360px, scroll the strip horizontally, and confirm the
  indicator stays aligned to its tab.
- Disable JavaScript, load the prerendered page, and confirm the *original*
  per-tab underline still marks Performance.
- Confirm `npm run validate:crawlability` still reports 1623/1623.

---

## 7. Task 6 — Repoint the stale comment (finding #6)

**File:** `src/styles/base.css:219`

The comment reads:

```
/* PROVISIONAL — see docs/animation-improvement-prompt.md section 5b. The
   route change itself is already gated on prefers-reduced-motion in
   src/lib/router.tsx ...
```

`docs/animation-improvement-prompt.md` does not exist. The reasoning it deferred
to is now fully written out in `src/lib/router.tsx:245-283` (the measured
flushSync cost, the directory-route opt-out, the abort swallowing). Drop the
`PROVISIONAL —` prefix and the dead path, and point at
`src/lib/router.tsx`'s `useRouteTransition` and `docs/motion-audit.md` instead.
**Change the comment only.** The CSS rule itself is correct.

---

## 8. Recommended execution order

1. **Task 6** (comment) — trivial, do it first and get it out of the way.
2. **Task 4** (portrait) — self-contained, measurable, no shared-component risk.
3. **Task 1** (copy confirmation) — the highest user-visible value on this page.
4. **Task 5** (tab indicator) — touches only page-scoped CSS plus one wrapper.
5. **Task 2** (toast bump) — small, but touches the shared toast store.
6. **Task 3** (toast FLIP) — last, highest risk, and the one it is legitimate to
   abandon and document instead.

After each task: run the full verification block from §0. Do not batch all six
and verify once.

## 9. When you are done

Append a row to `docs/motion-vocabulary.md` for **every** effect you added, in
that file's existing table format (Effect / Where / Duration / Easing), and write
a short `docs/motion-audit-pass-3.md` in the style of `docs/motion-audit.md`:
what you implemented, what you rejected and why, and — for Task 3 specifically —
whether the FLIP shipped or was documented as a non-goal.

Do not commit unless asked.
