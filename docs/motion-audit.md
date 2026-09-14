# Motion audit — Harsha de Silva portfolio and shared components

Audit of the motion/interaction work already landed, uncommitted, in two earlier
passes (`docs/portfolio-and-shared-motion-prompt.md`,
`docs/portfolio-and-shared-visuals-toasts-prompt.md`). Uses
`/find-animation-opportunities` (search, read-only) then `/emil-design-eng`
(review). Scope: (A) `src/pages/PortfolioProfile.jsx`/`.css`, (B) the shared
UI/shell listed in the audit brief. Everything else was read for context only.

## Held for approval

None. Every surviving opportunity below is a defect fix (a missing press
state, or a component's own exit animation never actually playing) — nothing
here adds a new behaviour or changes the feel of something that already
animates deliberately. All of it was implemented directly.

---

## Part 1 — Opportunities table

| # | Location | Today | Purpose | Frequency | Suggested motion |
| --- | --- | --- | --- | --- | --- |
| 1 | [`Toast.jsx:86`](../src/components/Toast.jsx:86) (store `dismiss`) | A dismissed toast (auto-timeout, the dismiss button, or `toast.dismiss()`) is spliced out of the store and unmounts on the same render — the closed-state CSS already on `.toast` (`translateY(8px)`, `opacity:0`, `--dur-exit`) never gets a chance to play; it just disappears | Preventing a jarring change / spatial consistency (a toast should leave the way it arrived — the file's own header cites Sonner as the model) | Occasional (copy actions today) | Keep the just-removed entry mounted for one more paint, rendered without `data-open="true"` so it falls back to the existing closed shape: `transform: translateY(8px); opacity: 0; transition: transform var(--dur-exit) var(--ease-out), opacity var(--dur-exit) var(--ease-out)` (both already defined) — drop it from the render list after `--dur-exit` (140ms) + a small buffer |
| 2 | [`PortfolioProfile.css:172`](../src/pages/PortfolioProfile.css:172) `.hds-profile__copy-btn` | "Copy link" / "Copy citation" buttons have hover and focus-visible states but no `:active` — a click gives no feedback | Feedback | Occasional (source records, section headings) | `:active { transform: scale(0.92) }`, `transition: …, transform var(--dur-press) var(--ease-out)` — icon-only-button tier (`.icon-btn`, `.search__clear`) |
| 3 | [`components.css:2688`](../src/styles/components.css:2688) `.toast__dismiss` | The toast's own close (×) button has hover and focus-visible states but no `:active` | Feedback | Occasional | `:active { transform: scale(0.92) }` — same icon-button tier as #2 |
| 4 | [`PortfolioProfile.css:1118`](../src/pages/PortfolioProfile.css:1118) `.hds-profile__details-link` | The interventions table's "Details" toggle has hover/focus-visible/`[aria-expanded]` states but no `:active` | Feedback | Occasional (Performance tier, per intervention row) | `:active { transform: scale(0.98) }` — text/pill-button tier (`.action-link`, `.tabs__tab`, `.source-pill`) |

Every value above is pulled from `tokens.css` (`--dur-press`, `--ease-out`,
`--dur-exit`); nothing new was introduced.

## Part 2 — Rejected candidates

- **`VotingRecordSection`'s year/evidence filters** ([`PortfolioProfile.jsx:597`](../src/pages/PortfolioProfile.jsx:597)) — changing either `<select>` adds/removes `<tr>`s instantly. **Rejected: Function.** This is the dense evidentiary table itself; the sitewide tabpanel fade rule right below in `components.css` was deliberately written *without* a corresponding rule for filtered rows for the same reason ("must never move sideways while someone is reading"). Animating row insert/removal here would decorate data the reader is trying to scan, not help them.
- **Typeahead empty-state swap** ([`SearchTypeahead.jsx:193`](../src/components/SearchTypeahead.jsx:193)) — "No matches" replaces the results list the instant a keystroke stops matching anything. **Rejected: Frequency.** This can re-render on every keystroke while composing a query — tens/hundreds of times per session, squarely in the "no animation, or none at all" tier, and the panel's own open/close transition already brackets the interaction.
- **Clip-path-duplicated tab list for perfect colour transitions** (Tier tabs, [`PortfolioProfile.css:556`](../src/pages/PortfolioProfile.css:556)) — considered per the brief's own section 5.5. **Rejected: Function/complexity.** It duplicates all four tab labels in the DOM and the prerendered HTML and needs bespoke `aria-hidden` handling on a manual-activation ARIA tab set (`Tabs.jsx`) — real crawlability and accessibility surface for a marginal colour-timing improvement over the underline+weight+colour change already there.
- **Drag/swipe-to-dismiss on the Drawer or on toasts** — considered per section 5.6. **Rejected: no drag UI exists anywhere on the site today**, and both targets are the two most state-machine-heavy components in scope (`Drawer`'s focus trap, `Toast`'s pause/resume/exit timers). The gesture-and-physics surface (velocity thresholds, pointer capture, rubber-banding) is disproportionate to a "nice to have" dismissal shortcut neither component currently lacks a working alternative for (tap the scrim/×).
- **"Load more" pagination reveal** — `Pagination` itself ([`Primitives.jsx:295`](../src/components/Primitives.jsx:295)) is in scope, but the cards it appends live in `DirectoryPage.jsx`, which section 3 marks read-only. **Out of scope**, not evaluated further.

## Part 3 — Verdict

This interface needs very little motion, and the two earlier passes already
spent the budget well: origin-aware dropdown/typeahead panels, an
interruptible drawer, hash-landing highlights, disclosure block-size
transitions, and — via the sitewide `:root[data-hydrated] [role="tabpanel"]`
rule in `components.css` — the Tier tab switch *already* gets a hydration-gated
fade with no change needed here. What survived the gate is narrow: three
missing `:active` states and one real defect. The highest-leverage fix is the
toast exit (#1): the component's own doc comment models it on Sonner and the
CSS for a proper exit already existed — it just never ran, so every dismissal
silently broke the "leaves the way it arrived" promise. Everything else is
finish work, not a gap in coverage.

---

## Emil review — Before / After / Why

| Before | After | Why |
| --- | --- | --- |
| `Toast.jsx`: `dismiss()` removes an entry from the store and its `<ToastItem>` unmounts the same render — `.toast`'s closed-state CSS (`translateY(8px)`, `opacity:0`, `--dur-exit`) is defined but never reached | `Toaster` retains a just-removed entry for one more paint via a `useVisibleToasts` hook, rendered without `data-open="true"`, and drops it after `--dur-exit` + buffer | "Dismissable surfaces that exit a different way than they entered" is a named defect class; this one didn't exit at all. Sonner's own principle #5 (transitions, not keyframes, for rapidly-triggered UI) is why a fixed-delay unmount rather than a keyframe was used — consistent with `Drawer`'s existing "stay mounted to play the exit" idiom in `Primitives.jsx` |
| `.hds-profile__copy-btn` has hover/focus-visible, no `:active` | `:active { transform: scale(0.92) }` | Every pressable element needs feedback; 0.92 matches this codebase's own icon-button tier, not an invented value |
| `.toast__dismiss` has hover/focus-visible, no `:active`, and no `transform` in its transition list | `:active { transform: scale(0.92) }` + `transform var(--dur-press) var(--ease-out)` added to the base transition | Same feedback gap, same tier |
| `.hds-profile__details-link` has hover/focus-visible/`[aria-expanded]`, no `:active` | `:active { transform: scale(0.98) }` | Same feedback gap; pill/text-button tier, not the icon-button tier above |

No `transition: all`, no bare `ease-in`, no duration over 300ms, and no
ungated `:hover` transform was found anywhere in scope — the two earlier
passes were already disciplined about this. `.notice--result`'s hardcoded
`260ms` (`components.css:1571`, in scope as a `Notice` primitive) is a
deliberate, commented exception for a rare, once-per-submission entrance —
correctly placed at the "delight budget" frequency tier, not a token-drift
bug, left as-is.

## Section 5 — the eight collisions, resolved

1. **Press-scale values.** Not flattened. Rationalised as size-proportional:
   small square icon-only controls (`.icon-btn`, `.search__clear`,
   `.filter-tag button`, and now `.hds-profile__copy-btn`/`.toast__dismiss`)
   take the deepest scale, **0.92**, because their small absolute size means
   even a visible relative scale reads as a tiny, contained nudge. Boxed
   triggers (`.btn`, `.lang-switch`) sit at **0.97**. Inline text/pill
   controls that read as running text or a chip (`.nav__link`,
   `.drawer__link`, `.action-link`, `.source-pill`, `.tabs__tab`, and now
   `.hds-profile__details-link`) sit at **0.98** — a control this shape
   scaling as deep as an icon button would visibly wobble. Full-width,
   row-style list options (`.dropdown__option`, `.typeahead__option`) sit at
   **0.99**, and large card/tile surfaces (`.profile-card`, `.gov-card`) at
   **0.995** — the larger the hit area, the more a given relative scale moves
   it in absolute pixels, so the scale gets shallower as area grows. No
   outlier in the existing set broke this rule; the three new additions were
   placed by the same logic rather than picking a fifth number.
2. **Nav underline `scaleX(0)` at `@starting-style`.** Kept. This is the
   defensible exception the brief names: a 2px line drawing in from its own
   reading-start edge reads as the mark itself being drawn, not an object
   materialising from nothing — the "never `scale(0)`" rule is about objects
   (cards, panels, buttons) appearing out of thin air, not a directional
   line growing from a fixed anchor it's already attached to.
3. **Blur to mask transitions.** Not used anywhere in scope, and nothing
   here calls for it — no crossfade in scope looked "off" under its own
   easing/duration. Rule upheld by absence, not by removing anything.
4. **Tooltips.** Confirmed native `title` only across scope; no custom
   tooltip system was built or considered.
5. **Clip-path duplicated tab list.** Rejected — see Part 2.
6. **Gestures and drag.** Rejected — see Part 2.
7. **Springs.** Not used; CSS transitions and `@starting-style` only,
   consistent with "add no dependencies."
8. **Stagger.** The drawer link stagger (`layout.css:448`, 30ms steps,
   capped at the first four links per group) already satisfies all three
   rules asked for: it never delays usability (focus moves to the first
   focusable element immediately on open, not gated on the stagger
   finishing), it never plays on exit (no opacity transition outside
   `[data-open="true"]`), and it is never applied to a table or source list
   (only to `.drawer__link`). No change needed.

## Implemented

- `Toast.jsx`: `Toaster` now retains a dismissed toast for `--dur-exit` (140ms)
  + a 20ms buffer so its existing closed-state CSS actually plays before the
  node is removed, instead of vanishing on the same render as `dismiss()`.
  A toast whose stable id is re-triggered before its exit timer fires is
  filtered back out of the "closing" list immediately, so a fast
  dismiss-then-recopy never renders the same id twice.
- `PortfolioProfile.css`: added `.hds-profile__copy-btn:active` (scale 0.92)
  and `.hds-profile__details-link:active` (scale 0.98), each with `transform`
  added to the element's existing transition list.
- `components.css`: added `.toast__dismiss:active` (scale 0.92) and a
  transition list (previously had none) to `.toast__dismiss`.
- `docs/motion-vocabulary.md`: added rows for all four changes above, plus
  the toast entrance treatment that predates this pass but was never
  documented.

No reduced-motion or hover-gating changes were needed: all four additions
inherit the sitewide `prefers-reduced-motion` override (`base.css`, strips
`transform` from every transition list, keeps opacity/colour at 100ms) and
none of them are hover-only effects.
