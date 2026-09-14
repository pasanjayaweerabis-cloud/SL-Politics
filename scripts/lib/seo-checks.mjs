/**
 * Javora — shared primitives for scripts/audit-seo.mjs and
 * scripts/validate-crawlability.mjs.
 *
 * Both scripts fetch a built site's sitemap, walk every person URL, and
 * check the served HTML — audit-seo.mjs does more (structured-data and
 * duplicate-content checks), which is why it is not simply deleted in
 * favour of the smaller script. They shared 18 identically-named top-level
 * symbols; this file holds only the three that are genuinely
 * generic, parameterised, and side-effect-free — everything else (BASE and
 * CONCURRENCY argv parsing, the sitemap/robots/dataset checks themselves) is
 * tightly coupled to each script's own flow and stays where it is.
 *
 * extractTag's own body does not care whether it is called with a full
 * document or a head-only substring — both scripts already pass it whichever
 * one they need at each call site, and moving the function here changes
 * neither.
 */

/** Run `fn` over `items` with at most `limit` concurrent in flight. */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The `<head>...</head>` slice of an HTML document, verbatim. */
export function extractHead(html) {
  return html.slice(0, html.indexOf("</head>") + 7);
}

/** First capture group of `pattern` matched against `text`, or null. */
export function extractTag(text, pattern) {
  const m = text.match(pattern);
  return m ? m[1] : null;
}
