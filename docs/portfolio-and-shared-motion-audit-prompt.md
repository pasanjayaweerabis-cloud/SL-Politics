# Motion audit and polish: Harsha de Silva portfolio and shared components

Copy-paste prompt for Claude Code. It uses `/find-animation-opportunities` to find
what's missing and `/emil-design-eng` to review what's already built and to set the
craft bar. There are two scopes and nothing outside them: **(A)** the Harsha de Silva
portfolio profile, and **(B)** the shared UI and shell that every page uses.

---

Work in this codebase: SL Politics (`javora-react`), React 19 + Vite, a statically
prerendered public-record site. Read `CLAUDE.md` first. Its invariants take priority
over anything in this prompt, including anything either skill recommends.

## 0. What this pass is (and isn't)

Two earlier passes have **already landed, uncommitted** in the working tree:

1. **Motion pass** (`docs/portfolio-and-shared-motion-prompt.md`): nav underline,
   press feedback, lang-switch label crossfade, drawer, portfolio Details row and hash
   landing, and so on.
2. **Visuals and toasts pass** (`docs/portfolio-and-shared-visuals-toasts-prompt.md`):
   `src/components/Toast.jsx` (in-house, Sonner-shaped), "Copy link" / "Copy
   citation" in `PortfolioProfile.jsx`, `public/og/*.png`, and `og:image` in `seo.ts`.

That's about 1,500 changed lines across ~14 files plus new files. **This pass audits
and polishes that work and finds the few real gaps left. It isn't a third build-out.**
Expect most candidates to be rejected. A short, high-conviction list is the goal.

## 1. Git safety: read this before running any git command

- There's **no git remote** and the work above is **uncommitted**. Never run
  `git stash`, `git reset`, `git checkout -- <file>`, `git clean` or anything that
  rewrites the working tree. Don't commit.
- For read-only inspection use **`git --no-optional-locks status`** and
  **`git --no-optional-locks diff`**, so a plain `git status` can't leave a stale
  `.git/index.lock` behind in a sandbox that can't delete it.
- Build on the existing diff. Don't revert or reformat lines you aren't deliberately
  changing.

## 2. Skills: how to use each one here

### `/find-animation-opportunities`: the search phase (read-only)

- Follow it exactly: recon → sweep the hunt list → run **every** candidate through
  its four-question gate (Frequency, Purpose, Speed, Function) → report in its
  **required 3-part format** (Opportunities table, Rejected candidates, Verdict).
- **Honour its hard rule: it never edits code.** Phase 2 below produces a report and
  nothing else.
- Cap: **at most 5 opportunities for (A) and 5 for (B)**, ordered by leverage.
- Ignore its closing hand-off to `improve-animations`. Phase 4 of this prompt is the
  hand-off.
- Its example values (`160ms`, `scale(0.97)`, `ease-out`) are defaults. In this repo,
  every "Suggested motion" cell must use **this repo's tokens** (section 4).

### `/emil-design-eng`: the review phase, then the craft bar for implementation

- **Invoke it with a concrete question**, for example *"Review the motion and
  interaction polish in these files against your principles"* plus the file list.
  If it's invoked bare, its "Initial Response" rule makes it reply with only a
  greeting, which stalls the run.
- Its **Review Format is mandatory**: one markdown table with `| Before | After | Why |`
  columns, one row per issue. No "Before:/After:" lists.
- During implementation, apply its component principles: responsive press states,
  never `scale(0)` for objects, origin-aware popovers (modals exempt), transitions
  over keyframes for anything re-triggerable, `@starting-style` entrances,
  asymmetric enter/exit, the opacity + height combination, cohesion across
  components, and slow-motion checks.
- Where its advice collides with this project, **the project wins**. The known
  collisions are listed in section 5.

## 3. Scope: hard boundary

### (A) Portfolio: editable

- `src/pages/PortfolioProfile.jsx`, `src/pages/PortfolioProfile.css`
- Tests beside them (e.g. `PortfolioProfile.copy.test.jsx`)

Routes to test: `/person/harsha-de-silva` (canonical) and `/politician/harsha-de-silva`
(retired alias, same component).

### (B) Shared: editable

- `src/components/Chrome.jsx`, `Tabs.jsx`, `Dropdown.jsx`, `SearchTypeahead.jsx`,
  `SearchField.jsx`, `Toast.jsx`
- `src/components/Primitives.jsx`: shared primitives only (Drawer, Avatar, badges, Chip,
  EvidencePill, Notice, EmptyState, ActionLink, Pagination, SearchBar, filter tags)
- `src/styles/tokens.css` (**extend only**), `base.css`, `layout.css`
- `src/styles/components.css`: shared-component selectors only (`.btn`, `.icon-btn`,
  `.nav*`, `.drawer*`, `.tabs*`, `.dropdown*`, `.typeahead*`, `.search*`, `.toast*`,
  badges, chips, pills, `.filter-tag`, `.empty-state`, `.pagination`, footer, skip-link)
- `docs/motion-vocabulary.md`: append rows and fix links on moved rows. Don't rewrite
  other rows.
