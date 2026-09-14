/**
 * Javora — public route manifest.
 *
 * This list decides what gets prerendered and what search engines are told
 * exists. Its failure modes are all silent: a duplicate URL, a person with no
 * page, an unescaped path, or an order that churns between builds. None of
 * them throw, and none are visible without looking at the generated files.
 */

import { describe, it, expect } from "vitest";
import { prerenderRoutes, sitemapRoutes } from "./routeManifest.ts";
import { allPeople } from "../services/repository.ts";
import { IDENTITY_OVERRIDES } from "../data/identityOverrides.ts";

const TODAY = new Date("2026-08-30T00:00:00.000Z");

describe("prerenderRoutes", () => {
  const routes = prerenderRoutes(TODAY);

  it("covers the fixed pages", () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/government");
    expect(paths).toContain("/directory");
    expect(paths).toContain("/corrections");
  });

  it("gives every person in the dataset a page", () => {
    const people = allPeople(TODAY).filter((view) => view.person.slug);
    const live = new Set(people.map((view) => `/person/${encodeURIComponent(view.person.slug)}`));
    const personRoutes = routes.filter((route) => route.path.startsWith("/person/"));
    // Every living slug has a page, and nothing is missing from that set.
    expect(personRoutes.filter((route) => live.has(route.path))).toHaveLength(people.length);
  });

  it("also writes a page for the retired /politician/harsha-de-silva route", () => {
    // Kept resolving rather than deleted — see LEGACY_ROUTES in
    // routeManifest.ts and PersonPage.jsx's PortfolioPersonPage.
    const paths = routes.map((route) => route.path);
    expect(paths).toContain("/politician/harsha-de-silva");
  });

  it("also writes a page for every retired slug", () => {
    // A retired slug is a URL this site published and still honours. Resolving
    // it in getPersonBySlug is not enough — on a static host the old address
    // needs a FILE, or it 404s for exactly the people holding the old link.
    const paths = routes.map((route) => route.path);
    for (const slug of IDENTITY_OVERRIDES.flatMap((o) => o.retiredSlugs)) {
      expect(paths).toContain(`/person/${encodeURIComponent(slug)}`);
    }
  });

  it("emits no duplicate URLs", () => {
    // Two entries for one path means one file overwrites the other and the
    // sitemap advertises the same page twice.
    const paths = routes.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("is deterministic across calls", () => {
    // Two builds of the same dataset must produce byte-identical output, or
    // every deploy looks like a content change to anything watching.
    expect(prerenderRoutes(TODAY).map((r) => r.path)).toEqual(routes.map((r) => r.path));
  });

  it("emits paths that are absolute and URL-safe", () => {
    for (const route of routes) {
      expect(route.path.startsWith("/")).toBe(true);
      // A raw space or "#" in a path would break both the file write and the
      // sitemap entry. encodeURIComponent in the manifest should prevent it.
      expect(route.path).not.toMatch(/[\s#?]/);
    }
  });

  it("keeps priority within the range sitemap.xml defines", () => {
    for (const route of routes) {
      expect(route.priority).toBeGreaterThanOrEqual(0);
      expect(route.priority).toBeLessThanOrEqual(1);
    }
  });
});

describe("sitemapRoutes", () => {
  it("excludes the corrections form", () => {
    // It is prerendered so it works without JavaScript, but it has no content
    // of its own and would be a dead end in search results.
    expect(sitemapRoutes(TODAY).map((r) => r.path)).not.toContain("/corrections");
  });

  it("excludes retired person slugs", () => {
    // Honoured, not advertised: each retired page names the current slug as
    // canonical, so submitting it too would offer two addresses for one
    // profile and undo that.
    const paths = sitemapRoutes(TODAY).map((r) => r.path);
    for (const slug of IDENTITY_OVERRIDES.flatMap((o) => o.retiredSlugs)) {
      expect(paths).not.toContain(`/person/${encodeURIComponent(slug)}`);
    }
  });

  it("excludes the retired /politician/harsha-de-silva route", () => {
    // Same reasoning as retired person slugs: honoured, not advertised — the
    // page names /person/harsha-de-silva canonical.
    expect(sitemapRoutes(TODAY).map((r) => r.path)).not.toContain("/politician/harsha-de-silva");
  });

  it("is otherwise the prerendered set", () => {
    // Prerendered minus the corrections form, minus every retired slug,
    // minus the retired /politician/harsha-de-silva route, minus every
    // confirmed-deceased person's profile (none, today — see the dedicated
    // "excludes a confirmed deceased person" test below for the mechanism).
    const retired = IDENTITY_OVERRIDES.flatMap((o) => o.retiredSlugs).length;
    const deceased = allPeople(TODAY).filter((view) => view.vitalStatus === "deceased").length;
    expect(sitemapRoutes(TODAY)).toHaveLength(prerenderRoutes(TODAY).length - 1 - retired - 1 - deceased);
  });

  it("excludes a confirmed deceased person's profile while prerenderRoutes keeps it", () => {
    // Nobody in today's real dataset has a recorded death (see
    // deceasedExclusion.test.ts for the mechanism, exercised with a mocked
    // source record), so this documents the invariant structurally: IF a
    // person is deceased, their route is absent from the sitemap but present
    // in prerenderRoutes — the same "honoured, not advertised" split used for
    // retired slugs above.
    const deceasedRoutes = allPeople(TODAY)
      .filter((view) => view.vitalStatus === "deceased")
      .map((view) => `/person/${encodeURIComponent(view.person.slug)}`);
    const sitemapPaths = new Set(sitemapRoutes(TODAY).map((r) => r.path));
    const prerenderedPaths = new Set(prerenderRoutes(TODAY).map((r) => r.path));
    for (const path of deceasedRoutes) {
      expect(sitemapPaths.has(path)).toBe(false);
      expect(prerenderedPaths.has(path)).toBe(true);
    }
  });

  it("stays within a single sitemap file", () => {
    // sitemaps.org caps one file at 50,000 URLs. Past that the build must emit
    // a sitemap index instead, and this test is the reminder.
    expect(sitemapRoutes(TODAY).length).toBeLessThan(50_000);
  });
});
