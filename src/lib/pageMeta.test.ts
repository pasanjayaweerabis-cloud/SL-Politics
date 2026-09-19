import { describe, it, expect } from "vitest";
import { routeMeta, personMeta } from "./pageMeta.ts";
import { buildPageMeta } from "./seo.ts";
import { allPeople } from "../services/repository.ts";

/**
 * Javora — per-route indexability audit.
 *
 * Every public route, checked against the same four questions for each:
 * indexable, noindex, canonical, robots. This did not exist as an explicit,
 * enumerated test before — the correctness was real (seo.test.ts guards the
 * call SITES; this guards the RESULT each route actually produces), but
 * nothing stated the full matrix in one place the way an audit is supposed
 * to.
 *
 * THE RULE THIS FILE ENFORCES: noindex is applied to exactly the routes that
 * have no content of their own to show a search result for — a genuine 404,
 * or a profile URL matching no canonical record — and to nothing else. A
 * blanket noindex (an app-wide default that every real page has to opt out
 * of) is exactly what this suite would fail to find any evidence of, because
 * it checks each route's own resolved metadata, not a shared default.
 */

const TODAY = new Date("2026-06-01T00:00:00.000Z");

describe("indexable public routes", () => {
  const cases: Array<{ label: string; meta: ReturnType<typeof routeMeta> }> = [
    { label: "home", meta: routeMeta("home", {}, TODAY) },
    { label: "government", meta: routeMeta("government", {}, TODAY) },
    { label: "directory", meta: routeMeta("directory", {}, TODAY) },
    { label: "corrections", meta: routeMeta("corrections", {}, TODAY) },
  ];

  it.each(cases)("$label: is indexable, not noindex", ({ meta }) => {
    expect(meta.noindex).not.toBe(true);
  });

  it.each(cases)("$label: has a canonical path", ({ meta }) => {
    expect(meta.path).toBeTruthy();
    expect(meta.path).toMatch(/^\//);
  });

  it.each(cases)("$label: resolves to robots: index,follow", ({ meta }) => {
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.robots).toBe("index,follow");
  });

  it.each(cases)("$label: resolves to an absolute HTTPS canonical URL", ({ meta }) => {
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.canonical).toMatch(/^https:\/\/javora\.lk\//);
  });

  it.each(cases)("$label: has a non-empty, non-generic title", ({ meta }) => {
    expect(meta.title).toBeTruthy();
    expect(meta.title.toLowerCase()).not.toBe("page not found");
  });

  it("directory's canonical never carries a query string, regardless of active filters", () => {
    // routeMeta takes no filter state at all — the ONE canonical for
    // /directory is what every filtered view of it points back to, which is
    // what keeps a hundred filter combinations from being indexed as a
    // hundred separate pages of the same content.
    const meta = routeMeta("directory", {}, TODAY);
    expect(meta.path).toBe("/directory");
  });

  it("each indexable route has a DIFFERENT canonical path from every other", () => {
    const paths = cases.map((c) => c.meta.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("person routes", () => {
  const real = allPeople(TODAY).find((v) => Boolean(v.person.slug))!;

  it("a real person's profile is indexable with a matching canonical", () => {
    const meta = personMeta(real.person.slug, TODAY);
    expect(meta.noindex).not.toBe(true);
    expect(meta.path).toBe(`/person/${encodeURIComponent(real.person.slug)}`);
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.robots).toBe("index,follow");
    expect(resolved.canonical).toBe(`https://javora.lk/person/${encodeURIComponent(real.person.slug)}`);
  });

  it("a real person's title names them, not a generic fallback", () => {
    const meta = personMeta(real.person.slug, TODAY);
    expect(meta.title).toBe(real.person.canonicalName);
  });

  it("a real person's profile carries Person JSON-LD naming only what SL Politics actually holds", () => {
    const meta = personMeta(real.person.slug, TODAY);
    expect(meta.structuredData).toBeTruthy();
    expect((meta.structuredData as Record<string, unknown>)["@type"]).toBe("Person");
    expect((meta.structuredData as Record<string, unknown>).name).toBe(real.person.canonicalName);
  });

  it("an UNMATCHED slug is noindex — a soft-404, not indexable content", () => {
    const meta = personMeta("no-such-person-at-all-xyz", TODAY);
    expect(meta.noindex).toBe(true);
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.robots).toBe("noindex,follow");
  });

  it("an unmatched slug carries no Person structured data — nothing to assert about someone who does not exist", () => {
    const meta = personMeta("no-such-person-at-all-xyz", TODAY);
    expect(meta.structuredData).toBeFalsy();
  });

  it("EVERY real person in the dataset resolves to an indexable, self-consistent profile", () => {
    // Not one example — every sluggable person, so a single malformed record
    // cannot hide behind a spot check the way it could in a five-person test.
    const people = allPeople(TODAY).filter((v) => Boolean(v.person.slug));
    const bad: string[] = [];

    for (const view of people) {
      const meta = personMeta(view.person.slug, TODAY);
      const resolved = buildPageMeta(meta, "https://javora.lk");
      const ok =
        meta.noindex !== true &&
        resolved.robots === "index,follow" &&
        resolved.canonical === `https://javora.lk/person/${encodeURIComponent(view.person.slug)}` &&
        // The title must NAME this person — but need not equal the plain
        // canonical name exactly. A person sharing their name with another
        // real, distinct person gets a "(from <year>)" suffix appended (see
        // "duplicate-name disambiguation" below) so two different people do
        // not publish an identical <title>; `.includes` accepts that case
        // without weakening the check for everyone else.
        meta.title.includes(view.person.canonicalName);
      if (!ok) bad.push(view.person.slug);
    }

    expect(bad, `${bad.length} profile(s) failed the audit: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
});

/**
 * The one profile with its own share card — see
 * docs/design/share-card-philosophy.md and the "Wiring og:image" section of
 * docs/prompts/portfolio-and-shared-visuals-toasts-prompt.md. Both the canonical
 * `/person/harsha-de-silva` route and the retired `/politician/harsha-de-silva`
 * alias resolve through this same `personMeta("harsha-de-silva", ...)` call
 * (see routeMeta's "harsha-de-silva-profile" case above), so one assertion
 * here covers both routes' prerendered `<head>`.
 */
describe("Harsha de Silva's share card", () => {
  it("carries its own og:image, not the sitewide default", () => {
    const meta = personMeta("harsha-de-silva", TODAY);
    expect(meta.image).toEqual({
      path: "/og/harsha-de-silva.png",
      alt: "SL Politics — Harsha de Silva, public record",
    });
  });

  it("resolves to the exact card URL the build is expected to publish", () => {
    const meta = personMeta("harsha-de-silva", TODAY);
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.image?.url).toBe("https://javora.lk/og/harsha-de-silva.png");
  });

  it("an unrelated real person gets the sitewide default card, not Harsha's", () => {
    const other = allPeople(TODAY).find((v) => v.person.slug && v.person.slug !== "harsha-de-silva")!;
    const meta = personMeta(other.person.slug, TODAY);
    expect(meta.image).toBeUndefined();
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.image?.url).toBe("https://javora.lk/og/default.png");
  });
});

describe("not-found route", () => {
  it("is noindex, and carries no canonical to advertise", () => {
    const meta = routeMeta("not-found" as never, {}, TODAY);
    expect(meta.noindex).toBe(true);
    // A 404 has nothing at this URL; a canonical would assert that
    // something does. `path` is intentionally absent for this route.
    expect(meta.path).toBeUndefined();
  });

  it("resolves to robots: noindex,follow and no canonical link", () => {
    const meta = routeMeta("not-found" as never, {}, TODAY);
    const resolved = buildPageMeta(meta, "https://javora.lk");
    expect(resolved.robots).toBe("noindex,follow");
    expect(resolved.canonical).toBeNull();
  });
});

describe("noindex is not applied blanket", () => {
  it("at most the two known soft-404 cases are noindex — nothing else", () => {
    const indexableRoutes: Array<[string, Record<string, string>]> = [
      ["home", {}], ["government", {}], ["directory", {}], ["corrections", {}],
    ];
    for (const [name, params] of indexableRoutes) {
      const meta = routeMeta(name as never, params, TODAY);
      expect(meta.noindex, `"${name}" must not be noindex`).not.toBe(true);
    }

    const real = allPeople(TODAY).find((v) => Boolean(v.person.slug))!;
    expect(personMeta(real.person.slug, TODAY).noindex).not.toBe(true);
  });
});

/**
 * Javora — duplicate-title disambiguation.
 *
 * A real defect found by an exhaustive audit of all 1,624 profiles, not a
 * hypothetical: three pairs of historical MPs — decades apart, never in
 * office at the same time — happen to share an identical name, which
 * produced byte-identical <title>, og:title and JSON-LD `name` on two
 * distinct URLs. Fixed by appending the year each person's earliest recorded
 * position began — drawn only from their own already-verified dates, never
 * invented — to the TITLE only, leaving the page's own heading and the
 * structured data's `name` field as the plain name.
 */
describe("duplicate-name disambiguation", () => {
  // Real collisions in the canonical dataset as of this test's writing.
  // If the underlying data changes such that these three no longer collide,
  // that is a legitimate data correction, not a reason to weaken this test —
  // update the pairs to whatever the audit currently finds duplicated.
  const KNOWN_COLLISIONS: Array<[string, string]> = [
    ["ratnayake-mudiyanselage-appuhamy", "ratnayake-mudiyanselage-appuhamy-3209"],
    ["somaweera-chandrasiri", "somaweera-chandrasiri-3011"],
    ["alexander-francis-molamure", "alexander-francis-molamure-2475"],
  ];

  it.each(KNOWN_COLLISIONS)("gives %s and %s distinct titles", (slugA, slugB) => {
    const a = personMeta(slugA, TODAY);
    const b = personMeta(slugB, TODAY);
    expect(a.title).not.toBe(b.title);
  });

  it.each(KNOWN_COLLISIONS)("still names the real person within %s's disambiguated title", (slug) => {
    const view = allPeople(TODAY).find((v) => v.person.slug === slug)!;
    const meta = personMeta(slug, TODAY);
    expect(meta.title).toContain(view.person.canonicalName);
    expect(meta.title).toMatch(/\(from \d{4}\)$/);
  });

  it("structured data keeps the PLAIN name, not the disambiguated title", () => {
    // schema.org's Person.name should be the actual name, not a
    // Javora-specific "(from 1972)" title-tag disambiguator.
    for (const [slug] of KNOWN_COLLISIONS) {
      const view = allPeople(TODAY).find((v) => v.person.slug === slug)!;
      const meta = personMeta(slug, TODAY);
      expect((meta.structuredData as Record<string, unknown>).name).toBe(view.person.canonicalName);
    }
  });

  it("an ordinary, unambiguous name is never disambiguated", () => {
    const unique = allPeople(TODAY).find(
      (v) => v.person.canonicalName === "Harini Amarasuriya",
    )!;
    const meta = personMeta(unique.person.slug, TODAY);
    expect(meta.title).toBe("Harini Amarasuriya");
    expect(meta.title).not.toMatch(/\(from \d{4}\)/);
  });

  it("no two DIFFERENT people share an identical title across the whole dataset", () => {
    // The exhaustive version of the two tests above: every sluggable person,
    // not a fixed list of three pairs, so a NEW collision introduced by
    // future data cannot hide from this test the way it hid from every
    // earlier step of this project.
    const people = allPeople(TODAY).filter((v) => Boolean(v.person.slug));
    const titleToSlug = new Map<string, string>();
    const collisions: string[] = [];

    for (const view of people) {
      const title = personMeta(view.person.slug, TODAY).title;
      const existing = titleToSlug.get(title);
      if (existing && existing !== view.person.slug) {
        collisions.push(`"${title}": ${existing} & ${view.person.slug}`);
      } else {
        titleToSlug.set(title, view.person.slug);
      }
    }

    expect(collisions, `duplicate titles found:\n${collisions.join("\n")}`).toEqual([]);
  });
});
