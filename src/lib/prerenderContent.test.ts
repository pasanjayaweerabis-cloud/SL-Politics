import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { TabPanel } from "../components/Tabs.jsx";
import { ProfileResult, ProfileResultLink } from "../components/Primitives.jsx";
import App from "../App.jsx";
import { discoverablePeople, sortForDisplay, currentGovernment } from "../services/repository.ts";

/**
 * Javora — what a crawler actually receives.
 *
 * These pages are statically prerendered, so anything a component declines to
 * render at render time is simply absent from the HTML file search engines and
 * social unfurlers read. The whole point of prerendering is lost for that
 * content, silently, with no error and no visible symptom in a browser — where
 * hydration fills it in a moment later.
 *
 * THE BUG THIS EXISTS TO CATCH. `TabPanel` rendered `{selected ? children :
 * null}`, which is the natural thing to write and is correct for a purely
 * client-side app. Statically prerendered, it meant every politician profile
 * shipped with an EMPTY Political Career panel — the offices, terms and dates
 * that are the substance of the record were missing from the public HTML
 * entirely. The full 607-test suite passed throughout, because every test
 * either exercised the client behaviour (where the tab works fine) or checked
 * the route list rather than the rendered output.
 */

describe("TabPanel renders content regardless of selection", () => {
  const panel = (id: string, active: string) =>
    renderToString(
      React.createElement(
        TabPanel as never,
        { id, active },
        React.createElement("p", null, `content of ${id}`),
      ),
    );

  it("renders the ACTIVE panel's children", () => {
    expect(panel("political", "political")).toContain("content of political");
  });

  it("renders the INACTIVE panel's children too — this is the regression", () => {
    // Statically prerendered, an inactive panel that renders nothing is
    // content permanently missing from the public HTML.
    const html = panel("political", "education");
    expect(html).toContain("content of political");
  });

  it("marks the inactive panel hidden, so it is hidden from view and from the a11y tree", () => {
    // Content present but `hidden` is the correct WAI-ARIA tabs pattern, and
    // is what keeps this progressive enhancement rather than cloaking: a
    // reader reaches the same content by clicking the tab.
    const html = panel("political", "education");
    expect(html).toMatch(/hidden=""|hidden(?=[\s>])/);
  });

  it("does not mark the active panel hidden", () => {
    expect(panel("political", "political")).not.toMatch(/hidden=""/);
  });
});

/**
 * The same class of bug, found in server/api-neighbouring code: the
 * Directory page revealed profiles progressively via a "Show more" button by
 * SLICING the results array before mapping it to cards — `page.items`, not
 * `results`. Statically prerendered, that meant only the first 12 of ~1,624
 * profiles had a real `<a href="/person/...">` anywhere in the Directory's
 * HTML; the other ~1,600 had no crawlable link from that page at all,
 * discoverable only via the sitemap or by clicking "Show more" repeatedly
 * with JavaScript running.
 *
 * The fix mirrors TabPanel exactly: every result renders a real anchor, and
 * `hidden` — not array slicing — controls what "Show more" reveals.
 */
describe("ProfileResult renders a real anchor regardless of hidden", () => {
  const view = {
    person: { id: "p1", slug: "test-person", canonicalName: "Test Person" },
    verification: "source-linked",
    partyId: null,
    partyLabel: null,
    districtLabel: null,
    serving: true,
    headline: null,
  };

  it("renders a real <a href> to the profile when visible", () => {
    const html = renderToString(React.createElement(ProfileResult, { view }));
    expect(html).toContain('href="/person/test-person"');
  });

  it("STILL renders the same <a href> when hidden — this is the regression", () => {
    // A component that renders nothing when hidden is exactly the bug: no
    // link exists in the static HTML for a crawler to find at all.
    const html = renderToString(React.createElement(ProfileResult, { view, hidden: true }));
    expect(html).toContain('href="/person/test-person"');
  });

  it("marks a hidden card with the hidden attribute, not by omitting it", () => {
    const html = renderToString(React.createElement(ProfileResult, { view, hidden: true }));
    expect(html).toMatch(/hidden=""|hidden(?=[\s>])/);
  });
});

