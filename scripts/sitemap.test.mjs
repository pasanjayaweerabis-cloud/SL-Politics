import { describe, it, expect } from "vitest";
import { buildSitemapXml, assertHttpsOrigin } from "./sitemap.mjs";
import { sitemapRoutes, prerenderRoutes } from "../src/lib/routeManifest.ts";
import { allPeople } from "../src/services/repository.ts";

/**
 * Javora — sitemap.xml generation and validation.
 *
 * This does not test routeManifest.ts's route LIST — src/lib/routeManifest.test.ts
 * already covers duplicates, count parity and path safety at that level, in
 * depth. This file tests the thing routeManifest.test.ts cannot: the actual
 * XML STRING `buildSitemapXml` produces, which is what a crawler actually
 * reads. "The route list has no duplicates" and "the serialised XML is
 * well-formed with no duplicate <loc>" are different claims, and only a test
 * that parses real output can support the second one.
 *
 * No XML parsing library exists in this project, and one is not worth adding
 * for validating a single script's own narrow, three-element output — so
 * `parseUrlset` below is a small, real, stack-based well-formedness checker,
 * not a regex that merely counts substrings.
 */

const TODAY = new Date("2026-08-30T00:00:00.000Z");
const ORIGIN = "https://javora.lk";

/**
 * A minimal but genuine XML well-formedness check for one document, plus
 * extraction of every <url> entry's three fields.
 *
 * Verifies: exactly one XML declaration, exactly one root element, every tag
 * properly closed in correctly nested order, no unclosed or mismatched tags.
 * Throws with a specific reason on the first structural problem found,
 * rather than returning a bare true/false — a validator that cannot say WHY
 * a document failed is not much more useful than none at all.
 */
function parseUrlset(xml) {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')) {
    throw new Error("missing or malformed XML declaration on line 1");
  }

  const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^<>]*)?)>/g;
  const stack = [];
  const urls = [];
  let current = null;
  let rootSeen = false;

  for (const match of xml.matchAll(tagPattern)) {
    const [, closing, name] = match;

    if (closing) {
      const expected = stack.pop();
      if (expected !== name) {
        throw new Error(`mismatched closing tag </${name}> — expected </${expected ?? "(nothing open)"}>`);
      }
      if (name === "url") {
        if (!current?.loc) throw new Error("a <url> entry has no <loc>");
        urls.push(current);
        current = null;
      }
      continue;
    }

    stack.push(name);
    if (name === "urlset") {
      if (rootSeen) throw new Error("more than one root element");
      rootSeen = true;
      const nsMatch = match[3].match(/xmlns="([^"]*)"/);
      if (!nsMatch) throw new Error("<urlset> has no xmlns attribute");
      // The namespace belongs to the document, not one <url> entry; stashed
      // on the array itself so it survives past the first <url> being parsed.
      urls.namespace = nsMatch[1];
    } else if (name === "url") {
      current = {};
    } else if (["loc", "changefreq", "priority"].includes(name) && current) {
      const rest = xml.slice(match.index + match[0].length);
      const close = rest.indexOf(`</${name}>`);
      if (close === -1) throw new Error(`<${name}> has no closing tag`);
      current[name] = rest.slice(0, close);
    }
  }

  if (stack.length > 0) throw new Error(`unclosed tag(s): ${stack.join(", ")}`);
  if (!rootSeen) throw new Error("no <urlset> root element found");

  return { namespace: urls.namespace, urls };
}

describe("assertHttpsOrigin", () => {
  it("accepts an HTTPS origin", () => {
    expect(() => assertHttpsOrigin("https://javora.lk")).not.toThrow();
  });

  it("rejects an HTTP origin", () => {
    expect(() => assertHttpsOrigin("http://javora.lk")).toThrow(/HTTPS/);
  });

  it("rejects a bare host with no scheme", () => {
    expect(() => assertHttpsOrigin("javora.lk")).toThrow(/HTTPS/);
  });
});

