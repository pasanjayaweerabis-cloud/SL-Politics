# Visual assets and toast feedback: Harsha de Silva portfolio and shared components

Copy-paste prompt for Claude Code. There are two scopes and nothing outside them:
**(A)** the Harsha de Silva portfolio profile, and **(B)** the shared UI and shell
that every page uses. No other page is changed.

---

## ⚙️ Decision switch: edit before pasting

```
ALLOW_SONNER_DEPENDENCY: NO
```

`CLAUDE.md` says **"Add no dependencies."** While this line reads `NO`, you must
**not** install `sonner`. Use `/ask-sonner` as the behavioural spec and build a small
in-house toast instead (section 4, path N). Only if I have changed this line to `YES`
may you take path Y. Don't change it yourself, and don't treat anything else in this
prompt as permission.

---

Work in this codebase: SL Politics (`javora-react`), React 19 + Vite, a statically
prerendered public-record site. Read `CLAUDE.md` first. Its invariants take priority
over anything in this prompt.

## 0. Skills: load these in this order

1. **`/canvas-design`**: for **static raster assets only** (PNG). It writes a design
   philosophy `.md` and then expresses it as a `.png` or `.pdf`. It doesn't write
   React or CSS. In this project it is used for exactly the assets in section 3,
   nothing decorative beyond that.
2. **`/ask-sonner`**: the reference for toast behaviour: one Toaster mounted once, a
   plain `toast()` function called from event handlers, stable `id`s to prevent
   duplicates, `duration`, dismissal, theme that follows the site rather than
   defaulting to light, and styling via the headless route. With the switch at `NO`,
   it's a spec to imitate, not a package to install.

## 1. Before editing

- Run `git status`. `src/pages/PortfolioProfile.jsx`, `PortfolioProfile.css` and
  `src/data/harshaDeSilva.ts` hold **uncommitted WIP**. Build on top of it. Don't
  revert, reformat or tidy unrelated lines, and **don't commit**. There's no git
  remote.
- Facts I checked, so you don't have to rediscover them:
  - **There's no toast system and no clipboard code anywhere in `src/`.** Live
    feedback today is `role="status"` / `aria-live="polite"` text (directory results
    count, pagination, typeahead empty state, the corrections result).
  - **There's no `og:image` and no `twitter:image`.** `src/lib/seo.ts` emits
    `og:title/description/type/url/site_name` in two places, the client
    `upsertMeta` calls and the prerender string builder, and sets
    `twitter:card` to `summary`.
  - **The CSP has no `'unsafe-inline'` for styles** (`style-src 'self'`, removed in
    commit `fa7ae11`). `img-src 'self' data:` plus the portrait origin. See
    `scripts/prerender.mjs` (~line 266) and `deploy/security-headers.conf`.
  - `public/wallpaper1.png` (1.9 MB, on the LCP path) is a **documented deliberate
    trade-off** in `CLAUDE.md`. Don't replace or "optimise" it in this task.
  - Translations fall back to English, then to the key (`src/lib/i18n.jsx`), so a
    missing `si`/`ta` string never blanks a label.

## 2. Scope: hard boundary

### (A) Portfolio: editable

- `src/pages/PortfolioProfile.jsx`, `src/pages/PortfolioProfile.css`
- New image files under `public/og/` for this profile only (section 3)

Routes: `/person/harsha-de-silva` (canonical) and `/politician/harsha-de-silva`
(retired alias that renders the same component and declares the canonical URL).

### (B) Shared: editable

- `src/components/Primitives.jsx`, or a new `src/components/Toast.jsx`, for the toast primitive
- `src/App.jsx`: **only** to mount the single toaster next to `<Layout>`
- `src/styles/components.css` (toast selectors only), `src/styles/tokens.css` (extend only)
- `src/lib/seo.ts`: **only** to add `og:image`, `og:image:alt`, `og:image:width/height`
  and to switch `twitter:card` to `summary_large_image` when an image exists, in
  **both** the client and the prerender code paths
- `src/i18n/en.js`, `si.js`, `ta.js`: **append** new keys only
- New files under `public/og/` for the sitewide default share card
- `docs/design/`: the canvas-design philosophy `.md` files
- Tests next to anything you add

