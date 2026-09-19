# Motion pass: Harsha de Silva portfolio and shared components

Copy-paste prompt for Claude Code. There are two scopes and nothing outside them:
**(A)** the Harsha de Silva portfolio profile, and **(B)** the shared UI that every
page uses. No other page gets its own motion.

---

Add and refine motion in this codebase (SL Politics, `javora-react`, React 19 + Vite,
prerendered static site). Read `CLAUDE.md` first. Its invariants take priority over
anything in this prompt.

## 0. Skills: load these in this order

1. **`/animation-vocabulary`**: before you build anything, name each effect with its
   exact glossary term (Pop in, Stagger, Crossfade, Origin-aware animation, and so on).
   Also check `docs/motion-vocabulary.md`, which lists the motion that already
   ships. If an effect has no name in either place, you're probably inventing a new
   way to fade something in. Don't.
2. **`/animate`**: this is the construction skill, and all implementation goes
   through it. Follow its full build sequence for every candidate: gate, purpose,
   cheapest tool, properties, easing/duration, interruption/exit, then reduced
   motion and pointer gating. Obey its "Never Ship" table. If its `RECIPES.md` is
   missing from your install, carry on with SKILL.md alone rather than blocking.
3. **`/animate-expo`**: **don't use it for implementation.** It targets React
   Native/Expo (Reanimated, Gesture Handler), and this is a browser app with no RN
   code. Use it for one thing only: the mobile-web check at 375px. It's a reminder
   that touch has no hover, so any affordance you put on `:hover` needs a press or
   static equivalent on touch, and press feedback must still work there. Don't
   import or install anything it mentions.

## 1. Before editing

- Run `git status`. `src/pages/PortfolioProfile.jsx`, `PortfolioProfile.css` and
  `src/data/harshaDeSilva.ts` have **uncommitted WIP** from the portfolio
  restructure. Build on top of it. Don't revert, reformat or "clean up" unrelated
  lines, and don't commit. There's no git remote, so a lost diff is gone for good.
- **Inventory the existing motion first.** A previous animation pass already
  landed (commits `aa02bc3`…`11eb2d6`, sections 1–8). These already exist, so don't
  rebuild them:
  - tab panel opacity crossfade via `@starting-style` (`components.css`, `[role="tabpanel"]`)
  - `.tabs__tab:active` press scale
  - drawer slide + scrim fade + interruptible exit state machine (`Primitives.jsx` `Drawer`)
  - dropdown / typeahead origin-aware open and close, with `--dur-exit` on close
  - theme toggle glyph crossfade + rotate, and the sitewide `.theme-switching` colour flip
  - result reveal stagger (`--reveal-index`, 25ms)
  - route View Transition (160ms crossfade, skipped for `/directory` and under reduced motion)
  - portfolio: `.hds-profile__disclosure::details-content` block-size expand,
    `:target` source highlight, source-link icon nudge, and desktop-only table row tint

  Your job is the gaps and the inconsistencies, not a second copy of these.

## 2. Scope: hard boundary

### (A) Portfolio: editable

- `src/pages/PortfolioProfile.jsx`
- `src/pages/PortfolioProfile.css`

Routes to test: `/person/harsha-de-silva` (canonical) and
`/politician/harsha-de-silva` (retired alias that renders the same component).

### (B) Shared: editable

- `src/components/Chrome.jsx` (nav, `ThemeToggle`, `LanguageSwitcher`, `Footer`)
- `src/components/Tabs.jsx`, `Dropdown.jsx`, `SearchTypeahead.jsx`, `SearchField.jsx`
- `src/components/Primitives.jsx`: shared primitives only (Drawer, Avatar, badges,
  Chip, EvidencePill, Notice, ActionLink, Pagination, SearchBar, and similar)
- `src/styles/tokens.css`: **extend only**. Add a token only when no existing one fits.
- `src/styles/base.css`, `src/styles/layout.css`
- `src/styles/components.css`: **only** the selectors for the shared components above
  (`.btn`, `.icon-btn`, `.nav*`, `.drawer*`, `.tabs*`, dropdown, typeahead, search,
  badges, chips, pills, notices, footer, skip-link)
- `docs/motion-vocabulary.md`: append rows, and fix the file:line links on rows whose
  lines you moved. Don't rewrite other rows.

### Read-only / do not touch

