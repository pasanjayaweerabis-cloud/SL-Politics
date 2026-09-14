/**
 * Javora — per-page metadata.
 *
 * ONE computation, TWO renderers. `buildPageMeta` turns a page's intent into a
 * concrete list of tags; `applyPageMeta` writes them into a live document, and
 * `renderMetaTags` serialises the same list into static HTML at build time.
 *
 * That split is what lets prerendered HTML and the running app agree. If the
 * prerenderer computed its own titles, the static file a crawler reads and the
 * document a reader sees after hydration would drift apart, and only one of
 * them would ever be looked at.
 *
 * The constraint that matters here: metadata must not claim more than the
 * dataset supports. No title or description calls a record "verified", and the
 * structured data asserts only name, office and URL.
 */

import { DATASET } from "../data/adapters/datasetDescriptor.ts";

const SITE_NAME = "SL Politics";
const DEFAULT_DESCRIPTION =
  "Source-linked public records of Sri Lankan public figures — offices, terms, timelines and the institutional sources behind them.";

/**
 * The origin canonical URLs are written against.
 *
 * A canonical URL must be absolute and must name the production host. Deriving
 * it from `window.location` works in a browser but produces
 * `http://localhost:4173/...` when prerendering, which would tell search
 * engines that the canonical copy of every page is on a machine they cannot
 * reach. So the build supplies it, and the browser is only the fallback.
 *
 * Read through `import.meta.env` where Vite provides it, and `process.env`
 * during the Node prerender pass.
 */
export const SITE_ORIGIN: string = resolveOrigin();

// Declarations, not `const` arrows: `SITE_ORIGIN` is initialised at module load
// and would hit the temporal dead zone of anything defined below it with `const`.
// That failure only appears once VITE_SITE_ORIGIN is set — which is to say, only
// in production.
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveOrigin(): string {
  // Vite replaces this expression at build time in browser bundles.
  const fromVite =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SITE_ORIGIN;
  if (fromVite) return stripTrailingSlash(fromVite);

  const fromNode =
    typeof process !== "undefined" ? process.env?.VITE_SITE_ORIGIN ?? process.env?.SITE_ORIGIN : undefined;
  if (fromNode) return stripTrailingSlash(fromNode);

  if (typeof window !== "undefined") return window.location.origin;

  // Prerendering with no origin configured. The build fails loudly on this
  // rather than emitting canonical tags pointing at a placeholder domain.
  return "";
}

/** A page-specific share-card image. `path` is site-relative, e.g. "/og/harsha-de-silva.png". */
export interface PageImage {
  path: string;
  /** Plain description of the card ("SL Politics — Harsha de Silva, public record"), not marketing copy. */
  alt: string;
}

export interface PageMeta {
  title: string;
  description?: string;
  /** Canonical path, e.g. "/person/anura-kumara-dissanayake". */
  path?: string;
  /** Structured data object, already shaped for JSON-LD. */
  structuredData?: Record<string, unknown> | null;
  /** Set for pages that should not be indexed (404, generated views). */
  noindex?: boolean;
  /** Defaults to DEFAULT_IMAGE when omitted — every route gets a share card. */
  image?: PageImage;
}

/** A resolved tag list, ready for either renderer. */
export interface ResolvedMeta {
  title: string;
  description: string;
  canonical: string | null;
  robots: string;
  structuredData: Record<string, unknown> | null;
  /** null only when no origin is configured — same condition as `canonical`. */
  image: { url: string; alt: string; width: number; height: number } | null;
}

/**
 * The sitewide share card, used by every route that declares no `image` of
 * its own. 1200x630, the standard Open Graph card size.
 */
const DEFAULT_IMAGE: PageImage = {
  path: "/og/default.png",
  alt: "SL Politics — public records, clearly presented and traceable to their source.",
};

/**
 * Resolve a page's intent into concrete values.
 *
 * Pure, and safe to call with no DOM — which is the whole point.
 */
