# Homepage UX cleanup: SL Politics (javora-react)

You are working in the `javora-react` repo (SL Politics). **Read `CLAUDE.md` first and follow it.** Its invariants override anything in this brief. Correctness, provenance and crawlability outrank looks. If any instruction below conflicts with `CLAUDE.md` or with what the code actually does, stop and tell me instead of forcing it.

## Goal

Make the homepage clearer and less repetitive for ordinary Sri Lankan visitors, without weakening the site's honesty or its static, crawlable output. This is a UX, copy and markup change. **Do not change data, the database, sync, identity or slugs.**

## Files involved (verify before editing)

- `src/pages/HomePage.jsx`: sections below the hero
- `src/components/home/HomeHero.jsx`, `home-hero.css`, `SearchPill.jsx`
- `src/components/Chrome.jsx`: nav tagline (~line 282), nav search icon (~line 290)
- `src/i18n/en.js`, `si.js`, `ta.js`: copy under `home.*`, `nav.tagline`
- `src/lib/featuredOffices.ts`, `src/services/repository.ts` (`currentGovernment`, `sortForDisplay`, `datasetStats`)
- `src/lib/prerenderContent.test.ts`: prerender assertions for the homepage
- `src/pages/DirectoryPage.jsx`: the `PARAM` map of supported directory facets

## Ground rules

- Plan first. Read every file above, then show me a short plan (files, changes, risks) before editing.
- Components stay `.jsx`. Do not convert to `.tsx`. Relative imports keep explicit file extensions.
- **Add no dependencies.**
- Everything on the homepage must render in the prerendered static HTML. No client-only gating. Every link is a real `<a href>`.
- No hydration mismatches: whatever the server renders, the client's first render must match.
- Never hardcode a politician's name anywhere. Names come from the data.
- Grep for every i18n key before deleting it. Some may be used by `pageMeta`/SEO or other pages.
- Keep `en`, `si` and `ta` key sets identical. See the translation note in Task 8.

---

## Task 1: Replace the bottom hero tagline with a scroll cue

**Problem:** A full-height hero reads as the whole page, so people miss the Current Government section below. The bottom line "A more informed Sri Lanka" also repeats the nav tagline.

**Change:**
1. In `HomeHero.jsx`, remove the `home-hero__bottom-tagline` content and put a scroll link in its place. Keep it left-aligned with the search bar, with the same small, subtle styling as the old tagline (thin rule plus text is fine).
2. Label: **"See the current government"** with a down arrow (↓) icon. Use the existing `Icon` component if it has a suitable arrow; otherwise use an inline SVG with `aria-hidden="true"`. Don't make a generic "Explore more" link.
3. Make it a real anchor: `<a href="#current-government">`. Put `id="current-government"` on the government `<section>` in `HomePage.jsx`, and keep the existing `aria-labelledby="government-heading"`.
4. **Edge case:** the government section only renders when `featuredGovernment.length > 0`. When it doesn't render, the cue must not point at a missing id. Either hide the cue or point it at the next real section (the trust section), with a matching label. Pass what's needed from `HomePage` into `HomeHero` as props, or compute it in the hero the same way `HomePage` does, whichever keeps server and client consistent.
5. **Router check:** confirm the custom router (`src/lib/router.tsx`) doesn't intercept same-page `#hash` clicks. If it does, handle hash links so they scroll natively instead of navigating.
6. Scrolling:
   - Smooth scroll only inside `@media (prefers-reduced-motion: no-preference)`. Reduced-motion users jump instantly.
   - Check whether `scroll-behavior` is already set globally, and don't duplicate it.
   - Add `scroll-margin-top` to the target section, equal to the sticky nav height plus a little breathing room. Use an existing CSS variable if there is one, so the heading isn't hidden under the nav.
7. Keep the hero height as it is (`min-height: min(88svh, 860px)`). Don't switch to `100vh`.
8. The link needs a visible `:focus-visible` style and enough contrast over the photo.

## Task 2: Popular searches become "Try:", with names from the data

**Problems:**
- "Popular searches" is a false claim, because the site has no search analytics.
- Role pills like "President" open a list of every president since 1978. Most visitors want the current person, and they search by name ("Anura Kumara"), not by title.

**Change:**
1. Rename the label to **"Try:"** (`home.hero.popularLabel`). Update the `aria-label` wording to something like "Suggested searches".
2. The chips become **2 people + 2 categories**:
   - **Chip 1:** current President, shown as `<Name> · President`
   - **Chip 2:** current Prime Minister, shown as `<Name> · Prime Minister`
   - **Chip 3:** `Cabinet ministers` → `/directory?role=cabinet-minister`
   - **Chip 4:** `Members of Parliament` → `/directory?role=member-of-parliament`
