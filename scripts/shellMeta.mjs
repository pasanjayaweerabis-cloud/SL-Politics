/**
 * Javora — which tags in index.html's static shell are also emitted, per
 * page, by `renderMetaTags` (src/lib/seo.ts).
 *
 * Extracted out of prerender.mjs into its own module for one reason: so a
 * test can assert this list stays exhaustive. The bug this guards against
 * shipped on all 1,628 prerendered pages — `og:site_name`, `og:type` and
 * `twitter:card` were added to `renderMetaTags` at some point without the
 * shell-stripping list being updated to match, so every page carried each of
 * those three twice. `title` and `description` were stripped; the newer three
 * were not, because nothing forced the two lists to be checked against each
 * other. This file — plus scripts/shellMeta.test.mjs — is that check.
 */

export const DUPLICATED_BY_PAGE_META = [
  { label: "<title>", pattern: /\n?\s*<title>[\s\S]*?<\/title>/i },
  { label: "description", pattern: /\n?\s*<meta\s+name="description"[^>]*>/i },
  { label: "og:site_name", pattern: /\n?\s*<meta\s+property="og:site_name"[^>]*>/i },
  { label: "og:type", pattern: /\n?\s*<meta\s+property="og:type"[^>]*>/i },
  { label: "twitter:card", pattern: /\n?\s*<meta\s+name="twitter:card"[^>]*>/i },
];

export function stripShellMeta(template) {
  return DUPLICATED_BY_PAGE_META.reduce((html, { pattern }) => html.replace(pattern, ""), template);
}
