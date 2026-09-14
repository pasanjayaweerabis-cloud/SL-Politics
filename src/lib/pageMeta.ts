/**
 * Javora — what each route publishes about itself.
 *
 * ONE definition, TWO callers: every page applies this at runtime, and the
 * prerenderer serialises it into static HTML at build time. Without that, a
 * crawler would read one title and a reader would see another, and nobody
 * would notice — the static copy is the one no human ever looks at.
 *
 * Deriving person metadata from the canonical repository (rather than from
 * whatever the page happens to be holding) means a prerendered profile and a
 * hydrated profile describe the same record by construction.
 */

import type { Route } from "./router.tsx";
import { type PageMeta, type PageImage, personDescription, personStructuredData } from "./seo.ts";
import { getPersonBySlug, allPeople } from "../services/repository.ts";

const HOME_DESCRIPTION =
  "Source-linked public records of Sri Lankan public figures — offices, terms, timelines and the institutional sources behind them.";

/**
 * The one profile with its own share card (see docs/design/share-card-philosophy.md).
 * Keyed by slug rather than a boolean on the person record: this is a
 * presentation asset tied to the portfolio layout, not a fact about the
 * person, and the portfolio layout is currently limited to this one slug —
 * see src/data/profileContent.ts.
 */
const PERSON_IMAGES: Record<string, PageImage> = {
  "harsha-de-silva": {
    path: "/og/harsha-de-silva.png",
    alt: "SL Politics — Harsha de Silva, public record",
  },
};

/**
 * Every canonical name held by more than one sluggable person, mapped to how
 * many people share it.
 *
 * Real, not hypothetical: three pairs of historical MPs — decades apart,
 * never overlapping in office — happen to share an identical name, which
 * without this produces byte-identical <title>, og:title and JSON-LD `name`
 * across two distinct URLs. Computed once at module load rather than per
 * request: the SET of people who exist, and therefore which names collide,
 * does not depend on `today` — only each person's derived current/serving
 * status does, which this check never looks at.
 */
const nameCollisionCount = (() => {
  const counts = new Map<string, number>();
  for (const view of allPeople(new Date())) {
    if (!view.person.slug) continue;
    counts.set(view.person.canonicalName, (counts.get(view.person.canonicalName) ?? 0) + 1);
  }
  return counts;
})();

/**
 * The year this person's earliest recorded position began, or null if
 * nothing dated exists to draw one from.
 *
 * Never fabricated: this is the earliest `startDate` (falling back to
 * `currentAsOf`, a source's dated assertion the office was held, for a
 * position with no start date on record) already present on the person's
 * own positions. ISO date strings ("1972", "1972-05", "1972-05-22") sort
 * correctly as plain strings, so no date parsing is needed to find the
 * earliest one.
 */
function earliestServiceYear(view: NonNullable<ReturnType<typeof getPersonBySlug>>): string | null {
  const dated = view.positions
    .map((p) => p.startDate ?? p.currentAsOf ?? null)
    .filter((d): d is string => Boolean(d))
    .sort();
  return dated.length > 0 ? dated[0]!.slice(0, 4) : null;
}

/**
 * Metadata for a person, or the not-found metadata when no such record exists.
 *
 * A profile URL with no record is marked `noindex`: it is a soft 404, and
 * letting search engines accumulate those is how a site ends up ranking for
 * pages that say "record not found".
 */
export function personMeta(slug: string, today: Date = new Date()): PageMeta {
  const view = getPersonBySlug(slug, today);
  if (!view) {
    return { title: "Record not found", path: `/person/${encodeURIComponent(slug)}`, noindex: true };
  }

  const path = `/person/${encodeURIComponent(view.person.slug)}`;
  const headline = view.headline?.title ?? null;

  // A name shared with another real, distinct person gets a year appended —
  // drawn only from their own already-recorded service dates, never invented
  // — so two different historical MPs do not publish identical <title> tags.
  // The page's own heading is untouched: a reader on the profile already sees
  // the specific dates: this is metadata-only disambiguation.
  const isAmbiguousName = (nameCollisionCount.get(view.person.canonicalName) ?? 0) > 1;
  const disambiguatingYear = isAmbiguousName ? earliestServiceYear(view) : null;
  const displayName = disambiguatingYear
    ? `${view.person.canonicalName} (from ${disambiguatingYear})`
    : view.person.canonicalName;

  return {
    title: displayName,
    description: personDescription({
      name: displayName,
      headline,
      party: view.partyLabel,
    }),
    path,
    structuredData: personStructuredData({
      // Structured data keeps the PLAIN name — schema.org's Person.name is
      // meant to be the actual name a search engine or assistant would quote
      // back, and "(from 1972)" is a Javora-specific disambiguator for a
      // title tag, not a fact about the person's name.
      name: view.person.canonicalName,
      path,
      description: view.person.biography,
      jobTitle: headline,
    }),
    image: PERSON_IMAGES[slug],
  };
}

/** Metadata for any route. */
export function metaForRoute(route: Route, today: Date = new Date()): PageMeta {
  return routeMeta(route.name, route.params, today);
}

/**
 * Metadata by route name.
 *
 * Pages call this directly — most of them never receive a `Route` object, and
 * making them assemble a synthetic one just to ask for their own title would
 * be ceremony with a chance of getting it wrong.
 */
export function routeMeta(
  name: Route["name"],
  params: Record<string, string> = {},
  today: Date = new Date(),
): PageMeta {
  switch (name) {
    case "home":
      // Must stay byte-identical to seo.ts's SITE_NAME: `buildPageMeta`
      // special-cases that exact match to avoid emitting "X | X" as the
      // homepage title.
      return { title: "SL Politics", description: HOME_DESCRIPTION, path: "/" };

    case "government":
      return {
        title: "Current Government of Sri Lanka",
        description:
          "Who currently holds the major national offices of Sri Lanka — the President, " +
          "Prime Minister, Cabinet, Deputy Ministers and parliamentary leadership — each " +
          "linked to the official record it came from.",
        path: "/government",
      };

    case "directory":
      return {
        title: "Public Figures Directory",
        description:
          "Browse Sri Lankan public figures by party, district, role and service status. " +
          "Every record links to the institutional source it should be traceable to.",
        path: "/directory",
      };

    case "about":
      return {
        title: "About",
        description:
          "What the SL Politics dataset holds, and the principles behind how public records " +
          "are sourced, verified and presented.",
        path: "/about",
      };

    case "corrections":
      return {
        title: "Report an error",
        description:
          "Report an inaccuracy in an SL Politics public record, citing the official source " +
          "that contradicts it.",
        path: "/corrections",
      };

    case "person":
      return personMeta(params.slug ?? "", today);

    case "harsha-de-silva-profile":
      // Retired standalone route (see routeManifest.ts's LEGACY_ROUTES):
      // the profile itself now lives at the canonical person URL, so this
      // page declares THAT address canonical rather than its own.
      return personMeta("harsha-de-silva", today);

    default:
      return {
        title: "Page not found",
        description: "This page does not exist on SL Politics.",
        noindex: true,
      };
  }
}