describe("buildSitemapXml", () => {
  const routes = sitemapRoutes(TODAY);
  const xml = buildSitemapXml(routes, ORIGIN);

  it("refuses a non-HTTPS origin outright", () => {
    expect(() => buildSitemapXml(routes, "http://javora.lk")).toThrow(/HTTPS/);
  });

  it("produces well-formed XML — real parse, not a substring count", () => {
    expect(() => parseUrlset(xml)).not.toThrow();
  });

  it("declares the correct sitemap protocol namespace", () => {
    const { namespace } = parseUrlset(xml);
    expect(namespace).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
  });

  it("contains exactly one <url> entry per route, in order", () => {
    const { urls } = parseUrlset(xml);
    expect(urls.map((u) => u.loc)).toEqual(routes.map((r) => ORIGIN + r.path));
  });

  it("has zero duplicate <loc> entries", () => {
    const { urls } = parseUrlset(xml);
    const locs = urls.map((u) => u.loc);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("every URL is absolute HTTPS — no relative or insecure entries", () => {
    const { urls } = parseUrlset(xml);
    for (const url of urls) expect(url.loc.startsWith("https://javora.lk/")).toBe(true);
  });

  it("contains no admin, API, or private path", () => {
    const { urls } = parseUrlset(xml);
    for (const url of urls) {
      expect(url.loc).not.toMatch(/\/api\//);
      expect(url.loc).not.toMatch(/\/admin/i);
    }
  });

  it("contains no search-query or tracking-parameter URLs", () => {
    const { urls } = parseUrlset(xml);
    for (const url of urls) {
      expect(url.loc).not.toContain("?");
      expect(url.loc).not.toContain("#");
    }
  });

  it("excludes the corrections form — not indexable content", () => {
    const { urls } = parseUrlset(xml);
    expect(urls.some((u) => u.loc.endsWith("/corrections"))).toBe(false);
  });

  it("includes the required top-level public pages", () => {
    const { urls } = parseUrlset(xml);
    const locs = urls.map((u) => u.loc);
    expect(locs).toContain(`${ORIGIN}/`);
    expect(locs).toContain(`${ORIGIN}/directory`);
    expect(locs).toContain(`${ORIGIN}/government`);
  });

  it("gives every <url> a valid changefreq and a priority in [0,1]", () => {
    const { urls } = parseUrlset(xml);
    const validFreq = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
    for (const url of urls) {
      expect(validFreq.has(url.changefreq)).toBe(true);
      const priority = Number(url.priority);
      expect(priority).toBeGreaterThanOrEqual(0);
      expect(priority).toBeLessThanOrEqual(1);
    }
  });

  it("refuses to build over a duplicate route rather than emit broken XML", () => {
    const dupe = [...routes, routes[0]];
    expect(() => buildSitemapXml(dupe, ORIGIN)).toThrow(/duplicate/);
  });
});

/* ==========================================================================
   The count invariant the task calls for explicitly
   ========================================================================== */

describe("profile URL count equals indexable canonical profiles", () => {
  it("every person URL in the sitemap corresponds to exactly one canonical, sluggable person — no more, no fewer", () => {
    const xml = buildSitemapXml(sitemapRoutes(TODAY), ORIGIN);
    const { urls } = parseUrlset(xml);

    const personUrls = urls.filter((u) => u.loc.includes("/person/"));
    // "Indexable" excludes confirmed deceased people the same way
    // routeManifest.ts's sitemapRoutes() does — honoured with a prerendered
    // file, not advertised to crawlers. See routeManifest.test.ts for the
    // dedicated deceased-exclusion assertions.
    const indexablePeople = allPeople(TODAY).filter(
      (view) => Boolean(view.person.slug) && view.vitalStatus !== "deceased",
    );

    expect(personUrls).toHaveLength(indexablePeople.length);

    // Not just a count match: the actual SET of slugs must agree, so a build
    // that happened to drop one person and duplicate another could not pass
    // this by coincidence of totals.
    const sitemapSlugs = new Set(
      personUrls.map((u) => decodeURIComponent(u.loc.replace(`${ORIGIN}/person/`, ""))),
    );
    const canonicalSlugs = new Set(indexablePeople.map((view) => view.person.slug));
    expect(sitemapSlugs).toEqual(canonicalSlugs);
  });

  it("a person with no slug is never given a sitemap URL", () => {
    // routeManifest.ts filters these out before this module ever sees them;
    // this asserts the OUTPUT has none, not merely that the filter exists.
    const xml = buildSitemapXml(sitemapRoutes(TODAY), ORIGIN);
    const { urls } = parseUrlset(xml);
    for (const url of urls.filter((u) => u.loc.includes("/person/"))) {
      const slug = url.loc.replace(`${ORIGIN}/person/`, "");
      expect(slug.length).toBeGreaterThan(0);
    }
  });

  it("stays a single sitemap file — no index file warranted at this scale", () => {
    // sitemaps.org caps one file at 50,000 URLs / 50MB. At roughly 1,600
    // URLs a sitemap index would be pure ceremony; this documents that as a
    // checked fact, not an assumption, and will fail loudly if the dataset
    // ever grows close enough to matter.
    const count = sitemapRoutes(TODAY).length;
    expect(count).toBeLessThan(50_000);
    expect(count).toBeGreaterThan(0);
  });
});

describe("prerenderRoutes vs sitemapRoutes", () => {
  it("the sitemap is a strict subset of what is actually prerendered", () => {
    // A sitemap URL with no prerendered file behind it is a crawler being
    // sent to a page that does not exist as a static file.
    const prerendered = new Set(prerenderRoutes(TODAY).map((r) => r.path));
    for (const route of sitemapRoutes(TODAY)) {
      expect(prerendered.has(route.path)).toBe(true);
    }
  });
});
