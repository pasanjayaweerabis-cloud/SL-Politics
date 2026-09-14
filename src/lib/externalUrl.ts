/**
 * Javora — safe external URL rendering.
 *
 * Moved out of components/Primitives.jsx, where it sat as one of two pure
 * functions in an otherwise all-JSX file — which is why
 * src/lib/externalUrl.test.ts, testing this exact function, had no matching
 * source file for years. The tests are unchanged; only their import path
 * moves with the function.
 *
 * NOT MERGED with src/services/corrections.ts's isAcceptableSourceUrl(),
 * which enforces a deliberately STRICTER rule for the correction form: it
 * rejects a bare institution homepage (no path, no query — "not a specific
 * document"), and it rejects a same-origin relative path outright, where this
 * function treats one as trivially safe to render. Sharing the http(s)-only
 * check between them would be a thin saving in exchange for a real risk of
 * quietly loosening the form's stricter rule, so corrections.ts keeps its own
 * independent implementation.
 */

/**
 * A source-supplied URL, or null if it is not one Javora will link to.
 *
 * Evidence URLs are SCRAPED — they are whatever an official website
 * published, not a value this project authored — and they land directly in
 * an `href` with `target="_blank"`. The canonical database already asserts
 * this invariant (`CHECK (source_url LIKE 'http%')` in 001_initial.sql), but
 * the browser reads the BUNDLED dataset, not the database, so nothing was
 * enforcing it on the path that actually renders. Two stores, one rule,
 * previously enforced in only one of them.
 *
 * Verified empirically against React 19 rather than assumed: it neutralises
 * `javascript:` hrefs (including whitespace-padded and mixed-case forms) but
 * passes `data:` and `vbscript:` through untouched. Browsers separately block
 * top-level navigation to `data:`, and `vbscript:` died with IE — so this is
 * defence in depth against a future connector reading a less trustworthy
 * source, not a patch for a live exploit. All 6,649 evidence URLs currently
 * in the dataset are https.
 */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    // Parsed rather than pattern-matched, so tricks that defeat a regex —
    // embedded newlines, tabs, mixed case — are resolved the way the browser
    // would resolve them before the scheme is checked.
    const { protocol } = new URL(String(url), 'https://javora.lk');
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null; // not a URL at all
  }
}
