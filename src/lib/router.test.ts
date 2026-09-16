import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchRoute, legacyRedirect } from "./router.tsx";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("matchRoute", () => {
  it("matches the homepage", () => {
    expect(matchRoute("/").name).toBe("home");
    expect(matchRoute("").name).toBe("home");
  });

  it("matches static routes", () => {
    expect(matchRoute("/directory").name).toBe("directory");
    expect(matchRoute("/corrections").name).toBe("corrections");
  });

  it("captures a person slug", () => {
    const route = matchRoute("/person/anura-kumara-dissanayake");
    expect(route.name).toBe("person");
    expect(route.params.slug).toBe("anura-kumara-dissanayake");
  });

  it("keeps the route table to the core Home / Directory / Person / Corrections loop", () => {
    // Javora deliberately does not have standalone Parties, Elections or
    // Sources pages — that information lives inside the directory filters and
    // each person's profile instead.
    expect(matchRoute("/parties").name).toBe("not-found");
    expect(matchRoute("/elections").name).toBe("not-found");
    expect(matchRoute("/sources").name).toBe("not-found");
    expect(matchRoute("/sources/S001").name).toBe("not-found");
  });

  it("decodes percent-encoded parameters", () => {
    expect(matchRoute("/person/a%2Fb").params.slug).toBe("a/b");
  });

  it("tolerates trailing slashes", () => {
    expect(matchRoute("/directory/").name).toBe("directory");
  });

  it("resolves an unknown path to not-found, never to the homepage", () => {
    expect(matchRoute("/nope").name).toBe("not-found");
    expect(matchRoute("/person").name).toBe("not-found");
    expect(matchRoute("/a/b/c/d").name).toBe("not-found");
  });

  it("preserves the query string on the route", () => {
    expect(matchRoute("/directory", "?party=npp").search).toBe("?party=npp");
  });
});

describe("legacyRedirect", () => {
  it("migrates a legacy profile URL to the canonical person URL", () => {
    expect(legacyRedirect("/profile", "?id=sajith-premadasa"))
      .toBe("/person/sajith-premadasa");
  });

  it("sends a profile URL with no id to the directory rather than 404", () => {
    expect(legacyRedirect("/profile", "")).toBe("/directory");
  });

  it("migrates legacy .html paths", () => {
    expect(legacyRedirect("/directory.html", "")).toBe("/directory");
    expect(legacyRedirect("/index.html", "")).toBe("/");
  });

  it("sends the removed Parties/Elections/Sources pages to the directory instead of a dead link", () => {
    expect(legacyRedirect("/parties", "")).toBe("/directory");
    expect(legacyRedirect("/elections", "")).toBe("/directory");
    expect(legacyRedirect("/sources", "")).toBe("/directory");
    expect(legacyRedirect("/sources/S001", "")).toBe("/directory");
    expect(legacyRedirect("/sources.html", "")).toBe("/directory");
  });

  it("leaves canonical URLs alone", () => {
    expect(legacyRedirect("/person/x", "")).toBeNull();
    expect(legacyRedirect("/directory", "?q=a")).toBeNull();
    expect(legacyRedirect("/", "")).toBeNull();
    expect(legacyRedirect("/corrections", "")).toBeNull();
  });
});

/**
 * Javora — the scroll on a route change must JUMP, not animate.
 *
 * A source-level assertion, which is unusual here and earned. The bug it
 * pins was invisible to every other kind of test and looked correct in
 * review: `window.scrollTo({ top: 0, behavior: "auto" })` reads as "scroll
 * instantly", but in a ScrollToOptions "auto" means "use this element's CSS
 * scroll-behavior" — and base.css sets `html { scroll-behavior: smooth }`
 * site-wide so that in-page anchor jumps glide. So the one call written to
 * opt OUT of smooth scrolling was the one inheriting it: measured from
 * scrollY 1600, `behavior: "auto"` left scrollY at 1600 on the next line and
 * only reached 0 several hundred milliseconds later, which animated a long
 * scroll up through the page the reader had just left, made the view
 * transition below capture its "after" snapshot at the OLD offset, and on a
 * back navigation raced the browser's own restoration to land between the
 * two.
 *
 * Nothing observable from a unit test distinguishes the two values — there
 * is no DOM here to scroll — so the guard is the source itself, plus the CSS
 * declaration that is the whole reason "auto" is wrong.
 */
describe("route-change scroll", () => {
  /*
   * Comments stripped first. The prose above `window.scrollTo` in router.tsx
   * has to name the wrong value in order to explain why it is wrong, and a
   * naive search of the raw file would read that explanation as the defect
   * it warns about.
   */
  const codeOnly = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const router = codeOnly(readFileSync(join(HERE, "router.tsx"), "utf8"));
  const base = readFileSync(join(HERE, "..", "styles", "base.css"), "utf8");

  it("scrolls with behavior: \"instant\"", () => {
    expect(router).toMatch(/window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*"instant"\s*\}\)/);
  });

  it("never passes behavior: \"auto\", which defers to the smooth CSS default", () => {
    expect(router).not.toMatch(/behavior:\s*"auto"/);
  });

  it("is guarding against a real global default, not a hypothetical one", () => {
    // If this ever stops being true the rule above can be revisited — until
    // then "auto" and "instant" are genuinely different behaviours here.
    expect(base).toMatch(/html\s*\{[^}]*scroll-behavior:\s*smooth/);
  });

  it("leaves a back/forward navigation's scroll position to the browser", () => {
    // The other half of the fix: following a link starts at the top (or, if
    // the new URL also carries a hash, at that section — see the next test),
    // pressing Back resumes where the reader was. See `poppedHistory`.
    expect(router).toMatch(/if\s*\(!poppedHistory\)\s*\{/);
    expect(router).toMatch(/poppedHistory = true;/);
  });

  it("scrolls to a route-change link's hash target instead of the top, when the new page has one", () => {
    // A link to a new route can still carry a hash (`/about#methodology`) —
    // without this, a hydrated SPA navigation would silently ignore it and
    // land on the page's top, even though the exact same URL loaded fresh
    // (a crawler, or this link before hydration) lands on the right section.
    expect(router).toMatch(/document\.getElementById\(window\.location\.hash\.slice\(1\)\)/);
    expect(router).toMatch(/target\.scrollIntoView\(\{\s*behavior:\s*"instant"/);
  });
});