export function buildPageMeta(meta: PageMeta, origin: string = SITE_ORIGIN): ResolvedMeta {
  const { title, description = DEFAULT_DESCRIPTION, path, structuredData = null, noindex = false, image } = meta;
  const resolvedImage = image ?? DEFAULT_IMAGE;

  return {
    title: title === SITE_NAME ? title : `${title} | ${SITE_NAME}`,
    description,
    // Only a declared path yields a canonical URL. Falling back to the current
    // address would fold tracking parameters into the canonical tag and split
    // one page across many URLs in a search index.
    canonical: path && origin ? `${origin}${path}` : null,
    robots: noindex ? "noindex,follow" : "index,follow",
    structuredData,
    // Same origin gate as `canonical`: an image URL built against a
    // localhost/placeholder origin would be as wrong as a canonical one.
    image: origin
      ? { url: `${origin}${resolvedImage.path}`, alt: resolvedImage.alt, width: 1200, height: 630 }
      : null,
  };
}

/* ==========================================================================
   Renderer 1 — the live document
   ========================================================================== */

function upsertMeta(selector: string, attrs: Record<string, string>): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
}

function upsertLink(rel: string, href: string): void {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

/**
 * A stable internal DOM id, deliberately NOT renamed with the public brand.
 *
 * `applyStructuredData` removes the existing script by this id before writing
 * a new one, and `renderMetaTags` stamps the same id into every prerendered
 * page. Renaming it means a prerendered page still carrying the old id is not
 * found for removal at hydration, so the page ends up with TWO ld+json blocks.
 * The id is never seen by a reader and carries no brand meaning; keeping it
 * fixed is what keeps cached/stale HTML and a fresh bundle agreeing.
 */
const STRUCTURED_DATA_ID = "javora-structured-data";

function applyStructuredData(data: Record<string, unknown> | null): void {
  const existing = document.getElementById(STRUCTURED_DATA_ID);
  if (existing) existing.remove();
  if (!data) return;

  const script = document.createElement("script");
  script.id = STRUCTURED_DATA_ID;
  script.type = "application/ld+json";
  // JSON.stringify escapes the content; no markup can break out of the tag.
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

/**
 * Apply metadata for the current page. Every field is overwritten on each call
 * so no value leaks from the previously rendered route.
 *
 * The `...stray` guard is not defensive padding. Every caller is a `.jsx`
 * page, where TypeScript checks nothing, so a plausible-but-wrong key —
 * `canonical` instead of `path` — is silently discarded and the page loses its
 * canonical URL while still looking correct in the browser. That exact typo
 * shipped on the Government page. The load-bearing check is the static one in
 * `seo.test.ts`, which fails the build; this only catches metadata built at
 * runtime, which the static check cannot see.
 */
export function applyPageMeta({ ...meta }: PageMeta): void {
  const { title, description, path, structuredData, noindex, image, ...stray } = meta;
  const strayKeys = Object.keys(stray);
  if (strayKeys.length > 0) {
    console.error(`applyPageMeta: unknown option(s) ignored: ${strayKeys.join(", ")}`);
  }

  const resolved = buildPageMeta({ title, description, path, structuredData, noindex, image });
  const url = resolved.canonical ?? window.location.href;

  document.title = resolved.title;

  upsertMeta('meta[name="description"]', { name: "description", content: resolved.description });
  upsertMeta('meta[name="robots"]', { name: "robots", content: resolved.robots });

  upsertLink("canonical", url);

  upsertMeta('meta[property="og:title"]', { property: "og:title", content: resolved.title });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: resolved.description });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: url });
  upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: SITE_NAME });

  if (resolved.image) {
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: resolved.image.url });
    upsertMeta('meta[property="og:image:alt"]', { property: "og:image:alt", content: resolved.image.alt });
    upsertMeta('meta[property="og:image:width"]', { property: "og:image:width", content: String(resolved.image.width) });
    upsertMeta('meta[property="og:image:height"]', { property: "og:image:height", content: String(resolved.image.height) });
  }

  // summary_large_image only once there is an image to show large; with no
  // origin configured (so no image URL at all) the card degrades to "summary".
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: resolved.image ? "summary_large_image" : "summary" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: resolved.title });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: resolved.description });
  if (resolved.image) {
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: resolved.image.url });
  }

  applyStructuredData(resolved.structuredData);
}

