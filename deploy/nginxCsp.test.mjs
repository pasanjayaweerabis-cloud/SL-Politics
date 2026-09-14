import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Javora — nginx CSP drift guard, and nginx add_header inheritance guard (H-2).
 *
 * deploy/nginx.conf hardcodes the Content-Security-Policy header rather than
 * reading dist/csp.txt at request time (nginx has no such capability), so the
 * two can only be kept in sync by a human pasting one into the other. Before
 * this test existed, the alternative was nginx.conf shipping with the header
 * commented out entirely — a silent, invisible gap (see deploy/README.md and
 * deploy/nginx.conf's own comment). Now that the header is active by default,
 * the risk moves from "no CSP" to "a stale CSP" — the sha256 hash inside it
 * is only valid for the exact inline theme script index.html ships with, and
 * a future edit to that script (or the CSP scripts/prerender.mjs generates)
 * would silently reintroduce the flash-of-wrong-theme, or worse, ship a
 * meaningless hash.
 *
 * H-2. nginx inherits `add_header` from an enclosing level ONLY when the
 * current level declares none of its own. deploy/security-headers.conf holds
 * the six security headers and is `include`d from the server block AND from
 * every `location` block that sets its own `add_header` (today: /assets/,
 * ~* \.html$, the sitemap/robots block) — without the include, those three
 * classes of response (all JS/CSS, every *.html URL, robots.txt/sitemap.xml)
 * silently carried none of the six headers. This is exactly the class of bug
 * that returns the moment someone adds a fourth caching rule and forgets the
 * include, so it is asserted structurally rather than left to be noticed by
 * hand: parse deploy/nginx.conf, find every `location` block, and fail if any
 * one of them declares `add_header` without also including the shared file.
 *
 * SKIPPING. dist/csp.txt is gitignored and absent until `npm run build` has
 * run, matching scripts/prerenderOutput.test.mjs's own skip rule. The
 * structural add_header/include check below does not depend on dist/ and
 * always runs.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CSP_FILE = join(ROOT, "dist", "csp.txt");
const NGINX_CONF = join(ROOT, "deploy", "nginx.conf");
const SECURITY_HEADERS_CONF = join(ROOT, "deploy", "security-headers.conf");
const HAVE_CSP = existsSync(CSP_FILE);

/*
 * M-3 (docs/security-audit-followup-2026-09-04.md). CI never ran `npm run
 * build` before `npm test`, so this CSP-drift check — the one guarding
 * against exactly the "stale hash silently reintroduces the flash-of-wrong-
 * theme" failure mode described above — skipped on every push and pull
 * request. See scripts/prerenderOutput.test.mjs's matching check.
 */
if (process.env.CI && !HAVE_CSP) {
  throw new Error(
    "dist/csp.txt is missing in CI. `npm run build` (with VITE_SITE_ORIGIN set) must run before " +
      "`npm test` so this suite actually checks a real build instead of skipping silently.",
  );
}

describe.skipIf(!HAVE_CSP)("nginx CSP", () => {
  it("matches the CSP the current build actually generated", () => {
    const generated = readFileSync(CSP_FILE, "utf8").trim();
    const securityHeaders = readFileSync(SECURITY_HEADERS_CONF, "utf8");
    expect(securityHeaders).toContain(`add_header Content-Security-Policy "${generated}" always;`);
  });
});

describe.skipIf(HAVE_CSP)("nginx CSP", () => {
  it("skipped: dist/csp.txt has not been built", () => {
    expect(true).toBe(true);
  });
});

/* ==========================================================================
   H-2 structural check — no dist/ dependency, always runs
   ========================================================================== */

/**
 * Every top-level `name { ... }` block in `source`, with nested braces
 * accounted for so a block's own `body` never runs past its matching `}`.
 * Good enough for nginx config, which nests server{}/location{} blocks but
 * never puts an unmatched `{`/`}` inside a string or comment in this file.
 */
function extractBlocks(source, headerPattern) {
  const blocks = [];
  const re = new RegExp(headerPattern.source, `${headerPattern.flags.replace("g", "")}g`);
  let match;
  while ((match = re.exec(source))) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    blocks.push({ header: match[0].trim(), body: source.slice(bodyStart, i - 1) });
  }
  return blocks;
}

const INCLUDE_LINE = "include security-headers.conf;";

/**
 * Strips `#`-to-end-of-line comments before block extraction. Without this,
 * `[^{]` (used so a location body can span multiple lines) also matches
 * newlines inside a COMMENT, so a comment merely mentioning the word
 * "location" — as the one directly above deploy/nginx.conf's `location
 * /assets/` block does — got matched as the start of a location block and
 * swallowed everything up to the next real `{`, silently testing the wrong
 * text. nginx has no block comments, so line-stripping is exact here.
 */
