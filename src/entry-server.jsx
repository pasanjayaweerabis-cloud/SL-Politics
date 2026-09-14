/**
 * Javora — server entry, used only by the prerender build step.
 *
 * This never ships to a browser. `scripts/prerender.mjs` imports it at build
 * time to turn each public route into static HTML, so that a crawler, a social
 * unfurler, or a reader with JavaScript disabled receives the real content and
 * the real <head> rather than an empty <div id="root">.
 *
 * Routes render from the SAME bundled canonical dataset the browser uses, and
 * the head comes from the SAME `metaForRoute` the pages call, so prerendered
 * HTML cannot disagree with what hydration produces.
 */

import { renderToString } from 'react-dom/server';
import App from './App.jsx';
import { matchRoute } from './lib/router.tsx';
import { metaForRoute } from './lib/pageMeta.ts';
import { renderMetaTags } from './lib/seo.ts';

export { prerenderRoutes, sitemapRoutes } from './lib/routeManifest.ts';

/**
 * Render one route to its body markup and head tags.
 *
 * `today` is passed in so a build is deterministic: two prerenders of the same
 * dataset at the same instant produce identical bytes, rather than differing
 * because a term boundary fell between them.
 */
export function renderPage(pathname, { origin, today = new Date() } = {}) {
  const route = matchRoute(pathname, '');
  const meta = metaForRoute(route, today);
  return {
    html: renderToString(<App ssrRoute={route} />),
    head: renderMetaTags(meta, origin),
    /* A route that resolves to no record must not be advertised as a page. */
    noindex: Boolean(meta.noindex),
  };
}