3. **The names must come from `currentGovernment(today)`**: `gov.president` and `gov.primeMinister`. Use the same `today` and memo pattern `HomePage` already uses for the government section, so prerender and hydration agree. Never hardcode a name. This keeps the site neutral: the rule is "whoever currently holds the office," not an editorial pick, and it updates on its own after an election.
4. Use the person's canonical display name as the dataset stores it. Don't respell it. If the name is very long, prefer an existing short-name field if the model has one. Don't invent one.
5. Link each person chip to that person's profile URL, built the same way `MemberCard` or the profile routes already build it. Don't hand-build slugs.
6. **Fallbacks:** if `president` or `primeMinister` is `null`, render the old role chip for that slot (`/directory?role=president` or `/directory?role=prime-minister`) instead of a blank or broken chip.
7. Verify both category facets exist in `DirectoryPage`'s `PARAM` map and return populated results. Don't invent facets. **Don't feature any political party**, because picking one is an editorial act.
8. On mobile, chips must wrap cleanly and stay easy to tap (at least 44px tall).

## Task 3: Replace the repetitive directory preview below Current Government

**Problem:** `HomePage.jsx` shows Current Government (President, PM, Speaker, Opposition Leader) and then "Public Figures Directory" with `sortForDisplay(people).slice(0, 6)`. That sort puts serving members first by precedence, so the same President and PM appear again in the next section.

**Change:**
1. Remove the 6-card `ProfileCard` preview.
2. In its place, add a compact **"Browse the directory"** section: a row or grid of plain link tiles. Each tile has a label and, where cheap and accurate, a count derived from the data. Only use facets that really exist in `DirectoryPage`'s `PARAM` map. Candidates to verify:
   - Cabinet ministers
   - Current Members of Parliament
   - Former Members of Parliament (only if a serving/former facet exists)
   - Districts (only if a district facet exists)
   - "View full directory" → `/directory`
3. Any count shown must be computed from `repository.ts`, not typed in. If a count would be expensive or ambiguous, leave it out rather than approximate it.
4. Keep the existing `SectionHead` pattern and heading hierarchy (h2), and keep a real `aria-labelledby`.
5. Remove imports that become unused (`ProfileCard`, `sortForDisplay`, `discoverablePeople`, and so on). Check each one before removing.
6. Crawlability: the homepage's 6 profile links were not the only path to those profiles (the directory renders all of them), but confirm it. `validate:crawlability` must still pass 1623/1623.

## Task 4: Remove the triple slogan and the "Trusted data" claim

**Problems:** The first screen has three slogans. The nav says "…For a more informed Sri Lanka," the eyebrow says "Trusted data. Stronger democracy.," and the bottom line said "A more informed Sri Lanka." Worse, "Trusted data" contradicts the site's own trust section, which says figures are "counted from the records, not claimed" and that nothing is verified until a person confirms it.

**Change:**
1. `nav.tagline`: shorten to **"People · Offices · Facts"**. Check it still fits at the breakpoints where it shows, and that it's hidden where it already was.
2. `home.hero.eyebrow`: change to **"Public records · Linked to their sources"**.
3. `home.hero.bottomTagline`: remove once Task 1 no longer uses it.

## Task 5: Plain-language hero copy

**Problem:** "Source-linked public records" and "the institutional record it should be traceable to" are researcher jargon. Ordinary visitors want to know who holds power and what they've done.

**Change (English):**
- **Headline:** "Who holds power in Sri Lanka, and where that's recorded."
  - Keep the existing accent span, applied to **"Sri Lanka"**. Rework `titleLine1` / `titleBeforeAccent` / `titleAccent` / `titleAfterAccent` so the line break still falls naturally on desktop and wraps without awkward orphans on mobile. Remove the hard `<br>` if it fights the new text.