- New: `docs/motion-audit.md` (the reports from phases 2 and 3)

### Read-only / do not touch

Page-specific code and styles (`HomePage`, `DirectoryPage`, `GovernmentPage`,
`CorrectionsPage`, `NotFoundPage`, `PersonPage.jsx` apart from reading
`PortfolioPersonPage`, `PersonDecisionPage`, `DecisionProfilePrototype.*`,
`profile-decision.css`, and the page-only sections of `components.css`), plus
`src/lib/router.tsx`, `src/lib/seo.ts`, `pageMeta.ts`, `src/data/**`, `src/i18n/**`,
`server/**`, `scripts/**`, `deploy/**`, `index.html`, and `public/**` (including the
new `og/` PNGs).

## 4. The motion tokens: suggestions and code use these, never raw values

From `src/styles/tokens.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--ease` | `cubic-bezier(0.32, 0.72, 0.29, 1)` | general: colour, chips, buttons |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | entrances and exits |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | the drawer only |
| `--dur` | 220ms | default |
| `--dur-press` | 120ms | press feedback |
| `--dur-fast` | 140ms | fast entrance/exit |
| `--dur-enter` | 200ms | entrance |
| `--dur-exit` | 140ms | exit (always shorter than enter) |

`--ease-in-out` was **deliberately removed** as unused (commit `ef466d1`). Reintroduce
it only for a real on-screen move that needs it, and say so in the report. No raw
`ms` or `cubic-bezier()` literals in component CSS.

## 5. Where the skills' defaults meet this project

Resolve each of these explicitly in the report. Don't silently pick one side.

1. **Press scale values aren't uniform today**: `.icon-btn` 0.92, `.search__clear`
   0.92, `.filter-tag button` 0.92, `.btn` 0.97, `.lang-switch` 0.97, links and tabs
   0.98, dropdown and typeahead options 0.99, `.profile-card` 0.995. Emil's cohesion
   principle says to review this. Smaller targets taking a deeper scale can be
   correct. **Rationalise it as a size-proportional rule and document it**, or fix
   genuine outliers. Don't flatten everything to 0.97.
2. **Nav underline starts at `scaleX(0)`** (`layout.css`, `.nav__link[aria-current="page"]::after`
   `@starting-style`). "Never `scale(0)`" is about objects appearing from nothing. A
   2px line drawing from its reading-start edge is the usual defensible exception.
   Decide, and write the reasoning either way.
3. **Blur to mask transitions**: don't use `filter: blur()` on dense record text or
   tables (paint cost and legibility). It's acceptable only on a tiny,
   non-text element, if at all.
4. **Tooltips with skip-delay**: the site uses native `title` attributes only. Don't
   build a custom tooltip system in this pass.
5. **clip-path duplicated tab list** for "perfect colour transitions": this duplicates
   tab labels in the DOM and the prerendered HTML, and needs `aria-hidden` handling on
   a manual-activation ARIA tab set. **Probably reject.**
6. **Gestures and drag** (momentum dismissal, rubber-banding, pointer capture): there's
   no drag UI. Swipe-to-close on the mobile drawer or on toasts would touch the
   Drawer focus trap and state machine. **Probably reject.** Any "yes" goes to
   the held-for-approval list.
7. **Springs**: no animation library is allowed (`CLAUDE.md`: add no dependencies).
   CSS and WAAPI only. A spring-like feel means a token curve, not a physics engine.
8. **Stagger**: already used for directory reveals (25ms) and possibly drawer links.
   Stagger must never delay usability, never apply on exit, and never apply to
   evidence tables or source lists.

## 6. Phases

### Phase 1: Recon (read-only)

- `git --no-optional-locks diff` on every in-scope file, plus `docs/motion-vocabulary.md`,
  `Toast.jsx`, and the toast rules in `components.css`.
- Build a **frequency map** of every interactive surface in scope (copy buttons,
  Details toggles, tier tabs, disclosure, source refs, nav links, lang switch, theme
  toggle, search, typeahead, dropdown, drawer, toasts, filter tags, pagination).

### Phase 2: `/find-animation-opportunities` (read-only)

Sweep its hunt list over scope (A) and (B), including the new work. Places to look
hard:

- **Toasts:** do they exit the same edge they entered, is exit faster than enter, and
  does stacking (max 3) shift the others with a bridge or a teleport? Is there a
  jarring change when the hover-pause timer resumes? And is a toast on a copy
  button redundant with any in-button "copied" state? Never confirm the same action twice.
- **Copy buttons:** is press feedback present and consistent with other small controls?
- **Teleporting state:** tier tab switch, Details row, `<details>` disclosure, the
  lang-switch remount, pagination "load more", and empty-state appearance in the
  typeahead.
- **Spatial story:** dropdown and typeahead origin, drawer, hash-landing highlight.
- **Feedback gaps:** any `onClick` element in scope without `:active`.

Hunt with `{open &&`, `hidden=`, `onClick`, `:active`, `@starting-style`, `details`,
`.map(`.

