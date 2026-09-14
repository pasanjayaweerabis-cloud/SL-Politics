import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import PersonPage from "./PersonPage.jsx";

/**
 * Javora — which layout /person/:slug renders.
 *
 * PersonPage dispatches on src/data/profileContent.ts: a slug with portfolio
 * content renders PortfolioProfile (the "hds-profile" markup); every other
 * slug keeps the tabbed layout unchanged. This is the regression these tests
 * guard: Harsha de Silva's profile used to render either the tabbed layout
 * (the original bug report) or, briefly in development, a third, differently
 * wired "decision-first" layout — see git history around profileContent.ts.
 * Only ONE slug is mapped today, so only ONE slug's rendering should differ.
 */

describe("PersonPage layout dispatch", () => {
  it("renders the portfolio profile for /person/harsha-de-silva", () => {
    const html = renderToString(<PersonPage slug="harsha-de-silva" />);
    expect(html).toContain("hds-profile");
    expect(html).toContain("Major programmes and interventions documented during");
    expect(html).toContain("Position and responsibilities");
  });

  it("still keeps the site's 'Back to Directory' affordance on the portfolio profile", () => {
    const html = renderToString(<PersonPage slug="harsha-de-silva" />);
    expect(html).toContain("profile-header__nav");
    expect(html).toContain('href="/directory"');
  });

  it("renders the ordinary tabbed layout for a different, real slug", () => {
    // A real, currently-imported member unrelated to the portfolio content
    // map — see src/services/__golden__/slugs.tsv.
    const html = renderToString(<PersonPage slug="karu-jayasuriya" route={{ search: "" }} />);
    expect(html).not.toContain("hds-profile");
    expect(html).toContain("section-card");
  });

  it("does not affect an unrelated slug even though it renders after harsha-de-silva", () => {
    // Guards against the resolver leaking state across renders (e.g. a
    // module-level cache keyed wrong) rather than being a pure per-slug map.
    renderToString(<PersonPage slug="harsha-de-silva" />);
    const html = renderToString(<PersonPage slug="karu-jayasuriya" route={{ search: "" }} />);
    expect(html).not.toContain("hds-profile");
  });
});

/**
 * The portfolio profile's structure: four tabs, ten sections in one
 * continuous order across them, six of them real tables, and a working
 * Details control on the interventions table. These pin the structure so a
 * future pass can't silently flatten it back into cards or reorder the
 * sections per tab, the same bug class the original restructure exists to
 * fix.
 *
 * What these tests DELIBERATELY no longer pin is the "Tier A / Tier B"
 * labelling and the 01-10 numerals that used to lead every heading. Those
 * were the research taxonomy the content was assembled under, printed as
 * the primary navigation of a public page; the UX pass replaced them with
 * labels that say what is inside each tab (see PROFILE_TABS in
 * PortfolioProfile.jsx) and with a per-tab jump row. The grouping, the
 * order, and every row of data are unchanged — which is exactly what the
 * tests below now assert, rather than the vocabulary that carried it.
 */