- **Sub:** "Offices, careers and qualifications of {{count}} public figures, each linked to its official source."
  - `{{count}}` comes from `datasetStats(today).people`, formatted as the page already formats numbers (today that's 1,623). Don't type the number in. If adding interpolation to the hero is awkward, use "more than 1,600" only as a last resort, and tell me.
- **Search placeholder:** "Search a name, office, party or district…" Only mention "district" if search actually matches districts; the repository comments say the index covers district, but verify.
- Check whether `routeMeta('home')` / page `<title>` / meta description reuse the old hero strings. If they do, decide whether they should change too and tell me. Don't silently change SEO metadata.

## Task 6: One search entry point on the homepage

**Problem:** The nav search icon sits right above the big hero search on the homepage, and it goes to `/directory#search`, which is a different experience.

**Change:**
1. In `Chrome.jsx`, hide the nav search icon **only on the home route**. Keep it on every other page, and keep the mobile drawer's search link everywhere.
2. The route check must give the same result on the server (prerender of `/`) and on the client's first render. Use whatever route info the router or entry-server already exposes. Don't read `window` during render.
3. Leave no empty gap in the nav layout where the icon was.

## Task 7: Make the trust stats readable for ordinary users

**Problem:** "7 sources, 2 connected" means nothing to a normal visitor.

**Change:**
1. Read what `connectedSources` actually means in `datasetStats` and the source definitions. Per `CLAUDE.md`: 7 declared, 2 connected (S001 Parliament, S006 Cabinet Office); automatic sync exists but is off by default; S900 is a research compilation.
2. Rewrite `home.statSourcesConnected` / `home.statSourcesNone` in plain words that are **strictly accurate**. For example, "{{count}} read directly from the official website" works only if that's true. **Don't imply live or automatic updating**, because sync is off by default. If you can't find wording that is both plain and accurate, keep the current meaning, simplify only the words, and flag it for me.
3. Don't change how any figure is computed.

## Task 8: Clean up dead i18n strings and keep languages in sync

1. Find unused keys under `home.*` in `en.js` (likely `heroTitle`, `heroSub`, the second `searchPlaceholder`, `searchLabel` duplicates, `searchingRecords`, `browseFullDirectory`, `datasetHeading`, `datasetDescription`, `pillParties`, `role*`, plus keys made unused by this work). **Grep the whole repo for each key before deleting.** Delete only keys with zero references.
2. Apply the same deletions and additions to `si.js` and `ta.js`, so all three files have identical key sets.
3. **Translations:** write Sinhala and Tamil drafts for every new or changed string. Keep them plain and neutral. Put every draft string, with its English source, in your final report under **"Needs native review."** I will check them. Don't claim they are final.
4. If the repo has a test or script that checks i18n key parity, run it. If none exists, add a small vitest test asserting `en`, `si` and `ta` share the same key set.

## Out of scope: do NOT change

- **The hero image.** A design concern was raised about the Buddha statue on a neutral, multi-community civic site. That decision is mine. Don't crop, swap or edit `wallpaper1.*`. Mention it as an open decision in your final report.
- The image loading setup (`<picture>`, WebP, `fetchPriority`) is already optimised; leave it.
- Any data, database, sync scripts, identity overrides, slugs, routes list, CSP or the theme script.
- The Current Government section's cards and `featuredOfficeHolders` rule, except adding the `id` and `scroll-margin-top` from Task 1.

---

## Tests to add or update

- `src/lib/prerenderContent.test.ts`, or a new homepage test next to it, asserting that the rendered homepage markup:
  - contains the scroll cue `href="#current-government"` and a section with `id="current-government"` when the government section renders
  - contains person chips whose names equal `currentGovernment(...).president` / `.primeMinister` canonical names, read from the data in the test (not string literals)
  - falls back to role chips when either office holder is null, if that's testable with the existing setup
  - no longer contains the 6-card profile preview
  - has no "Popular searches", "Trusted data" or "A more informed Sri Lanka" text
- A nav test showing the search icon is absent on `/` and present on another route such as `/directory`, if `Chrome.jsx` is testable with the existing markup-only setup. Don't add jsdom.
- An i18n key-parity test (Task 8), if one doesn't exist yet.
- Update any existing test that asserted the old copy or the old pills. Change assertions to the new intended behaviour. Don't delete tests to make them pass.

## Verification (all must pass before you report done)

```bash
npm run typecheck
npm run lint
npm test
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist            # separate terminal; heed the stale-build warning
npm run validate:crawlability # HARD GATE: must stay 1623/1623
```

Then check the real output, not `npm run dev` or `npm run preview`:
1. Open `dist/index.html` and confirm the President and PM names, the "Try:" label, the scroll cue and the browse tiles are all in the static HTML.
2. On `serve:dist`, check desktop (~1440px), small laptop (~1280×720) and mobile (~390px):
   - the scroll cue works and the section heading isn't hidden under the nav
   - chips wrap cleanly
   - there's no nav search icon on home, but it's there on `/directory`
3. Browser console on home: **no hydration warnings.**
4. With OS reduced motion on, the cue jumps instead of smooth-scrolling.
5. Keyboard only: Tab reaches the search, every chip, the scroll cue and the browse tiles, with visible focus.

## Final report format

1. Summary of changes per task (1–8)
2. Files changed
3. Test and verification results, with command output summaries and the crawlability count
4. **Needs native review:** every new or changed Sinhala and Tamil string, with its English source
5. **Open decisions for Pasan:** hero image (statue), any SEO meta changes, any stats wording you couldn't make both plain and accurate, anything you skipped and why