/**
 * `ProfileResultLink` is the cheap stand-in DirectoryPage renders past the
 * "Show more" threshold instead of a full `ProfileResult` (see the comment on
 * `ProfileResultLink` in Primitives.jsx for the measured cost difference).
 * The bug class above — content silently missing from prerendered HTML —
 * applies just as much to this component as to `ProfileResult`: it exists
 * ONLY to be hidden, so if it ever rendered without the link, or without
 * `hidden`, the regression would be invisible in a live browser (hydration
 * fixes nothing here, `shown` already reveals a REAL ProfileResult for
 * visible cards) and would only show up as a missing crawlable link in the
 * static HTML.
 */
/**
 * The homepage UX build (homepage-ux-fixes-prompt.md) requires the hero's
 * headline, its "Try:" chips, its scroll cue, and the browse-the-directory
 * tiles to all be real content in the STATIC HTML — this renders the whole
 * home route the same way the prerender build does (`App` with an
 * `ssrRoute`, exactly what entry-server.jsx's `renderPage` calls) rather
 * than mounting `HomeHero` in isolation, so a regression in how
 * HomePage.jsx wires props to it, or in Chrome.jsx's route-based nav, would
 * show up here too.
 */
describe("Home hero + header render real content in the static HTML", () => {
  const today = new Date();
  const homeRoute = { name: "home" as const, params: {}, path: "/", search: "" };
  const html = () => renderToString(React.createElement(App, { ssrRoute: homeRoute }));

  it("renders the one <h1> with the hero headline", () => {
    const out = html();
    expect(out).toMatch(/<h1[^>]*>/);
    expect(out).toContain("Who holds power in");
    expect(out).toContain("Sri Lanka");
    expect(out).toContain("recorded.");
  });

  it("renders all four primary nav links as real anchors", () => {
    const out = html();
    for (const href of ["/", "/government", "/directory", "/about"]) {
      expect(out).toContain(`href="${href}"`);
    }
    // "Directory" and "Institutions" share a destination — see the comment
    // in Chrome.jsx on why "Institutions" has no route of its own — so this
    // only asserts the distinct hrefs, not a count of five anchors.
  });

  it("renders the two category 'Try:' chips as real anchors", () => {
    const out = html();
    for (const href of ["/directory?role=cabinet-minister", "/directory?role=member-of-parliament"]) {
      expect(out).toContain(`href="${href}"`);
    }
  });

  it("renders the President/PM 'Try:' chips with real names from the data, not a static role link", () => {
    // Reads the SAME derivation HomePage.jsx feeds the hero, so this fails if
    // either diverges from `currentGovernment()` — never a hardcoded name.
    const gov = currentGovernment(today);
    const out = html();
    if (gov.president) {
      expect(out).toContain(`href="/person/${encodeURIComponent(gov.president.slug)}"`);
      expect(out).toContain(gov.president.name);
    } else {
      expect(out).toContain('href="/directory?role=president"');
    }
    if (gov.primeMinister) {
      expect(out).toContain(`href="/person/${encodeURIComponent(gov.primeMinister.slug)}"`);
      expect(out).toContain(gov.primeMinister.name);
    } else {
      expect(out).toContain('href="/directory?role=prime-minister"');
    }
  });

  it("renders the scroll cue pointing at a real section id on the page", () => {
    const out = html();
    expect(out).toContain('href="#current-government"');
    expect(out).toMatch(/id="current-government"/);
  });

  it("renders the browse-the-directory tiles as real anchors, not a 6-card profile preview", () => {
    const out = html();
    // React escapes `&` to `&amp;` in serialized attribute values.
    for (const href of [
      "/directory?role=cabinet-minister",
      "/directory?role=member-of-parliament&amp;status=serving",
      "/directory?role=member-of-parliament&amp;status=former",
      "/directory",
    ]) {
      expect(out).toContain(`href="${href}"`);
    }
  });

  it("does not contain the copy this build removed", () => {
    const out = html();
    expect(out).not.toContain("Popular searches");
    expect(out).not.toContain("Trusted data");
    expect(out).not.toContain("A more informed Sri Lanka");
  });
});

