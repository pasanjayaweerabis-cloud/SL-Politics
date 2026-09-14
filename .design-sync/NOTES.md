# design-sync notes — javora-react

## Repo shape

This repo is the Javora/SL Politics **application**, not a published component
library — `package.json` has no `main`/`module`/`exports`, and
`src/components/*.jsx` are plain JSX (no `.d.ts`). The sync uses the
package shape's synth-entry fallback:

- `entry`: `.design-sync/entry.mjs` — a hand-written barrel re-exporting
  `src/components/{Primitives,Chrome,SearchTypeahead,Tabs}.jsx`. Needed
  because there's no dist to bundle from, and because pointing `--entry`
  directly at the entry file is what makes `PKG_DIR` resolve to the repo
  root without requiring `node_modules/javora-react` to exist.
- `componentSrcMap` pins all 29 exported components to their real source
  file explicitly (rather than relying on fuzzy filename matching), since
  multiple components live in the same file (`Primitives.jsx`).
- `--node-modules` must point at the repo's own `node_modules` (where React
  actually resolves) — NOT a parent directory. This works together with
  `entry` overriding `PKG_DIR` resolution; the two used to conflict before
  `entry` was added (`PKG_DIR` was previously derived from `--node-modules`
  + `pkg`, which doesn't exist for a self-referencing app repo).
- **`cssEntry`**: the app's real stylesheet is split into
  `src/styles/{tokens,base,layout,components}.css` (moved here from
  `public/assets/css/` in the restructuring pass — same four files, now
  under Vite's module graph instead of copied verbatim into every build),
  `@import`ed by `src/styles/index.css` via **relative** `./...` URLs.
  `cssEntry` appends its target's content **verbatim** (no `@import`
  resolution), so pointing it at `src/styles/index.css` would ship dead
  relative-path imports. Fixed by concatenating the four real files into
  `.design-sync/aggregate-styles.css` (gitignored, regenerated — see
  .gitignore) and pointing `cssEntry` there. Re-run this concatenation if any
  of the four source files change:
  ```
  cat src/styles/tokens.css src/styles/base.css src/styles/layout.css src/styles/components.css > .design-sync/aggregate-styles.css
  ```
  (`tokensPkg`/`tokensGlob` weren't used — they resolve via
  `--node-modules` too, which the entry-override split from `PKG_DIR`.)

## Known render warns

- `Drawer` `Open`: `[RENDER_THIN]` — DOM content present but rendered
  height reads 0px. Benign: `Drawer`'s panel is `position: fixed`, so the
  measured mount root (a plain wrapper `div`) collapses to zero height by
  design. Confirmed via `_screenshots/general__Drawer.png` — renders
  correctly (right-side slide-in panel, "SL Politics" + nav links, correct
  styling).

## Environment quirk: React mount lands ~1s after `networkidle`

This sandbox's headless Chromium defers React 19's initial commit by
roughly a second past Playwright's `networkidle` (measured directly:
mount-root `<div>`s exist immediately but stay empty until ~1s later,
consistent with background-tab timer/scheduler throttling under this
harness). Before a fix, this made `package-validate.mjs`'s render check
and `package-capture.mjs`'s per-story capture read every single preview as
`root empty` / mid-CSS-transition, even though every component actually
renders correctly.

**Fixed by patching the local staged copies** (`.ds-sync/package-validate.mjs`
and `.ds-sync/package-capture.mjs`'s `settle()`): both now
`page.waitForFunction` for actual mounted content (bounded 3s timeout,
non-fatal) before reading the DOM, and `settle()` adds a fixed 350ms after
that for this repo's ~220ms CSS enter animations (e.g. `Drawer`'s
slide-in) to finish.

**This fix lives only in the gitignored `.ds-sync/` staging copy** — the
`cp -r` from the bundled skill on every re-sync will overwrite it. If a
re-sync on this same environment shows every preview failing
`[RENDER]`/`root empty` again despite the components looking fine when
opened manually, re-apply this same patch (search
`package.goto` + `networkidle` in both files) before assuming the previews
regressed. Not yet confirmed whether this is specific to this sandboxed
Windows environment or a broader Playwright/Chromium behavior — worth
retesting on a fresh machine before assuming it's needed there too.

## Source bug found and fixed (not design-sync-specific)

The initial build hard-failed with a browser-side `SyntaxError: Invalid
regular expression: ... Range out of order in character class`, which
aborted the whole bundle (`window.Javora` never got populated — every
component failed `[BUNDLE_EXPORT]`). Root cause: several files used a
**literal, unescaped** Unicode character range in a diacritics-stripping
regex (`/[̀-ͯ]/g`, actual U+0300–U+036F characters typed directly) instead
of the `̀`–`ͯ` escape form already used in `src/lib/identity.ts`.
`.ds-sync`'s local static file server (`http-serve.mjs`) serves `.js`
without a `charset=utf-8` header, so Chromium fell back to interpreting
those raw UTF-8 bytes as Windows-1252, corrupting them into an out-of-order
range and throwing at parse time.

Fixed at the source (semantically identical, just the safer
representation) in:
`src/data/adapters/{cabinetDataset,parliamentDataset,pastMembersDataset}.ts`,
`src/sync/importRun.ts`,
`server/fetchers/{cabinetConnector,parliamentConnector}.ts`,
`scripts/promote-detail.mjs`.

This was a real latent fragility in the app's own source (any server that
skips a charset header on `.js` could hit the same bug in production),
not just a design-sync artifact — worth keeping the escaped form going
forward.

## Preview scope

User chose "core components only" for rich authoring, but given the above
render-check bug made the floor-card fallback trip on nearly every
component in this repo (untyped JS + complex nested `PersonView` props
means the auto-generated crash-prevention defaults can't populate
anything meaningful), **all 29 components ended up authored** with
realistic multi-export previews backed by shared mock data
(`.design-sync/previews/_mocks.ts` — a `PersonView`-shaped fixture set:
a sitting president, a cabinet minister, a former president). None are on
the floor card.

## Re-sync risks

- The `.design-sync/previews/*.tsx` files import real domain shapes from
  `src/types/models.ts` (`Person`, `Position`, `PersonView` from
  `src/services/repository.ts`) by hand (not by type-checked import — this
  repo's converter path doesn't type-check previews). If those shapes
  change, the previews won't fail to compile; they'll just silently stop
  matching the real API. Worth a periodic manual diff against
  `PersonView` in `src/services/repository.ts`.
- `aggregate-styles.css` is a **generated, gitignored snapshot** of the four
  `src/styles/*.css` files at sync time — it will silently go stale
  if those files change without re-running the `cat` command above.
- The mount-timing patch above is local-only and will need reapplying on
  every fresh `cp -r` of the skill scripts (every sync run, per the base
  skill's step 7) if this environment's timing behavior persists.