/* ==========================================================================
   Renderer 2 — static HTML
   ========================================================================== */

/** Escape for an HTML attribute value. */
const attr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The same tags as `applyPageMeta`, as an HTML string for the prerenderer.
 *
 * Both renderers read one `ResolvedMeta`, so a change to what Javora publishes
 * cannot land in the browser and miss the static files.
 */
export function renderMetaTags(meta: PageMeta, origin: string = SITE_ORIGIN): string {
  const resolved = buildPageMeta(meta, origin);
  const lines = [
    `<title>${attr(resolved.title)}</title>`,
    `<meta name="description" content="${attr(resolved.description)}">`,
    `<meta name="robots" content="${resolved.robots}">`,
  ];

  if (resolved.canonical) {
    lines.push(`<link rel="canonical" href="${attr(resolved.canonical)}">`);
    lines.push(`<meta property="og:url" content="${attr(resolved.canonical)}">`);
  }

  lines.push(
    `<meta property="og:title" content="${attr(resolved.title)}">`,
    `<meta property="og:description" content="${attr(resolved.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
  );

  if (resolved.image) {
    lines.push(
      `<meta property="og:image" content="${attr(resolved.image.url)}">`,
      `<meta property="og:image:alt" content="${attr(resolved.image.alt)}">`,
      `<meta property="og:image:width" content="${resolved.image.width}">`,
      `<meta property="og:image:height" content="${resolved.image.height}">`,
    );
  }

  lines.push(
    `<meta name="twitter:card" content="${resolved.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${attr(resolved.title)}">`,
    `<meta name="twitter:description" content="${attr(resolved.description)}">`,
  );

  if (resolved.image) {
    lines.push(`<meta name="twitter:image" content="${attr(resolved.image.url)}">`);
  }

  if (resolved.structuredData) {
    // `<` is escaped so a name containing "</script>" cannot close the tag.
    const json = JSON.stringify(resolved.structuredData).replace(/</g, "\\u003c");
    lines.push(`<script type="application/ld+json" id="${STRUCTURED_DATA_ID}">${json}</script>`);
  }

  return lines.join("\n    ");
}

/* ==========================================================================
   Page-specific metadata
   ========================================================================== */

/**
 * Structured data for a person.
 *
 * Deliberately conservative: it states name, offices held and the page URL. It
 * does NOT emit `sameAs` links to sources, because that would assert Javora has
 * confirmed the association. Returns null entirely while the dataset is a
 * demonstration, so no search engine is handed sample data marked up as fact.
 */
export function personStructuredData(
  input: { name: string; path: string; description: string | null; jobTitle: string | null },
  origin: string = SITE_ORIGIN,
): Record<string, unknown> | null {
  if (DATASET.mode === "demonstration") return null;

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    url: `${origin}${input.path}`,
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
    ...(input.description ? { description: input.description } : {}),
  };
}

/** A short, factual description for a person page. Never evaluative. */
export function personDescription(input: {
  name: string;
  headline: string | null;
  party: string | null;
}): string {
  const parts = [input.name];
  if (input.headline) parts.push(input.headline);
  if (input.party) parts.push(input.party);
  const summary = parts.join(" — ");
  return DATASET.mode === "demonstration"
    ? `${summary}. Demonstration record on SL Politics; not verified against an official source.`
    : `${summary}. Source-linked public record on SL Politics.`;
}