Write Part 1 / Part 2 / Part 3 to `docs/motion-audit.md`, then continue.

### Phase 3: `/emil-design-eng` review (read-only)

Review the **existing** motion and interaction polish in scope, meaning both earlier
passes' diffs and the pre-existing rules, against the skill. Append the mandatory
`| Before | After | Why |` table to `docs/motion-audit.md`, then the resolutions for
section 5's eight collisions.

Also check, specifically:

- `transition: all` anywhere
- keyframes on re-triggerable UI (toasts, toggles)
- `ease-in` on UI
- ungated `:hover` transforms
- missing `:focus-visible` parity
- durations over 300ms
- the opacity + height pairing on the Details row and disclosure
- whether reduced motion keeps opacity and colour feedback rather than removing all
  feedback

### Phase 4: Implement

- Implement the union of Phase 2 opportunities and Phase 3 rows, **deduplicated**
  (one change per element).
- **Build straight away:** fixes to defects (a skill "Never" violation, token drift,
  a missing reduced-motion or hover gate, inconsistent press feedback).
- **Hold for my approval:** anything that changes feel noticeably or adds a new
  behaviour (new stagger, new gesture, new entrance on something that doesn't
  animate today, changing the underline decision). Implement nothing for these.
  List them with exact values at the top of `docs/motion-audit.md` under
  **"Held for approval"**.
- Add or correct rows in `docs/motion-vocabulary.md` for everything you changed.

## 7. Project constraints: apply to every line

- **Prerendered, crawlability-gated.** No rule whose static default is
  `opacity: 0` / `visibility: hidden` / off-screen. Use `@starting-style`,
  self-terminating keyframes that end visible, or JS-applied state gated on
  `:root[data-hydrated]`.
- **TabPanel invariant:** panels and Details rows render their children and hide with
  `hidden`. Never switch to conditional rendering to get an exit animation.
- **Hydration:** `ThemeToggle` starts `dark=false`. Don't decide animation state during
  render from `matchMedia` or `localStorage`.
- **Reduced motion:** `base.css` strips `transform` from all transitions and clamps
  animation duration. Keyframe end states must be visible. `::details-content` and
  `::view-transition-*` need explicit opt-outs. The rule is "gentler, not zero".
- **Gating:** transform and box-shadow hovers go behind
  `@media (hover: hover) and (pointer: fine)`, with `:focus-visible` parity. Never
  animate focus rings.
- **Theme flip:** no colour transitions that double up with `.theme-switching`.
- `transform`, `opacity` and colour only. The sole `block-size` exception is
  `::details-content`, which must be flagged. **CLS stays 0.**
- **Tone:** a civic accountability record. Motion orients and confirms. It never
  dramatises "Conflicting" / "Not established" or makes an evidence tag look like a
  notification.
- No dependencies. `.jsx` stays `.jsx`. Relative imports keep explicit extensions.
  Write *why* comments in the existing voice.

## 8. Verification: all must pass

```bash
npm run lint
npm run typecheck
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # separate terminal, :5190; heed its stale-build warning
npm run validate:crawlability # hard gate, must stay 1623/1623
```

Then:

- In `dist/person/harsha-de-silva/index.html` and `dist/politician/harsha-de-silva/index.html`,
  confirm all tier panel and Details row text is present, no toast text is in the
  static HTML, and no new rule leaves content invisible without JS.
- On `serve:dist` (not `npm run dev`), check for no hydration warnings and no CSP
  violations in the console, on the portfolio page and on one ordinary `/person/<slug>`.

**Manual checklist for me** (give exact steps):

- Play every changed effect at 2–5× in the DevTools Animations panel (the emil
  slow-motion check).
- Reduced motion: nothing moves, and state changes are still legible.
- Keyboard only: tier tabs (manual activation), Details toggles, copy buttons,
  drawer, language dropdown, typeahead. None of these keyboard paths should gain
  new motion.
- 375px touch: no stuck hover, press feedback on small controls, toast clear of the
  safe area and drawer.
- Copy link 5× fast: one toast updates in place, no stack jump.
- Dark theme with a mid-page theme flip: no doubled transitions.
- Regression pass for shared changes on `/`, `/directory`, the government page,
  `/corrections`, a non-portfolio `/person/<slug>`, and a 404 URL.
- Look at it again the next day before approving the held items (emil's rule).

## 9. Deliverables

1. `docs/motion-audit.md`, containing:
   - "Held for approval" (top)
   - the Phase 2 report in the skill's 3-part format
   - the Phase 3 Before/After/Why table
   - the section 5 resolutions
   - one line per item on what was implemented
2. The code edits, limited to section 3's files.
3. Updated `docs/motion-vocabulary.md`.
4. A short final message covering: counts (found / rejected / implemented / held),
   the single highest-leverage change, and anything whose feel can't be judged from
   code.

## 10. Rules of engagement

- Don't give me options. Make the call and give one line of reasoning.
- "This shouldn't animate" is a valid and often correct answer. Ship nothing for it.
- Don't ask questions before starting. Run all phases, then report.
- Don't commit. Leave the diff for me to review.
