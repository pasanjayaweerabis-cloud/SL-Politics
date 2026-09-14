/**
 * Javora — robots.txt generation.
 *
 * Extracted out of prerender.mjs for the same reason as sitemap.mjs and
 * shellMeta.mjs: the string this produces is a crawling instruction read by
 * real search engines, so it needs a test that inspects the ACTUAL text
 * rather than one that only checks the intent behind it.
 *
 * WHAT ROBOTS.TXT IS, AND IS NOT, FOR HERE.
 *
 * `Disallow: /api/` below exists so search results are not cluttered with
 * unreadable JSON duplicating pages that already exist as HTML. It is a
 * crawling courtesy, not an access-control boundary — robots.txt is a text
 * file any client can simply not read, and every URL under /api/ is
 * (deliberately, per server/api/server.ts) a public, unauthenticated,
 * read-only endpoint anyway. There is no sensitive Javora endpoint that
 * relies on this file to stay private: nothing behind /api/ returns a
 * credential, a connection string, or anything server/api/server.ts's own
 * health check does not already treat as safe to disclose (see its "never a
 * connection string" comment). If a genuinely sensitive endpoint is ever
 * added, it must refuse unauthorised requests itself — a Disallow line
 * cannot do that job, and must never be asked to.
 */

export const PUBLIC_PATHS = ["/person/", "/directory", "/government"];

/**
 * Build robots.txt for one production origin.
 *
 * `Allow: /` plus a narrow, explained `Disallow` list — not the reverse
 * (disallow-by-default with exceptions carved out) — because the latter is
 * how a route added later silently ships unindexed: every new public page
 * must be reachable by construction, and only a deliberate, documented
 * exclusion opts a path out.
 */
export function buildRobotsTxt(origin) {
  return [
    "# SL Politics — public civic records.",
    "# Everything published here is intended to be read and cited. Crawling is",
    "# welcome; the only disallowed paths are ones with nothing to index.",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    "# The API serves the same records as JSON and would only produce duplicate,",
    "# unreadable results in a search index. This is a crawling courtesy, not",
    "# an access-control boundary: every endpoint under /api/ is public and",
    "# read-only regardless of whether a crawler honours this line.",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