function stripComments(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

describe("nginx add_header inheritance (H-2)", () => {
  const conf = stripComments(readFileSync(NGINX_CONF, "utf8"));

  it("every location block that declares add_header also includes security-headers.conf", () => {
    const locations = extractBlocks(conf, /location\s+[^{]*\{/);
    expect(locations.length, "expected at least one location block").toBeGreaterThan(0);

    const offenders = locations
      .filter((loc) => /\badd_header\b/.test(loc.body))
      .filter((loc) => !loc.body.includes(INCLUDE_LINE))
      .map((loc) => loc.header);

    expect(offenders, `location block(s) declaring add_header with no security-headers include: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the main server block includes security-headers.conf at its own level, not only inside a location", () => {
    const servers = extractBlocks(conf, /server\s*\{/);
    const main = servers.find((s) => s.body.includes("location /") && s.body.includes("try_files"));
    expect(main, "expected to find the main server block (the one with location / and try_files)").toBeTruthy();

    // Strip nested location blocks' own bodies so a location-level include
    // cannot be mistaken for a server-level one.
    const locationsInMain = extractBlocks(main.body, /location\s+[^{]*\{/);
    let serverLevelOnly = main.body;
    for (const loc of locationsInMain) serverLevelOnly = serverLevelOnly.replace(loc.body, "");

    expect(serverLevelOnly, "the server block itself (outside any location) must include security-headers.conf").toContain(INCLUDE_LINE);
  });

  it("security-headers.conf declares all six required headers", () => {
    const headers = readFileSync(SECURITY_HEADERS_CONF, "utf8");
    for (const name of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      expect(headers, `security-headers.conf is missing ${name}`).toMatch(new RegExp(`add_header ${name}\\b`));
    }
  });
});

/*
 * L-5 (docs/security-audit-followup-2026-09-04.md). The main server block
 * claimed both javora.lk and www.javora.lk in its own server_name, which —
 * being the first block nginx considers for that hostname — meant the
 * dedicated "canonical host" redirect block for www.javora.lk further down
 * the file could never actually be selected. Separately, TLS was configured
 * with both certificate lines commented out and no ssl_protocols, cipher
 * list, session cache or OCSP stapling at all, so the file could not
 * actually start with TLS as shipped.
 */
describe("nginx TLS and server_name (L-5)", () => {
  const conf = stripComments(readFileSync(NGINX_CONF, "utf8"));
  const servers = extractBlocks(conf, /server\s*\{/);
  const main = servers.find((s) => s.body.includes("location /") && s.body.includes("try_files"));
  const wwwRedirect = servers.find((s) => /return 301 https:\/\/javora\.lk/.test(s.body) && /listen 443/.test(s.body));

  it("the main (443) server block's server_name does not also claim www.javora.lk", () => {
    expect(main, "expected to find the main server block").toBeTruthy();
    const serverNameLine = main.body.match(/server_name\s+([^;]+);/)?.[1] ?? "";
    const names = serverNameLine.split(/\s+/).filter(Boolean);
    expect(names).toContain("javora.lk");
    expect(names).not.toContain("www.javora.lk");
  });

  it("a dedicated HTTPS www.javora.lk redirect block exists and is reachable (a distinct server_name from the main block)", () => {
    expect(wwwRedirect, "expected an HTTPS server block redirecting www.javora.lk to javora.lk").toBeTruthy();
    expect(wwwRedirect.body).toMatch(/server_name\s+www\.javora\.lk;/);
  });

  it("TLS certificate directives are active, not commented out", () => {
    // stripComments already removed every commented-out ssl_certificate
    // line, so finding one here means an active directive survived it.
    expect(conf).toMatch(/ssl_certificate\s+\S+;/);
    expect(conf).toMatch(/ssl_certificate_key\s+\S+;/);
  });

  it("declares ssl_protocols, a cipher list, a session cache and OCSP stapling", () => {
    expect(conf).toMatch(/ssl_protocols\s+TLSv1\.2\s+TLSv1\.3;/);
    expect(conf).toMatch(/ssl_ciphers\s+\S+;/);
    expect(conf).toMatch(/ssl_session_cache\s+\S+;/);
    expect(conf).toMatch(/ssl_stapling\s+on;/);
  });

  it("uses the modern `listen ... ssl;` + `http2 on;` form, not the deprecated `listen ... ssl http2;`", () => {
    expect(conf).not.toMatch(/listen\s+\d+\s+ssl\s+http2;/);
    expect(conf).toMatch(/http2\s+on;/);
  });
});