/**
 * Javora — one search entry point on the homepage (homepage-ux-fixes-prompt.md
 * Task 6). The nav's search icon and the hero's own big search field sat
 * directly on top of each other on `/`, going to two different experiences
 * (`/directory#search` vs. the in-page typeahead). Every other route keeps
 * the nav icon, since it is the only search entry point there.
 */
describe("nav search icon is homepage-only", () => {
  const render = (route: { name: string; params: object; path: string; search: string }) =>
    renderToString(React.createElement(App, { ssrRoute: route }));
  // The mobile drawer (closed by default) does not render its body into the
  // static HTML at all — see `rendered` in Primitives.jsx's Drawer, an
  // existing progressive-enhancement pattern this test doesn't change — so
  // the nav bar's own icon-button is the only source of this href here.
  const searchHrefCount = (out: string) => (out.match(/href="\/directory#search"/g) ?? []).length;

  it("is absent from the nav bar on the home route", () => {
    const homeRoute = { name: "home", params: {}, path: "/", search: "" };
    expect(searchHrefCount(render(homeRoute))).toBe(0);
  });

  it("is present in the nav bar on another route, e.g. the directory", () => {
    const directoryRoute = { name: "directory", params: {}, path: "/directory", search: "" };
    expect(searchHrefCount(render(directoryRoute))).toBe(1);
  });
});

describe("ProfileResultLink always renders its anchor, hidden", () => {
  const view = {
    person: { id: "p1", slug: "test-person", canonicalName: "Test Person" },
  };

  it("renders a real <a href> to the profile", () => {
    const html = renderToString(React.createElement(ProfileResultLink, { view }));
    expect(html).toContain('href="/person/test-person"');
  });

  it("is always hidden — this stand-in is never the visible state", () => {
    const html = renderToString(React.createElement(ProfileResultLink, { view }));
    expect(html).toMatch(/hidden=""|hidden(?=[\s>])/);
  });
});

/**
 * Javora — a person profile's heading outline must not skip a level.
 *
 * Heading level is how a screen-reader user moves through a long document,
 * and a profile is this site's longest and most important one: an official
 * overview, education, professional experience, every political office held,
 * a party history, a timeline and the sources behind all of it.
 *
 * THE BUG THIS EXISTS TO CATCH. Every one of those sections was marked up as
 * `<h3>`, with their entries as `<h4>`, under the person's `<h1>` name — so
 * all 1,623 profiles shipped an outline of h1 → h3 → h4 with no `<h2>`
 * anywhere except the site footer. Nothing looked wrong: the headings were
 * styled by class and rendered at exactly the intended sizes, so the defect
 * was invisible in a browser and invisible to every test that checked what
 * the page SAYS rather than how it is structured. Found by extracting the
 * outline from a built page.
 *
 * Asserted over the real rendered route rather than a component in
 * isolation, so the chrome's own headings (nav, footer) are part of the
 * sequence exactly as a reader's screen reader encounters them.
 */
describe("person profile heading outline", () => {
  const slug = sortForDisplay(discoverablePeople(new Date()), new Date())[0]!.person.slug;
  const route = { name: "person" as const, params: { slug }, path: `/person/${slug}`, search: "" };
  const html = renderToString(React.createElement(App, { ssrRoute: route }));
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

  it("renders exactly one h1 — the person's name", () => {
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
  });

  it("never jumps more than one level deeper than the heading before it", () => {
    const skips = levels
      .map((level, i) => ({ level, previous: levels[i - 1] ?? level }))
      .filter(({ level, previous }) => level - previous > 1);
    expect(skips).toEqual([]);
  });

  it("puts the record's sections at h2, directly under the name", () => {
    // The level that was missing. If SectionCard ever drops back to <h3>,
    // the skip check above fires too — this one names the cause.
    expect(levels).toContain(2);
    expect(html).toMatch(/<h2[^>]*>.*?Official Overview/s);
  });
});

