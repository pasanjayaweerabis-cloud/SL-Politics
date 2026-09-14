/**
 * Javora — the set of public URLs.
 *
 * ONE list, THREE consumers: the prerenderer writes a static file per entry,
 * the sitemap publishes them to search engines, and the tests check the two
 * agree. Keeping them separate is how a site ends up advertising URLs in its
 * sitemap that return the SPA fallback, or prerendering pages no crawler is
 * ever told about.
 *
 * Every entry is derived from the canonical dataset. Nothing here is a
 * hand-maintained list of people, so a person added by synchronisation becomes
 * a crawlable, prerendered, sitemapped URL on the next build without anyone
 * editing this file.
 */

import { allPeople } from "../services/repository.ts";
import { IDENTITY_OVERRIDES } from "../data/identityOverrides.ts";

export interface PublicRoute {
  /** Absolute site path, always starting with "/". */
  path: string;
  /**
   * Relative importance within the site, as sitemap.xml defines it. Not a
   * ranking signal between sites — only a hint about which of OUR pages matter
   * most, which is why the homepage and the directory outrank a single profile.
   */
  priority: number;
  /**
   * How often the content behind this URL is expected to change. The Current
   * Government page changes when a portfolio moves; a historical profile may
   * not change for years.
   */
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
}

/** The fixed pages. `/corrections` is a form, deliberately excluded below. */
const STATIC_ROUTES: PublicRoute[] = [
  { path: "/", priority: 1.0, changefreq: "daily" },
  { path: "/government", priority: 0.9, changefreq: "daily" },
  { path: "/directory", priority: 0.9, changefreq: "weekly" },
  { path: "/about", priority: 0.5, changefreq: "monthly" },
  { path: "/corrections", priority: 0.3, changefreq: "monthly" },
];

/**
 * Every public route, static pages first, then one per person.
 *
 * Sorted by path so two builds of the same dataset produce byte-identical
 * output — a sitemap whose line order churns between builds makes every
 * deployment look like a content change.
 */
export function prerenderRoutes(today: Date = new Date()): PublicRoute[] {
  const people = allPeople(today)
    .map((view) => view.person.slug)
    .filter((slug): slug is string => Boolean(slug))
    .sort()
    .map((slug): PublicRoute => ({
      path: `/person/${encodeURIComponent(slug)}`,
      // A profile is the substance of the site, but there are hundreds of
      // them and only one homepage.
      priority: 0.7,
      changefreq: "monthly",
    }));

  return [...STATIC_ROUTES, ...people, ...RETIRED_PERSON_ROUTES, ...LEGACY_ROUTES];
}

/**
 * Slugs a person used to publish under, kept alive as real files.
 *
 * A curated identity merge changes which spelling a record publishes under
 * (see `data/identityOverrides.ts`). The displaced slug is a URL this site
 * already published, so it must keep answering — and on a static host
 * "answering" means a FILE exists at that path. Resolving it in
 * `getPersonBySlug` is not enough: without an entry here the prerenderer
 * writes nothing, and the old address returns a hard 404 to exactly the
 * visitors and crawlers who only have the old link. That was measured, not
 * assumed.
 *
 * Prerendered but NOT sitemapped, the same split `/corrections` uses below.
 * The page renders the profile and declares the CURRENT slug canonical
 * (`personMeta` builds the canonical from the person's own slug, whichever
 * slug was requested), so search engines consolidate on the live URL while
 * the retired one stays a working link rather than a dead one. Advertising it
 * in the sitemap would ask crawlers to index an address we have retired.
 */
const RETIRED_PERSON_ROUTES: PublicRoute[] = IDENTITY_OVERRIDES
  .flatMap((override) => override.retiredSlugs)
  .sort()
  .map((slug): PublicRoute => ({
    path: `/person/${encodeURIComponent(slug)}`,
    priority: 0.7,
    changefreq: "monthly",
  }));

/**
 * A retired standalone route, kept resolving as a real prerendered file
 * rather than deleted, even though its content now lives at the canonical
 * person URL below. Same split as RETIRED_PERSON_ROUTES: prerendered so the
 * address never hard-404s, excluded from the sitemap because the page itself
 * declares /person/harsha-de-silva canonical (see PersonPage.jsx's
 * PortfolioPersonPage and pageMeta.ts's routeMeta) and advertising both would
 * submit two URLs for one profile.
 */
const LEGACY_ROUTES: PublicRoute[] = [
  { path: "/politician/harsha-de-silva", priority: 0.1, changefreq: "yearly" },
];

/**
 * The routes that belong in sitemap.xml.
 *
 * `/corrections` is prerendered — it should load without JavaScript — but is
 * not submitted for indexing: it is an input form with no content of its own,
 * and search results pointing at it would be a dead end for a reader looking
 * for a person.
 *
 * Retired person slugs are excluded for a different reason: they are live
 * URLs we honour, not URLs we advertise. Each one already names the current
 * slug as its canonical, so listing it here would submit two addresses for
 * one profile and undo that.
 *
 * A confirmed-deceased person's profile is excluded on the SAME reasoning:
 * honoured (still a real prerendered file, still linkable), not advertised
 * for discovery. Nothing here removes the person from `prerenderRoutes` —
 * only from what search engines are told to index.
 */
export function sitemapRoutes(today: Date = new Date()): PublicRoute[] {
  const retired = new Set(RETIRED_PERSON_ROUTES.map((route) => route.path));
  const legacy = new Set(LEGACY_ROUTES.map((route) => route.path));
  const deceased = new Set(
    allPeople(today)
      .filter((view) => view.vitalStatus === "deceased")
      .map((view) => `/person/${encodeURIComponent(view.person.slug)}`),
  );
  return prerenderRoutes(today)
    .filter((route) => route.path !== "/corrections")
    .filter((route) => !retired.has(route.path))
    .filter((route) => !legacy.has(route.path))
    .filter((route) => !deceased.has(route.path));
}
