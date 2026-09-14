/**
 * Javora — sitemap.xml generation.
 *
 * Pulled out of prerender.mjs into its own module for the same reason as
 * shellMeta.mjs: the string this produces is exactly what search engines
 * read, so it needs a test that parses the ACTUAL XML rather than one that
 * only checks the route list feeding it.
 *
 * Every URL comes from `routeManifest.ts`'s `sitemapRoutes()`, which is
 * itself derived from the canonical dataset (`allPeople()`) — there is no
 * hand-typed list of person URLs anywhere in this pipeline. A person added
 * or removed from the canonical data changes this file's output on the next
 * build with no edit here.
 */

const escapeXml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The production origin must be HTTPS.
 *
 * A sitemap pointing search engines at `http://` URLs for a site that only
 * actually serves `https://` either gets every URL flagged as a redirect
 * (Google treats the http->https hop as a soft signal to drop the http
 * variant, wasting crawl budget re-discovering the right one) or, if the
 * site does not redirect, indexes the insecure origin outright. Checked here
 * rather than assumed, because `VITE_SITE_ORIGIN` is free-form environment
 * input with no other validation between it and this file.
 */
export function assertHttpsOrigin(origin) {
  if (!/^https:\/\//i.test(origin)) {
    throw new Error(
      `sitemap: origin must be an HTTPS URL, got "${origin}".\n` +
        "  A sitemap advertising http:// URLs for a production site either wastes\n" +
        "  crawl budget on a redirect or indexes the insecure origin outright.",
    );
  }
}

/**
 * Build the sitemap.xml document for one origin and route list.
 *
 * NO <lastmod>. The only date available at build time is the build's own
 * timestamp, and stamping that on every URL would claim all ~1,600 pages
 * changed on every deploy — search engines learn to ignore a lastmod that
 * always says "now", which is worse than omitting it. A truthful per-page
 * lastmod needs a per-record updated timestamp threaded through from the
 * database to the manifest, which does not exist yet.
 */
export function buildSitemapXml(routes, origin) {
  assertHttpsOrigin(origin);

  const seen = new Set();
  for (const route of routes) {
    if (seen.has(route.path)) {
      throw new Error(`sitemap: duplicate route "${route.path}" — routeManifest.ts should never produce this`);
    }
    seen.add(route.path);
  }

  const entries = routes
    .map(
      (route) =>
        `  <url>\n` +
        `    <loc>${escapeXml(origin + route.path)}</loc>\n` +
        `    <changefreq>${route.changefreq}</changefreq>\n` +
        `    <priority>${route.priority.toFixed(1)}</priority>\n` +
        `  </url>`,
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
  );
}
