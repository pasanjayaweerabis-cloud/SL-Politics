import { describe, it, expect } from "vitest";
import { buildRobotsTxt, PUBLIC_PATHS } from "./robots.mjs";
import { assertHttpsOrigin } from "./sitemap.mjs";

const ORIGIN = "https://javora.lk";

/**
 * A minimal robots.txt interpreter for THIS file's own generated output —
 * not a general-purpose parser, but real rule evaluation (longest-match-wins,
 * the actual algorithm crawlers use) rather than a substring search, so
 * "does this rule set block /person/" is answered the way a crawler would
 * answer it, not by how the text happens to look.
 */
function parseRobots(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const rules = []; // { type: 'allow'|'disallow', path }
  let sawUserAgentStar = false;
  const sitemaps = [];

  for (const line of lines) {
    if (/^User-agent:\s*\*/i.test(line)) sawUserAgentStar = true;
    const allow = line.match(/^Allow:\s*(\S*)/i);
    const disallow = line.match(/^Disallow:\s*(\S*)/i);
    const sitemap = line.match(/^Sitemap:\s*(\S+)/i);
    if (allow) rules.push({ type: "allow", path: allow[1] });
    if (disallow) rules.push({ type: "disallow", path: disallow[1] });
    if (sitemap) sitemaps.push(sitemap[1]);
  }

  if (!sawUserAgentStar) throw new Error("no 'User-agent: *' block found");

  /** Whether `path` is blocked, using the standard longest-matching-rule-wins algorithm. */
  function isBlocked(path) {
    let best = null;
    for (const rule of rules) {
      if (rule.path === "") continue; // an empty Disallow means "block nothing"
      if (path.startsWith(rule.path) && (!best || rule.path.length > best.path.length)) best = rule;
    }
    return best?.type === "disallow";
  }

  return { rules, sitemaps, isBlocked };
}

describe("buildRobotsTxt", () => {
  const text = buildRobotsTxt(ORIGIN);
  const parsed = parseRobots(text);

  it("declares User-agent: * with a real Allow: / rule", () => {
    expect(text).toMatch(/User-agent:\s*\*/);
    expect(parsed.isBlocked("/")).toBe(false);
  });

  it("does not block any of the required public paths", () => {
    // The exact list the task names explicitly, plus the paths those
    // prefixes are supposed to stand in for.
    const mustBeOpen = [
      "/", "/directory", "/government",
      "/person/", "/person/anura-kumara-dissanayake", "/person/harini-amarasuriya",
      "/corrections",
    ];
    for (const path of mustBeOpen) {
      expect(parsed.isBlocked(path), `"${path}" must not be blocked`).toBe(false);
    }
  });

  it("matches the PUBLIC_PATHS this module declares must stay open", () => {
    for (const path of PUBLIC_PATHS) {
      expect(parsed.isBlocked(path), `"${path}" (from PUBLIC_PATHS) must not be blocked`).toBe(false);
    }
  });

  it("disallows /api/ as a crawling courtesy — duplicate, unreadable JSON", () => {
    expect(parsed.isBlocked("/api/people")).toBe(true);
    expect(parsed.isBlocked("/api/health")).toBe(true);
  });

  it("declares no admin, debug, or staging path — because none exist in this app", () => {
    // Not "these are blocked" — there is nothing to block, because the
    // router (src/lib/router.tsx) defines no such route. Asserting their
    // absence from the Disallow list at all is the honest claim: robots.txt
    // never had anything to hide here in the first place.
    for (const term of ["admin", "debug", "staging", "internal"]) {
      expect(text.toLowerCase()).not.toContain(term);
    }
  });

  it("declares exactly one Sitemap line, an absolute HTTPS URL", () => {
    expect(parsed.sitemaps).toHaveLength(1);
    expect(parsed.sitemaps[0]).toBe(`${ORIGIN}/sitemap.xml`);
    expect(() => assertHttpsOrigin(new URL(parsed.sitemaps[0]).origin)).not.toThrow();
  });

  it("documents, in its own text, that this is not an access-control mechanism", () => {
    // The task's own caution — robots.txt is a crawling rule, not a secrets
    // boundary — checked as a standing fact about this file's content, not
    // just asserted in code comments nobody re-reads.
    // Comment lines wrap with a leading "# " per line; strip that and
    // collapse whitespace so the check reads the prose, not its line breaks.
    const collapsed = text.toLowerCase().replace(/^#\s?/gm, "").replace(/\s+/g, " ");
    expect(collapsed).toMatch(/not an access-control|not .*security/);
  });
});

describe("parseRobots itself (sanity-check the test's own logic)", () => {
  it("longest match wins — a narrower Allow can carve an exception out of a broader Disallow", () => {
    const text = "User-agent: *\nDisallow: /api/\nAllow: /api/public/\n";
    const parsed = parseRobots(text);
    expect(parsed.isBlocked("/api/private/x")).toBe(true);
    expect(parsed.isBlocked("/api/public/x")).toBe(false);
  });

  it("an empty Disallow blocks nothing", () => {
    const parsed = parseRobots("User-agent: *\nDisallow:\n");
    expect(parsed.isBlocked("/anything")).toBe(false);
  });
});
