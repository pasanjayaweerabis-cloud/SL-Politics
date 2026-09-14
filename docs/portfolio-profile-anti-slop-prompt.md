# Anti-slop / professional-UI pass - /person/harsha-de-silva (PortfolioProfile only)

Copy-paste prompt for Claude Code. Scope is deliberately narrow: two files,
one page. Nothing else on the site changes.

This document uses no em-dash or en-dash in its own prose, on purpose: the rule
it enforces is binary and it would be odd to break it while stating it. The only
occurrences below are inside code spans, quoting the exact characters to remove.
Apply the rule to user-visible page strings; repo docs written before this one
are not in scope.

---

Remove the AI-generated tells from one page of this codebase and raise its
professional-UI quality: the portfolio profile at
`http://127.0.0.1:5173/person/harsha-de-silva` (`npm run dev`).

## Skill to load first

`/pg-frontend-professionalui-reduce-ai-looks` - load it before reading any code.

**Read its Section 13 (Out of Scope) before anything else.** That skill is
written for landing pages, marketing sites and portfolios. This page is a
civic accountability record built around a 7-column evidence table, which the
skill's own scope note excludes. Most of it therefore does not apply here, and
applying it anyway is the failure mode this prompt exists to prevent. Section
"What the skill says that does NOT apply here" below is not advisory. It is the
boundary.

## Design Read - already made, do not re-derive

Per the skill's Section 0.B, the read is declared here so no session reaches
for a landing-page aesthetic:

> **Reading this as:** a public-record accountability page for citizens,
> journalists and researchers, with a trust-first documentary language,
> leaning toward the project's own existing token system.

**Mode (skill Section 11.A): Redesign - Preserve.** The page is finished and
deliberate. This is a tell-removal and consistency pass, not a re-composition.

**Dials (skill Section 1.B, "Public-sector service" preset):**

```
DESIGN_VARIANCE: 3
MOTION_INTENSITY: 2
VISUAL_DENSITY:  5
```

Do not raise them. The skill's own 1.A table puts "trust-first / public-sector /
regulated / accessibility-critical" at 3-4 / 2-3 / 4-5, and its Section 0.A
says quiet constraints of this kind OVERRIDE aesthetic preference. A page whose
job is to say "Not established" honestly does not get asymmetric masonry or
kinetic type.

## Scope - hard boundary

Editable:
- `src/pages/PortfolioProfile.css`
- `src/pages/PortfolioProfile.jsx`
- `src/data/harshaDeSilva.ts` - **only** the three visible-string fixes named in
  finding 1. Shape may change, claims may not: you may not soften, strengthen,
  merge or drop a factual claim, a caveat, an evidence status, a source or a
  date value.

Read-only, for context: `src/styles/tokens.css`, `src/styles/base.css`,
`src/pages/PersonPage.jsx`, `src/data/profileContent.ts`, `src/lib/icons.jsx`.

Do not touch: any other page or stylesheet, `Chrome.jsx`, `Primitives.jsx`, the
router, i18n files, the rest of `src/data/**`, `server/**`, the build scripts.

## Context you must respect

- **`PortfolioProfile.jsx` is a generic component, not Harsha's page.**
  `src/data/profileContent.ts` maps a slug to content and every string in the
  component comes from its `content` prop. Any structural change you make lands
  on every future portfolio profile, so do not hardcode anything specific to
  this person or this ministry.
- **No dependencies.** `package.json` has exactly three runtime dependencies:
  `pg`, `react`, `react-dom`. The absence of a router, HTTP framework, ORM,
  state library, CSS framework and icon library is a documented position argued
  in the code, not an oversight. **This overrides the skill's Section 3.C**
  (install Phosphor / HugeIcons / Radix / Tabler) and its Section 9.E ban on
  hand-rolled SVG icons. `src/lib/icons.jsx` is a hand-rolled inline set, it
  stays, and you may not add an icon package. If a glyph is missing, add a path
  to that file in the same style.
- **No Tailwind, no Motion, no shadcn.** The skill's Section 3.A stack defaults
  are for greenfield projects. This is plain CSS with a real token system in
  `src/styles/tokens.css`. Use the tokens. Never write a raw hex, px radius or
  ad-hoc rem.