### Read-only / do not touch

Every other page (`HomePage`, `DirectoryPage`, `GovernmentPage`, `CorrectionsPage`,
`NotFoundPage`, `PersonDecisionPage`, `DecisionProfilePrototype.*`), `router.tsx`,
`routeManifest.ts`, `src/data/**` (the WIP in `harshaDeSilva.ts` stays as it is),
`server/**`, `scripts/**`, `deploy/**`, `index.html` (its theme script's sha256 is in
the CSP), and every existing image in `public/`.

## 3. `/canvas-design`: which assets, and the rules they must follow

### Build

1. **Sitewide default share card**: `public/og/default.png`, 1200×630. The SL Politics
   lion mark, the wordmark and one short line of the existing footer tagline
   (`en.js` → `copyright`). It's used by every route that has no specific card.
2. **Harsha de Silva share card**: `public/og/harsha-de-silva.png`, 1200×630. It uses
   the same visual system as the default card, with the person's name and the
   profile's focus-role label taken **verbatim** from `harshaDeSilva.ts` plus the
   site mark. Wire it only for the two routes above.

For both cards, save the philosophy as `docs/design/share-card-philosophy.md`, then
render. Keep the source script you used (Python/PIL or similar) in your report, not
in the repo, unless it's under `docs/design/`.

### Rules for these assets

- **Never depict the person.** Don't illustrate, stylise or trace Harsha de Silva or
  anyone else, and **don't composite `public/portraits/harsha-de-silva.png` or any
  parliament.lk portrait** into a new image. `src/data/portraitPolicy.ts` records
  those portraits as all-rights-reserved and displayed for identification only. A
  derived marketing image is exactly the redistribution it rules out.
- **Politically neutral.** No party colours used as identity, no party symbols, no
  flags, and no imagery implying endorsement or opposition. The palette comes from
  `tokens.css`, the site's own identity.
- **No facts on the image beyond name and role label.** No figures, evidence
  statuses, dates, scores or evaluative words. An image can't carry a citation, isn't
  crawlable text, and goes stale silently. Anything else belongs in the HTML.
- **Typography matches the site.** Use IBM Plex Sans and Source Serif 4 (the
  `.woff2` files in `public/fonts/`, which you can convert for PIL) rather than the
  skill's bundled display fonts, unless you can argue a bundled OFL face fits better.
- **The skill's "90% visual" instinct is tuned down here.** This is a civic record,
  and the card should read as a calm, credible masthead, not a poster. Restraint is
  the craft.
- Check legibility at 600×315 (half size, which is how most feeds show it) and keep
  a safe margin of at least 60px, since platforms crop.
- Size budget: **≤ 300 KB each** (quantise or use PNG-8 if needed). They aren't on
  the LCP path, but they are fetched by every share.
- Text in the image must match the page. If the profile's name or role label
  changes, the card is wrong. Say so in a short comment next to where the image is
  referenced.

### Probably no, so reject unless you can make a real argument

- Hero backgrounds, textures or section illustrations on the portfolio page (weight,
  CLS risk, and it dramatises a record).
- Illustrations for `EmptyState`, `Notice` or the 404 page (404 is out of scope anyway).
- Anything that replaces or edits existing logos, portraits or the wallpaper.

### Wiring `og:image`

- Use an absolute URL built from the same origin `seo.ts` already uses for canonicals
  (the build requires `VITE_SITE_ORIGIN`). Never hard-code `localhost` or `javora.lk`.
- Emit identical tags from the client path and the prerender path. Extend any
  existing `seo.test.ts` / `pageMeta.test.ts` assertions so both paths are pinned,
  and check that `stripShellMeta()` (`scripts/shellMeta.mjs`, list
  `DUPLICATED_BY_PAGE_META`) doesn't duplicate or drop the new tags. If that list
  needs `og:image` / `twitter:image`, report it rather than editing, since
  `scripts/**` is read-only.