- Page-specific code and styles: `HomePage`, `DirectoryPage`, `GovernmentPage`,
  `CorrectionsPage`, `NotFoundPage`, `PersonPage.jsx` (other than reading
  `PortfolioPersonPage`), `PersonDecisionPage`, `DecisionProfilePrototype.*`,
  `profile-decision.css`, and the page-only sections of `components.css`
  (`.profile-grid`, `.gov-card`, `.principle`, directory/filter layout, and so on).
- `src/lib/router.tsx`: read-only. If you believe the route transition must change,
  put that in the report. Don't edit it.
- `src/data/**`, `src/i18n/**`, `server/**`, `scripts/**`, `index.html` (its inline
  theme script's sha256 is baked into the CSP).

Shared changes **will** show up on every page. That's intended, and it's why you
verify them on the other pages (section 7).

## 3. Project constraints you must respect

- **No dependencies.** No framer-motion, Motion, GSAP or anything else. CSS first
  (transitions, `@starting-style`, `::details-content`, `interpolate-size`), then
  WAAPI or `IntersectionObserver` in plain React if JS is really required.
- **Prerendered, crawlability-gated.** Never ship a rule whose default static state
  is `opacity: 0`, `visibility: hidden` or off-screen. Entrances must use
  `@starting-style`, a self-terminating keyframe that ends visible, or a hidden state
  applied from JS after mount. Gate JS-dependent motion on `:root[data-hydrated]`,
  as the tab panel already does.
- **The TabPanel invariant.** Every panel and every Details row renders its children
  and hides with `hidden`. Never switch to conditional rendering to make an exit
  animation easier.
- **Hydration.** `ThemeToggle` starts `dark=false`. Don't read `matchMedia` or
  `localStorage` during render to decide an animation's state.
- **Tokens only** (`tokens.css`): `--ease`, `--ease-out`, `--ease-drawer`, `--dur`
  (220ms), `--dur-press` (120ms), `--dur-fast` (140ms), `--dur-enter` (200ms),
  `--dur-exit` (140ms, always shorter than enter). No raw `ms` values or
  `cubic-bezier()` literals in component CSS.
- **Global reduced-motion override** (`base.css`) strips `transform` from all
  transitions and clamps animation duration to ~0. Consequences: keyframe end states
  must be the visible state, and pseudo-elements it can't reach
  (`::details-content`, `::view-transition-*`) need explicit opt-outs.
- **Hover gating.** Any `transform` or `box-shadow` hover goes behind
  `@media (hover: hover) and (pointer: fine)`. Every hover effect also fires on
  `:focus-visible`. Never animate focus rings.
- **Theme flip.** Don't add `background-color`/`color` transitions that double up
  with `.theme-switching`.
- **CLS stays 0.** Use `transform`, `opacity` and colour channels only. The one
  sanctioned exception is `block-size` on `::details-content`, and you must flag it
  if you use it.
- **Tone.** This is a civic accountability record ("Not established",
  "Conflicting"). Motion orients and confirms. It must never dramatise a finding
  or make an evidence tag look like a notification.
- `.jsx` stays `.jsx`. Relative imports keep explicit extensions. Write comments in
  the codebase's existing *why* voice.

## 4. The gate: apply per candidate before writing code

For each candidate, state the frequency tier (100+/day → none; tens/day → under 150ms
or nothing; occasional → standard; rare → delight budget), the one-word purpose, and
the vocabulary term. **Keyboard-initiated actions don't animate.** A candidate that
fails ships zero lines, and you say so.

## 5. Candidates: my read, argue with it

### (A) Portfolio

Likely yes:

1. **Intervention "Details" row reveal** (`.hds-profile__details-link` →
   `.hds-profile__details-row`, toggled via `hidden`). Opacity-only fade-in with
   `@starting-style` on the row's content when `hidden` is removed. No height
   animation on a table row. Must be interruptible on a double-click. Purpose: state
   indication.
2. **Details link affordance.** If the link carries (or should carry) a chevron, a
   rotation keyed to `[aria-expanded="true"]`, timed with the row reveal
   (`--dur-fast`). Purpose: state indication.
3. **Hash-navigation landing.** `useHashNavigation` switches tier tab, expands a row
   and calls `scrollIntoView`. Extend the existing `:target` source highlight idea so
   the landed element (intervention row, indicator) gets the same brief
   background/border confirmation. Reuse the source-highlight rule's values. Purpose:
   spatial consistency.
4. **Tier tab label colours** (`.hds-profile__tab-eyebrow` / `__tab-label`). Check
   that they transition in step with `.tabs__tab`'s own colour transition rather
   than snapping. Purpose: feedback.

Probably no, so reject unless you can make a real argument:

- Sliding "active pill" between tier tabs (the boxed tab style needs measurement JS
  or anchor positioning, and the panel crossfade already covers the change).
- Count-up on glance-strip figures, hero/portrait fade-in, parallax, scroll-linked
  section reveals, and staggered table rows or source lists (they fight prerender
  and make evidence feel like a landing page).
- Any motion on `.hds-profile__status-tag` / evidence tags beyond hover/focus.

### (B) Shared

Likely yes:

1. **Consistency audit.** Every interactive shared element (`.btn`, `.icon-btn`,
   `.nav__link`, `.drawer__link`, `.lang-switch` trigger, chips/pills that are links,
   `ActionLink`, `Pagination` button, footer links) should have the same press
   feedback (`--dur-press`, `scale(0.97–0.98)`), gated hover, and focus-visible
   parity. Fix gaps and name every exception with a reason. Purpose: feedback.
2. **`.nav__link[aria-current="page"]::after` indicator.** If it currently snaps,
   an origin-aware `scaleX` in on route change (`transform-origin` at the reading
   start, and flip it for RTL if applicable). It must not play under reduced motion.
   Purpose: state indication.
3. **Drawer contents.** A short stagger (30–80ms, capped at ~4 items) on
   `.drawer__link` entrance, riding the existing drawer open, with **no stagger on
   close**. The exit must stay faster than the enter. Only if it doesn't delay the
   drawer being usable. Purpose: spatial consistency.
4. **Language switch.** When `lang` changes, check that the swapped UI text doesn't
   jump. A `--dur-fast` opacity crossfade on the trigger label is the ceiling.
   Purpose: preventing a jarring change.

Probably no:

- Typeahead option highlight moving on arrow keys (keyboard-initiated).
- Skip-link slide-in (keyboard, and it must appear instantly).
- Notice / EmptyState / Avatar entrances, badge pulses, and anything on
  `VerifiedBadge`.
- Changes to the route View Transition (report-only, see scope).

## 6. Deliverables

1. The edits, limited to the files in section 2.
2. `docs/motion-vocabulary.md`: new rows in the existing format (effect / where with
   file:line link / duration / easing), plus corrected links for moved rows.
3. **Report**, one row per candidate: vocabulary term → tier → purpose →
   verdict (built / rejected) → ingredients (tool, properties, token curve,
   token duration) or rejection reason. Add a "feel-check" list for anything whose
   feel can't be judged from code. No padding.

## 7. Verification: all must pass

```bash
npm run lint
npm run typecheck
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # separate terminal, port 5190; heed its stale-build warning
npm run validate:crawlability # hard gate, must stay 1623/1623
```

Then:

- Grep `dist/person/harsha-de-silva/index.html` and confirm every tier panel's text and
  every Details row's text is present in the static HTML, and that no new rule leaves
  content at `opacity: 0` without JS.
- Judge first paint and hydration on `serve:dist`, **not** `npm run dev` (dev injects
  CSS through JS and prerenders nothing). Use `npm run dev` only while iterating.
- Check the browser console for hydration warnings on the portfolio page and one
  ordinary `/person/<slug>` page.

**Manual checklist for me** (list the exact steps in your report):

- Reduced motion on: no transform motion anywhere, expand/collapse still works, nothing blank.
- Keyboard only: tab strip (manual activation), Details toggles, drawer, language dropdown, typeahead.
- 375px touch emulation: no stuck hover, press feedback present, drawer stagger feels quick.
- Dark theme + theme flip mid-page: no doubled colour transitions.
- Click a hash link that lands in a different tier tab and inside a collapsed Details row.
- Shared-change regression pass on `/`, `/directory`, the government page, `/corrections`,
  a non-portfolio `/person/<slug>`, and a 404 URL.
- Play any new effect at 2–5× duration in the DevTools Animations panel.

## 8. Rules of engagement

- Don't give me options. Make the call, give one line of reasoning, and write the code.
- If the honest answer is "this shouldn't animate", say so and ship nothing for it.
- Don't ask questions before starting. Work through everything, then report.
- Don't commit. Leave the diff for me to review.