- **Typography is owned by another document.** `docs/typography-audit-2026-09-04.md`
  (applied site-wide) and `docs/portfolio-profile-typography-prompt.md` own font
  sizes, measure, line-height, contrast and the three-family system. Do not
  restyle type here. Where the two prompts disagree, the typography one wins.
- **Motion is owned by another document.** `docs/portfolio-profile-animation-prompt.md`
  owns transitions and keyframes on this page. Add none here. At
  `MOTION_INTENSITY: 2` the skill's own Section 7 definition is "no automatic
  animations, hover and active states only", so there is nothing to add anyway.
- **This page is prerendered.** `npm run build` runs `vite build --ssr` plus
  `scripts/prerender.mjs` and `npm run validate:crawlability` is a hard gate on
  the static HTML. Nothing you add may hide content by default or need JS to
  become readable.
- **Honesty outranks polish.** Evidence statuses, source counts, "Not
  established" and "URL unavailable" are load-bearing. A visual change that
  makes a weaker claim look stronger, or that makes an unsourced row look
  sourced, is a regression no matter how much better it looks.

## Findings - this is my read; argue with it

Verified against the files. Check each in the browser before acting, and say so
if one is wrong.

### 1 - Em-dash and en-dash in visible copy - skill Section 9.G, non-negotiable

Three user-visible strings in `src/data/harshaDeSilva.ts` carry banned dash
characters. Every other hit in these files is inside a code comment and is not
visible to a reader, so leave those alone.

| Line | String | Fix |
|---|---|---|
| 64 | `tenure: "11 Jan 2019 – 21 Nov 2019"` | en-dash to hyphen. Date ranges use `-`. |
| 66 | `focusNote: "...from the public record below — not this person's full political career."` | Restructure. A colon or a full stop plus a second sentence both work. |
| 68 | `focusExplainer: "...a person has held, and — for a smaller set of people — a portfolio page..."` | Two em-dashes in one sentence. Rewrite with commas or parentheses. |

The tenure fix is purely typographic and changes nothing factual. The other two
are prose edits: keep the claim identical, change only the punctuation and the
clause order needed to carry it.

Then grep the rendered page, not just this file, and confirm zero `—` and zero
`–` reach the DOM.

### 2 - Six corner radii on one page - skill Section 4.4 Shape Consistency Lock

`PortfolioProfile.css` currently uses `2px` (73), `--radius-sm` 4px (622, 723),
`--radius` 6px (224, 448, 470, 678), `--radius-md` 8px (267, 320, 855),
`--radius-lg` 10px (144, 376, 503) and `--radius-full` (438). Six values with
no documented rule.

The skill allows a mixed system only when the rule is written down and followed
everywhere. So write the rule, in a comment at the top of the file, and then
follow it. A defensible one for this page: containers get `--radius-lg`,
inline notes and controls get `--radius`, pills and micro-chips get
`--radius-sm`, the bullet marker stays `--radius-full`. Any assignment is fine
if it is stated and consistent. What is not fine is the current state, where
three visually equivalent boxes (`.hds-profile__prose-card` at `--radius-lg`,
`.hds-profile__note` at `--radius`, `.hds-profile__evidence-note` at
`--radius`) disagree with each other for no reason.

Leave the `2px` focus ring alone if it matches the site-wide focus style;
confirm against `src/styles/base.css` before moving it.

### 3 - Three accent hues on one page - skill Section 4.2 Color Consistency Lock

The page's local alias block (lines 18-34) maps `--amber`, `--good` and `--bad`,
and line 205 reaches past all of them to `--secondary`. Rendered, that is amber
on the section numbers, source numbers and source-link hover; teal on the
"Why this role?" disclosure summary; green on the record-status value. Three
accent families competing in one column.

**Do not collapse the five evidence-status pill colours** (628-632). Those are
semantic state, the skill explicitly allows colour for real state, and the
component already pairs every colour with a text label so colour is never the
only carrier. They are not accents, they are data.