- `og:image:alt` is a plain description of the card ("SL Politics — Harsha de
  Silva, public record"), not marketing copy.

## 4. Toast feedback, following `/ask-sonner`

### The gate: only where nothing on screen already confirms the action

A toast is justified only when an action has **no other visible result**. If the page
already changes (theme flips, language changes, tab switches, a filter updates a
count, a Details row opens), no toast. **Never** use a toast for:

- **the corrections form**, which is out of scope, and `CLAUDE.md` forbids optimistic
  "received" messaging
- evidence or verification statuses ("Conflicting", "Not established"). Those are
  record content, not notifications.
- errors the reader must act on, which belong inline next to the control.
- anything on page load.

### Candidates: my read, argue with it

Likely yes, and both are new, small affordances:

1. **(A) "Copy link" on each numbered source record and each section heading** in the
   portfolio. It copies `canonical URL + #hash` (using the existing ids and hash
   navigation, so a copied link to a record inside a non-default tier tab still
   lands correctly). Toast: "Link copied". Purpose: feedback for an otherwise
   invisible clipboard write.
2. **(A) "Copy citation" on each source record.** It builds a plain-text citation
   only from fields that entry actually has in `harshaDeSilva.ts`'s `sources` array
   (today: `organization`, `title`, `type`, `href`; there's **no date field**, so
   don't add an "accessed on" or publication date). **Never fill a missing field
   with a guess.** Omit it. Toast: "Citation copied".

Both need a clipboard **failure path**: `navigator.clipboard` is unavailable on
non-secure origins and can be denied. On failure, show an error toast that tells the
reader how to copy manually (select the revealed text). Never claim success. The
button must be a real `<button>` with an accessible name that includes *which*
record it copies.

Probably no:

- Toasts for theme, language, tab or filter changes (they're already visible).
- A "Share" toast with `navigator.share` (native UI already confirms it).
- Anything on other pages.

### Path N (switch = `NO`): in-house toast modelled on Sonner

- **API shape copied from Sonner**, so moving later is mechanical: `toast(message, { id, description, duration })`,
  `toast.success`, `toast.error`, `toast.dismiss(id?)`, and one `<Toaster />`.
  Implement it as a tiny module-level store read with `useSyncExternalStore`. No
  context provider, no dependency.
- **Mounted once**, in `App.jsx` beside `<Layout>`, never per page. It renders
  nothing on the server and in the prerendered HTML: an empty live region at most,
  with no text and no layout.
- **Accessibility:** a persistent `role="status"` / `aria-live="polite"` region that
  exists before the first toast (a region created at the same moment as its text
  isn't reliably announced). Errors use `role="alert"`. Keyboard focus is never
  moved to a toast.
- **Behaviour from `/ask-sonner`:** stable `id` means an update, not a duplicate.
  Default duration ~4s. The timer pauses on hover and focus-within. A dismiss button
  has an accessible name. At most 3 visible. Clicking "Copy link" twice updates the
  one toast.
- **StrictMode safety:** call `toast()` from event handlers only, never effects (the
  skill's double-toast cause).
- **Styling:** plain CSS in `components.css` using `tokens.css` colours, radius and
  shadow. It follows `data-theme` dark/light automatically. **No inline `<style>`
  injection** (the CSP blocks it). Position is bottom-centre on mobile (respect
  `env(safe-area-inset-bottom)`) and bottom-right on desktop, clear of the drawer and
  typeahead. The toast must not sit under the nav drawer's scrim or be clipped by a
  transformed ancestor (the skill's stacking-context trap), so render it at the root.
- **Motion:** reuse existing tokens only (`--ease-out`, `--dur-enter` in and
  `--dur-exit` out, exit faster than enter). Use transitions, not keyframes, so rapid
  repeats retarget. Entrance via `@starting-style` from `translateY(8px)` plus
  `opacity: 0`. Under `prefers-reduced-motion: reduce`, opacity only (the global rule
  in `base.css` already strips transforms, so verify rather than duplicate).
- **i18n:** add `toast.linkCopied`, `toast.citationCopied`, `toast.copyFailed`,
  `toast.dismiss` and the button labels to `en.js`. Add `si.js`/`ta.js` entries **only
  if you're confident in the translation**. Otherwise leave them out, rely on the
  English fallback, and list the missing keys in your report for a human translator.
  Don't machine-guess political-site copy.

### Path Y (switch = `YES` only): real Sonner

Everything in path N's gate, a11y, i18n and placement still applies. In addition:

- `npm install sonner --save-exact`. Report the version and add it to the dependency
  count in `CLAUDE.md` (the "All 16 current dependencies are used" line) with a
  one-line justification.
- **CSP:** Sonner injects its stylesheet at runtime by default, which `style-src
  'self'` will block. Check this against the installed package source, not memory.
  Fix it the way `/ask-sonner`'s troubleshooting table describes: import
  `sonner/dist/styles.css` through Vite so it ships as a self-hosted CSS file, then
  confirm on `serve:dist` that no CSP violation appears in the console and the toasts
  are styled.
- Style via the **headless route** (`toast.custom`) wrapped in a local `toast()`
  helper that uses site tokens. Don't pile `!important` onto default classes.
- `theme` defaults to light: pass the site's resolved theme. It must not break the
  hydration invariant that `ThemeToggle` starts `dark=false`, so read the theme after
  mount.
- Mount `<Toaster />` once in `App.jsx`, and confirm it renders nothing into the
  prerendered HTML.

## 5. Constraints that apply to everything

- No new rule may leave prerendered content at `opacity: 0` / `hidden`. Toast
  buttons must work after hydration and must not appear in the static HTML as broken
  controls. Either render them only after hydration (gate on
  `:root[data-hydrated]`) or make sure they degrade to a visible, copyable URL.
- `.jsx` stays `.jsx`. Relative imports keep explicit extensions. Write comments in
  the codebase's *why* voice.
- Hover effects are gated behind `@media (hover: hover) and (pointer: fine)` with
  `:focus-visible` parity. CLS stays 0.

## 6. Deliverables

1. The edits, limited to section 2's files, plus `public/og/default.png`,
   `public/og/harsha-de-silva.png` and `docs/design/share-card-philosophy.md`.
2. **Report**, one row per candidate (assets and toasts): verdict (built/rejected),
   purpose, and the reason in one line. Include the switch value you saw, which path
   you took, the file sizes of both PNGs, and any untranslated `si`/`ta` keys.
3. Tests: the toast store (id dedupe, dismiss, max visible), the clipboard failure
   path (mock `navigator.clipboard` rejecting), the citation builder never inventing
   missing fields, and `og:image` tags present and identical in the client and
   prerender outputs.

## 7. Verification: all must pass

```bash
npm run lint
npm run typecheck
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # separate terminal, :5190; heed its stale-build warning
npm run validate:crawlability # hard gate, must stay 1623/1623
```

Then:

- In `dist/person/harsha-de-silva/index.html`: exactly one `og:image` pointing at
  `https://javora.lk/og/harsha-de-silva.png`, `twitter:card` =
  `summary_large_image`, no duplicated meta, and no toast text in the static
  markup. Check `dist/politician/harsha-de-silva/index.html` too. A non-portfolio
  profile and `/` should show `og/default.png`.
- Open both PNGs yourself and look at them at full and half size before reporting.
- On `serve:dist` (not `npm run dev`), check that there's no CSP violation or
  hydration warning in the console.

**Manual checklist for me** (give exact steps):

- Copy link on a source record in a non-default tier tab, paste it in a new tab, and
  check that it lands on that record.
- Copy citation on a record with a missing field and check that nothing is invented.
- Clipboard denied (or plain `http://` LAN origin via `javora-dev-lan`): the error
  toast appears and never shows success.
- Click the same copy button 5× quickly: one toast updates, no pile-up.
- Screen reader (VoiceOver): "Link copied" is announced once and focus stays on the button.
- Dark theme, reduced motion, 375px width: the toast is readable, not covered by the
  drawer, and clear of the safe area.
- Paste both page URLs into a share-card previewer (or check the meta tags) and look
  at the crop.

## 8. Rules of engagement

- Don't give me options. Make the call, give one line of reasoning, and build it.
- If the honest answer for a candidate is "this shouldn't exist", say so and ship
  nothing for it.
- Don't ask questions before starting. Work through everything, then report.
- Don't commit. Leave the diff for me to review.
