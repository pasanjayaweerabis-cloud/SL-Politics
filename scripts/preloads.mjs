/**
 * Javora — move React's preload links out of the body and into the head.
 *
 * React 19 emits `<link rel="preload">` for images inline where
 * `renderToString` first meets them, but on the client it hoists the same links
 * into <head>. Left in the body, they are extra child nodes the client render
 * does not produce — which fails hydration outright (React error #418), and
 * React then throws away the entire prerendered tree and re-renders from
 * scratch. That silently costs the whole benefit of prerendering while still
 * looking correct in a browser.
 *
 * Head is also where they belong: a preload discovered there starts fetching
 * before the body is parsed.
 *
 * Extracted out of prerender.mjs into its own module for the same reason
 * shellMeta.mjs was — so a test can assert the behaviour. prerender.mjs runs
 * the whole build on import, so nothing inside it can be unit-tested. This was
 * the last of the prerender steps with no test; the audit listed it under
 * "guarded by: none — add one".
 */

/**
 * Matches a React-emitted preload link.
 *
 * Deliberately narrow: only `<link rel="preload" ...>`, so stylesheets,
 * modulepreloads and icons in the shell are left alone.
 */
export const PRELOAD = /<link rel="preload"[^>]*\/?>/g;

/**
 * Split rendered body HTML into the body without preloads, and the preload
 * tags to be placed in <head>.
 *
 * @param {string} html rendered body HTML
 * @returns {{ body: string, preloads: string }}
 */
export function liftPreloads(html) {
  const preloads = html.match(PRELOAD) ?? [];
  return { body: html.replace(PRELOAD, ""), preloads: preloads.join("\n    ") };
}