Everything else should resolve to one accent. My read: amber is the page's
accent because it carries the numbering system that the "Sources 02 - 04"
references depend on. That makes the teal disclosure summary and the green
record-status value the outliers. Check whether `--good` on record status is
carrying meaning (does "Source-linked" vs another value change the colour?) or
is decorative. If decorative, it goes to the accent or to `--ink`. If it is
real state, keep it and say so.

### 4 - Uppercase tracked micro-labels are the page's dominant texture - skill Section 4.7 Eyebrow Restraint

The skill's mechanical count: instances of small uppercase tracked labels must
be at most `ceil(sectionCount / 3)`. Four sections gives a budget of 2. The
page has roughly ten `--track-label` uppercase runs: lines 159 (hero eyebrow),
274, 349, 401, 526, 565, 598, 712, 790 and 883.

Be careful here, and do not delete blindly. Several of these are `<dt>` terms
and table labels, which are structural, not decorative eyebrows. The skill's
rule targets the decorative label sitting above a headline purely to make a
section feel designed. Sort the ten into:

- **Structural** (definition-list terms, the mobile table's `data-label` row
  labels, the source-type line): keep. They name a field the reader needs.
- **Decorative** (a label above a heading that repeats what the heading already
  says, or a caps label whose content is a full phrase rather than a field
  name): drop the caps-and-tracking treatment, or drop the label.

Report the sort and the final count. If the honest count lands above 2 because
this page is a structured record rather than a marketing page, say that and
keep them. Do not fake compliance by making a needed label lowercase and
calling it removed.

### 5 - Middle-dot as a general-purpose separator - skill Section 9.F, max 1 per line

Four sites in `PortfolioProfile.jsx`:

- line 125, `portfolioAreas.join(' · ')` - three areas, two dots
- line 138, `education.join(' · ')` - three degree strings, two dots, and each
  string is long enough that the line reads as a run-on
- line 294, source `meta` join - one dot, within budget
- line 47, `SourceRefs` separators - one dot per extra source

Line 138 is the real problem: three university degrees flattened into a single
dot-separated string inside a `<dd>`. That is a list wearing a sentence's
clothes. Make it a real list. Line 125 is borderline and may be fine as a
compact field value; argue whichever way you land.

### 6 - Boxed notes stacked at the end of section 03 - skill Section 4.4

Section 03 closes with four stacked blocks: `.hds-profile__evidence-note`
(solid border box), `.hds-profile__legend` (list), then two
`.hds-profile__note` paragraphs (dashed border boxes). Three bordered boxes in
a row, two of them visually near-identical, is exactly the "card everything"
default the skill's 4.4 warns about: use elevation only when it communicates
real hierarchy, otherwise group with a rule or with space.

The content is all correct and all of it must stay. The question is whether it
needs three borders. Options to weigh: merge the two `.hds-profile__note`
paragraphs into one box, since they are both closing qualifiers; or drop the
borders from the notes and separate them with space and a hairline, keeping a
border only on the evidence-note that defines a term.

### 7 - Not a violation, do not "fix" these

Things a fresh reading of the skill will flag that are correct as they stand.
Confirm and leave alone:

- **The list bullet before each institution** (`li::before`, line 432) is a
  5px grey `--line-strong` dot substituting for a list marker. The skill's ban
  on decorative dots targets coloured status-looking dots before nav items and
  rows. This is a bullet. Keep it.
- **The two-column institutions list** (`columns: 2`, line 418) already answers
  the skill's 4.9 rule about lists longer than five items. Keep it.
- **Serif headings.** Source Serif 4 on headings is discouraged as a default by
  the skill's 4.1, and the override applies: this is genuinely a
  publication/record context, and the site-wide typography audit already
  ratified the sans + serif + mono system as correct and at the ceiling. Not in
  scope.
- **The numbered sections 01-04.** The skill's 9.F bans section-number eyebrows
  as decoration. Here the numbers are wayfinding that the page depends on: the
  "Sources 02 - 04" references under each programme row point into the numbered
  Sources section. They are not decoration. You may reduce how loud they are
  (they are currently accent-coloured mono), but do not remove the numbering
  system without also solving the references.
- **The evidence-status pills.** Real semantic state, already label-plus-colour.
- **No hero CTA, no logo wall, no testimonial, no marquee, no scroll cue, no
  version stamp, no locale strip, no fake screenshot.** The page is clean of
  these. Do not add any of them.