/**
 * About-page cleanup (about-page-ux-fixes-prompt.md) — the contradictions
 * and repetition the audit found, pinned against the static HTML so they
 * cannot silently return. `isApiEnabled()` reads `VITE_API_URL`, which is
 * unset in the test environment, so this renders the DISCONNECTED
 * corrections branch — the one CLAUDE.md's honesty rule is strictest about.
 */
describe("About page: no contradictions, no repetition, honest disconnected state", () => {
  const aboutRoute = { name: "about" as const, params: {}, path: "/about", search: "" };
  const html = () => renderToString(React.createElement(App, { ssrRoute: aboutRoute }));

  it("does not repeat 'Official sources first' as both a section heading and a principle title", () => {
    const out = html();
    const occurrences = out.match(/Official sources first/g) ?? [];
    // Exactly once — the principle's own title. The section heading is now
    // "How records are sourced".
    expect(occurrences).toHaveLength(1);
    expect(out).toContain("How records are sourced");
  });

  it("states the update mechanism once, and does not say records update 'on a schedule'", () => {
    const out = html();
    expect(out).not.toContain("Records update on a schedule");
    expect(out).toContain("Records are refreshed when we re-check the official sources");
  });

  it("does not name the Election Commission as a source for anything shown", () => {
    // Zero bundled evidence records cite S002 (verified directly against
    // src/data/imported/*.json) — no displayed fact is Election-Commission
    // sourced, so the page must not claim otherwise.
    expect(html()).not.toContain("Election Commission");
  });

  it("uses the renamed 'Not published anywhere' label, not 'Not publicly verified'", () => {
    const out = html();
    expect(out).toContain("Not published anywhere");
    expect(out).not.toContain("Not publicly verified");
  });

  it("keeps the three anchor ids the footer/homepage and any bookmarked link depend on", () => {
    const out = html();
    for (const id of ["methodology", "labels", "limitations"]) {
      expect(out).toContain(`id="${id}"`);
    }
  });

  it("disconnected state: says reports aren't connected, and shows no 4-step workflow list", () => {
    const out = html();
    expect(out).toContain("Online reports aren’t connected yet.");
    expect(out).not.toContain("Under review");
    expect(out).not.toContain("Verified or rejected");
  });

  it("states the sources-in-use figure honestly, naming only the connected institutions", () => {
    const out = html();
    expect(out).toContain("Official sources in use");
    expect(out).toContain("Parliament of Sri Lanka");
    expect(out).toContain("Cabinet Office of Sri Lanka");
  });
});

/**
 * Footer once linked "How SL Politics works" (`/about`) and "Methodology"
 * (`/about#methodology`) side by side inside its own nav list — two links to
 * the same page for the same navigational purpose (About page cleanup, Task
 * 2d). Scoped to `.footer__nav` specifically, not the whole `<footer>`: the
 * brand mark beside it also links `/`, which is the ordinary "logo goes
 * home" pattern, not the repetition this guards against. Rendered on any
 * route, since the footer is in `Layout` and does not vary by page.
 */
describe("Footer: no two nav links point at the same URL", () => {
  it("every link inside .footer__nav is distinct", () => {
    const homeRoute = { name: "home" as const, params: {}, path: "/", search: "" };
    const out = renderToString(React.createElement(App, { ssrRoute: homeRoute }));
    const navStart = out.indexOf('class="footer__nav"');
    const navHtml = out.slice(navStart, out.indexOf("</nav>", navStart));
    const hrefs = [...navHtml.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