describe("PortfolioProfile — tab structure", () => {
  const html = () => renderToString(<PersonPage slug="harsha-de-silva" />);

  it("renders one tablist with the four tabs in order", () => {
    const out = html();
    const tablistMatches = out.match(/role="tablist"/g) ?? [];
    expect(tablistMatches).toHaveLength(1);

    const labelIndexes = ["Performance", "Decisions &amp; voting", "Policy positions", "Role &amp; career"]
      .map(label => out.indexOf(label));
    expect(labelIndexes.every(i => i !== -1)).toBe(true);
    expect([...labelIndexes]).toEqual([...labelIndexes].sort((a, b) => a - b));
  });

  it("shows no internal tier vocabulary to the reader", () => {
    // The regression this guards is the reverse of the old one: the four
    // groups must keep their reader-facing names rather than drifting back
    // to the taxonomy they were filed under.
    const out = html();
    for (const tier of ["Tier A", "Tier B", "Tier C", "Tier D"]) {
      expect(out).not.toContain(tier);
    }
  });

  it("gives each multi-section tab a jump link to every section it contains", () => {
    const out = html();
    // The per-tab "on this page" row: one real anchor per section, rendered
    // inside its own panel so every tab's row is in the prerendered HTML and
    // works without JavaScript. A tab with a single section renders no row —
    // one destination is not navigation — which is why the Policies tab's
    // own id is not in this list.
    for (const id of ["hds-outcomes", "hds-promises", "hds-votes", "hds-attribution", "hds-career", "hds-research"]) {
      expect(out).toContain(`href="#${id}"`);
    }
  });

  it("shows 'Portfolio at a glance' before the tablist", () => {
    const out = html();
    expect(out.indexOf("Portfolio at a glance")).toBeGreaterThan(-1);
    expect(out.indexOf("Portfolio at a glance")).toBeLessThan(out.indexOf('role="tablist"'));
  });

  it("orders the numbered sections 01-10 correctly within their tab panels", () => {
    const out = html();
    const panelIds = ["performance", "record", "policies", "profile"].map(id => `id="hds-tab-panel-${id}"`);
    const bounds = panelIds.map(marker => out.indexOf(marker));
    expect(bounds.every(i => i !== -1)).toBe(true);

    const sliceFor = index => {
      const start = bounds[index];
      const end = index + 1 < bounds.length ? bounds[index + 1] : out.indexOf('id="hds-sources"');
      return out.slice(start, end);
    };

    const performance = sliceFor(0);
    const record = sliceFor(1);
    const policies = sliceFor(2);
    const profile = sliceFor(3);

    const headingsInOrder = (slice, headings) => {
      const indexes = headings.map(h => slice.indexOf(h));
      expect(indexes.every(i => i !== -1)).toBe(true);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    };

    headingsInOrder(performance, [
      "Performance / outcome indicators",
      "Promises &amp; outcomes",
      "Major programmes and interventions documented during",
      "Programmes &amp; interventions",
    ]);
    headingsInOrder(record, ["Voting &amp; decision record", "Responsibility &amp; attribution"]);
    headingsInOrder(policies, ["Policies &amp; public positions"]);
    headingsInOrder(profile, [
      "Position and responsibilities",
      "Detailed position &amp; responsibilities",
      "Research notes &amp; historical context",
    ]);
  });

  it("anchors each of the ten sections exactly once, in one continuous order", () => {
    const out = html();
    // Replaces the old "prints 01-10 exactly once" assertion. Same guard,
    // without depending on the numerals: each section appears once (not
    // duplicated across panels) and the ten run in one order across the four
    // tabs rather than restarting per tab — which is what the numbering was
    // really pinning. These ids are also the page's deep-link targets, so a
    // duplicate or a reorder would break shared links too.
    const ids = [
      "hds-outcomes", "hds-promises", "hds-programmes", "hds-interventions",
      "hds-votes", "hds-attribution", "hds-policies", "hds-role", "hds-career",
      "hds-research",
    ];
    const positions = ids.map(id => {
      const marker = `<h2 id="${id}"`;
      const count = out.split(marker).length - 1;
      expect(count, `expected exactly one heading with id "${id}"`).toBe(1);
      return out.indexOf(marker);
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("labels an unresolved research citation instead of printing a bare token", () => {
    const out = html();
    // S1..S22 are references whose source records are not transcribed yet.
    // Rendered bare they read as a broken link; the page must say what they
    // are, and must still never link them.
    expect(out).toContain("Source pending");
  });

  it("states the record's own status above the tabs, not only at the foot", () => {
    const out = html();
    const glance = out.indexOf("Portfolio at a glance");
    const tablist = out.indexOf('role="tablist"');
    expect(glance).toBeGreaterThan(-1);
    expect(out.indexOf("Record status")).toBeGreaterThan(glance);
    expect(out.indexOf("Record status")).toBeLessThan(tablist);
  });

  it("renders at least six real tables", () => {
    const out = html();
    const tableCount = (out.match(/<table\b/g) ?? []).length;
    expect(tableCount).toBeGreaterThanOrEqual(6);
  });

  it("includes content from collapsed and hidden places in the prerendered HTML", () => {
    const out = html();
    // A research-note label (inside the closed Research notes <details>).
    expect(out).toContain("Evidence-backed strengths to investigate further");
    // A source organisation (inside the closed Evidence & sources <details>).
    expect(out).toContain("Parliament of Sri Lanka");
    // An education entry (inside the Profile tab's collapsed-by-default panel).
    expect(out).toContain("Truman State University");
    // pi1's linked indicator text, inside its hidden Details row.
    expect(out).toContain("1990 Suwa Seriya fleet");
  });

  it("never links an S1..S22 pending-citation token", () => {
    const out = html();
    const hrefs = [...out.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    const badHref = hrefs.find(h => /^#?S(1?[0-9]|2[0-2])$/.test(h) || /S(1?[0-9]|2[0-2])"/.test(h));
    expect(badHref).toBeUndefined();
  });

  it("renders 'No further detail' for interventions with no matched indicator (pi5, pi3)", () => {
    const out = html();
    const noFurther = out.split("No further detail").length - 1;
    // pi5 (hasDetails: false) and pi3 (hasDetails: true but no indicatorIds yet).
    expect(noFurther).toBeGreaterThanOrEqual(2);
  });
});