## What the skill says that does NOT apply here

Read this list as prohibitions, not as omissions.

- **Section 4.8, "even minimalist sites need real images", and the instruction
  to generate section assets.** Hard no. This is a page of sourced claims about
  a real, living public figure. Generated or stock photography would place
  invented visual context next to factual claims, which is the single most
  damaging thing that could be done to this page. The one image on the page is
  his official Parliament portrait, and that is the correct and complete image
  strategy. Do not add a hero image, a texture, a gradient, a pattern or a
  Picsum seed. Do not add "at least 2-3 real images". If a section looks plain,
  it is meant to.
- **Sections 5.A and 5.B (GSAP sticky-stack, horizontal pan), kinetic type,
  magnetic buttons, glassmorphism, liquid glass, bento grids, mesh gradients,
  marquees, particle buttons, scroll hijacks.** All are gated behind
  `MOTION_INTENSITY > 5` or a premium/agency read. This page is at 2 and reads
  trust-first. None apply.
- **Section 2.A design systems** (Fluent, Carbon, Material, Radix, shadcn,
  GOV.UK Frontend, USWDS). Tempting because this is public-record work, but the
  project has its own token system and a no-dependency position. Do not install
  one. Do not hand-copy GOV.UK's CSS either.
- **Section 4.7's hero rules** (headline max 2 lines, subtext max 20 words, CTA
  visible without scroll, hero fits the viewport, hero top padding cap). This
  hero is a record header, not a conversion moment. It has no CTA and no value
  proposition. The 20-word cap would require cutting the focus note, which is a
  factual scope disclaimer. Leave the hero's content alone.
- **Section 4.9's content-density cuts** ("no data-dump sections", "top 3-5
  highlights plus a view-full-list link", spec-sheet alternatives). The six
  programme rows and five sources ARE the page. Never summarise, collapse
  behind a disclosure, or truncate them. The skill's alternative-UI list is
  written for marketing spec sheets, not for cited records. The one thing worth
  borrowing from 4.9 is the copy self-audit in finding 1.
- **Section 4.10 quotes and testimonials, 4.5's loading and empty states,
  4.6's form patterns.** The page has no quotes, no async state and no form.
  The corrections form lives on its own page and is out of scope.
- **Section 4.2's premium-consumer palette ban and the LILA rule.** The palette
  is an existing, measured, authored token system with recorded contrast
  ratios. It is neither AI-purple nor beige-and-brass. Do not recolour it.

## Verification - run before calling this done

Browser checks on `npm run dev`, both themes, at 1440 / 900 / 720 / 390px:

- [ ] Zero `—` and zero `–` in the rendered DOM
- [ ] One documented radius rule, written in a comment, followed everywhere
- [ ] One accent hue outside the evidence pills; the pill colours untouched
- [ ] Uppercase tracked labels sorted into structural and decorative, count
      reported, decorative ones resolved
- [ ] No line carries more than one middle dot
- [ ] Every evidence status, source, date and claim byte-identical to before,
      except the three punctuation fixes in finding 1
- [ ] No image, gradient, texture or pattern added
- [ ] No dependency added; `package.json` unchanged
- [ ] No transition or keyframe added
- [ ] Font sizes, measure and colours unchanged from the typography work
- [ ] Both themes still coherent; no section inverts (skill 4.11)
- [ ] Contrast still passes for anything you recoloured; quote the ratio

Then the code gates:

```bash
npm test
npm run typecheck
npm run lint
VITE_SITE_ORIGIN=https://javora.lk npm run build
npm run serve:dist              # in one terminal
npm run validate:crawlability   # must stay 1623/1623
```

`npm run preview` is not a substitute for `serve:dist`: it answers deep routes
with the SPA shell and will make a broken build look fine.

## Report format

Finish with a short written report:

1. The design read and dials you worked to, and any place you disagreed with
   the ones declared above.
2. Findings confirmed, findings rejected, with the reason for each rejection.
3. For finding 1, the before and after of all three strings, so the claim can
   be checked as unchanged.
4. Every skill rule you deliberately did not apply, and why. This list should
   be long. A short one means you applied landing-page rules to a public
   record.
