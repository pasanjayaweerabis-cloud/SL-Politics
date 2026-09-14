/**
 * Javora — static prerendering.
 *
 * Turns the built SPA into one real HTML file per public route, then writes
 * sitemap.xml and robots.txt beside them.
 *
 * WHY THIS EXISTS. A client-rendered SPA serves every URL as an empty
 * <div id="root">. Google will usually execute the JavaScript and eventually
 * see the content; almost nothing else will. Social unfurlers, most LLM
 * crawlers, Bing's cheaper crawl paths and every reader with JavaScript
 * disabled get a blank page with a generic title. For a civic reference site
 * whose whole purpose is being findable and citable, that is disqualifying.
 *
 * WHY PRERENDER RATHER THAN SSR. The canonical dataset is bundled at build
 * time, so every public page is fully determined before a request arrives.
 * Rendering them once at build produces a purely static site — no server on
 * the hot path, cacheable at the edge, and nothing to fall over under load.
 * An SSR server would add a runtime dependency and buy nothing, because there
 * is no per-request state to render.
 *
 * Run after `vite build`, via `npm run build`.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripShellMeta } from "./shellMeta.mjs";
import { buildSitemapXml, assertHttpsOrigin } from "./sitemap.mjs";
import { buildRobotsTxt } from "./robots.mjs";
import { apiConnectOrigin, cspReportingDirectives, reportingEndpointsHeader } from "./csp.mjs";
import { liftPreloads } from "./preloads.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SSR_ENTRY = join(ROOT, "dist-ssr", "entry-server.js");

/**
 * The production origin.
 *
 * Required, with no default. A canonical URL or a sitemap entry pointing at
 * `http://localhost` or a guessed domain is worse than none at all: it tells
 * search engines the real copy of every page lives somewhere they cannot
 * reach. Better to fail the build than to publish that.
 */
const ORIGIN = (process.env.VITE_SITE_ORIGIN ?? process.env.SITE_ORIGIN ?? "").replace(/\/+$/, "");
if (!ORIGIN) {
  console.error(
    "prerender: VITE_SITE_ORIGIN is not set.\n" +
      "  Canonical URLs and sitemap entries must be absolute and must name the\n" +
      "  production host, so there is no safe default.\n" +
      "  Example: VITE_SITE_ORIGIN=https://javora.lk npm run build",
  );
  process.exit(1);
}
try {
  assertHttpsOrigin(ORIGIN);
} catch (error) {
  console.error(`prerender: ${error.message}`);
  process.exit(1);
}

// pathToFileURL, not the bare path: on Windows an absolute path like
// "C:\..." is read by the ESM loader as a URL with scheme "c:".
const { renderPage, prerenderRoutes, sitemapRoutes } = await import(pathToFileURL(SSR_ENTRY).href);

/**
 * One instant for the whole build.
 *
 * Every page derives "currently in office" from a date. Calling `new Date()`
 * per page would let a term boundary fall midway through a build and produce a
 * set of pages that disagree with each other.
 */
const BUILD_TIME = new Date();

const template = readFileSync(join(DIST, "index.html"), "utf8");

/**
 * Strip every tag the shell carries that `renderMetaTags` also emits.
 *
 * index.html's <head> is a fallback for the rare case something reads it
 * before hydration; every one of `title`, `description`, `og:site_name`,
 * `og:type` and `twitter:card` is ALSO written by `renderMetaTags` per page.
 * Left in the shell, three of those five shipped duplicated on all 1,628
 * prerendered pages — found by grepping a real build, not by inspection —
 * because only the first two were ever stripped here. `og:title`,
 * `og:description`, `og:url`, `twitter:title` and `twitter:description` need
 * no entry: the shell never carries site-wide fallbacks for those, so there
 * was nothing to double. The list lives in shellMeta.mjs so
 * shellMeta.test.mjs can assert it stays exhaustive.
 */
const shell = stripShellMeta(template);

/** Where a route's HTML file goes. "/" -> dist/index.html. */
function outputPath(routePath) {
  if (routePath === "/") return join(DIST, "index.html");
  return join(DIST, decodeURIComponent(routePath).replace(/^\//, ""), "index.html");
}

/* ==========================================================================
   Render
   ========================================================================== */

const routes = prerenderRoutes(BUILD_TIME);
const failures = [];
let written = 0;


/**
 * External image origins, collected from what actually renders.
 *
 * Portraits are served from the official source rather than copied, so the CSP
 * has to name that origin. Reading it out of the rendered HTML instead of
 * hardcoding it means adding a second source cannot silently blank every
 * portrait behind a policy violation — which is a failure that shows up only
 * as missing images, with the reason buried in the browser console.
 */
const imageOrigins = new Set();
function collectImageOrigins(html) {
  for (const match of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
    try {
      const url = new URL(match[1]);
      if (/\.(jpe?g|png|webp|gif|avif|svg)$/i.test(url.pathname)) imageOrigins.add(url.origin);
    } catch {
      // Not a URL worth adding to a security policy.
    }
  }
}

for (const route of routes) {
  try {
    const rendered = renderPage(route.path, { origin: ORIGIN, today: BUILD_TIME });
    collectImageOrigins(rendered.html);
    const { body: html, preloads } = liftPreloads(rendered.html);
    const head = preloads ? `${rendered.head}\n    ${preloads}` : rendered.head;

    const page = shell
      .replace("</head>", `  ${head}\n  </head>`)
      // Anchored to the exact empty div Vite emits, so a failed match is loud
      // rather than silently producing a page with no content.
      .replace('<div id="root"></div>', `<div id="root">${html}</div>`);

    if (!page.includes('<div id="root">')) throw new Error("root element not found in shell");

    const file = outputPath(route.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page, "utf8");
    written++;
  } catch (error) {
    failures.push(`${route.path}: ${error.message}`);
  }
}

/* ==========================================================================
   404.html
   ========================================================================== */

/*
 * A real not-found page, served with a real 404 status by the host.
 *
 * The alternative that static SPA hosting invites is rewriting every unmatched
 * URL to index.html and letting the router show "not found" — which returns
 * HTTP 200. Search engines call that a soft 404: the page is indexed, ranks for
 * the name it claims not to have, and pollutes results with dead ends. Marked
 * `noindex` by `metaForRoute` for the same reason.
 */
try {
  const rendered = renderPage("/__not-found__", { origin: ORIGIN, today: BUILD_TIME });
  const { body, preloads } = liftPreloads(rendered.html);
  const head = preloads ? `${rendered.head}\n    ${preloads}` : rendered.head;
  writeFileSync(
    join(DIST, "404.html"),
    shell.replace("</head>", `  ${head}\n  </head>`).replace('<div id="root"></div>', `<div id="root">${body}</div>`),
    "utf8",
  );
} catch (error) {
  failures.push(`404.html: ${error.message}`);
}

/* ==========================================================================
   sitemap.xml
   ========================================================================== */

writeFileSync(join(DIST, "sitemap.xml"), buildSitemapXml(sitemapRoutes(BUILD_TIME), ORIGIN), "utf8");

/* ==========================================================================
   robots.txt
   ========================================================================== */

writeFileSync(join(DIST, "robots.txt"), buildRobotsTxt(ORIGIN), "utf8");

/* ==========================================================================
   Content-Security-Policy
   ========================================================================== */

/*
 * index.html carries one inline script — the theme applier that runs before
 * first paint to avoid a flash of the wrong theme. A strict CSP has to account
 * for it, and there are only two ways: allow ALL inline script, which discards
 * most of the policy's value, or allow that exact script by hash.
 *
 * The hash is computed from the shipped file rather than written down, because
 * a hardcoded one goes stale the moment the script changes — and the failure is
 * silent in reverse: the page still works, the theme flash returns, and nobody
 * connects it to a CSP edit made months earlier.
 */
/**
 * The API's origin, if this build was pointed at one.
 *
 * Only the ORIGIN goes into the CSP — a `connect-src` entry is matched by
 * scheme/host/port, and including a path would neither restrict anything
 * further nor match correctly. Invalid values are ignored rather than
 * crashing the build: an unparseable VITE_API_URL already means the API
 * client is disabled, so there is no origin to allow.
 */
const apiOrigin = apiConnectOrigin(process.env.VITE_API_URL, ORIGIN);
if (process.env.VITE_API_URL?.trim() && !apiOrigin) {
  // Either same-origin (fine, 'self' covers it) or unparseable (worth saying
  // out loud, since it silently disables the API client too).
  try {
    new URL(process.env.VITE_API_URL.trim());
  } catch {
    console.warn(`prerender: VITE_API_URL="${process.env.VITE_API_URL}" is not a valid URL; not adding it to connect-src`);
  }
}

const inlineScripts = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const scriptHashes = inlineScripts.map(
  (source) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`,
);

// L-8: unset by default, so an ordinary build (including every build this
// project's own tests run) produces the exact same CSP as before this
// existed. See scripts/csp.mjs's cspReportingDirectives/
// reportingEndpointsHeader for why report-uri and report-to always ship
// together, and .env.example for what to point this at.
const CSP_REPORT_URI = process.env.CSP_REPORT_URI;

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.join(" ")}`,
  /*
   * L-10 (docs/security-audit-followup-2026-09-04.md). Fonts are
   * self-hosted (src/styles/base.css's @font-face rules, public/fonts/), so
   * 'self' already covers style-src and font-src without naming
   * fonts.googleapis.com/fonts.gstatic.com at all — one fewer third party on
   * every page's critical path, and one fewer origin every visitor's browser
   * used to contact directly.
   *
   * 'unsafe-inline' is gone from style-src outright, not hashed or nonced:
   * grepped across every .jsx/.tsx source file and every one of the 1,628
   * prerendered HTML files for `style=`/`style={{` and found zero — this
   * app has no inline style anywhere to accommodate. A nonce could not have
   * worked here regardless (this is a purely static, prerendered site with
   * one CSP baked in at build time, not one generated per request), and
   * hashing a set of styles that does not exist would just be dead policy
   * text.
   */
  "style-src 'self'",
  "font-src 'self'",
  // Portraits are loaded from the official source that publishes them, so that
  // origin has to be allowed. Note the trade-off this encodes: every reader's
  // browser contacts that server, which tells it who is looking at whose
  // profile. Removing that means hosting copies, which is a licensing decision
  // rather than a technical one.
  `img-src 'self' data:${[...imageOrigins].sort().map((o) => ` ${o}`).join("")}`,
  /*
   * The API origin, when the build points at one.
   *
   * `'self'` alone is wrong the moment the API lives on its own hostname,
   * which is exactly what .env.production.example configures
   * (VITE_SITE_ORIGIN=https://javora.lk, VITE_API_URL=https://api.javora.lk).
   * The comment that used to sit here said the deployment would add this —
   * nothing did, and nothing could: the CSP is generated at build time and
   * written into dist/_headers, so a deployment editing it afterwards would
   * have to re-derive the script hash too.
   *
   * The failure this caused is silent, which is why it survived: the browser
   * blocks the fetch, `GovernmentPage` catches it, and the page falls back to
   * the bundled dataset. Nothing looks broken — the site simply serves stale
   * data forever while appearing to work. Found by loading a real build in a
   * real browser against a real API and reading the console, not by review.
   */
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  ...cspReportingDirectives(CSP_REPORT_URI),
].join("; ");

const reportingEndpoints = reportingEndpointsHeader(CSP_REPORT_URI);

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // Only present when CSP_REPORT_URI is set — see cspReportingDirectives's
  // comment on why report-to is meaningless without this.
  ...(reportingEndpoints ? { "Reporting-Endpoints": reportingEndpoints } : {}),
};

// Netlify / Cloudflare Pages format. Ignored by hosts that do not read it,
// including a self-hosted nginx deployment — deploy/nginx.conf documents the
// same policy but cannot carry it automatically: this CSP is a function of
// build-time config (VITE_API_URL, the recorded portrait origins), so a
// value baked into nginx.conf would only be correct for whichever build last
// generated it, and silently wrong for any other. nginx.conf's own comment
// says as much and leaves the Content-Security-Policy line commented out
// with instructions to paste the current dist/csp.txt in by hand before that
// config is actually used — a manual step, not an independent copy.
writeFileSync(
  join(DIST, "_headers"),
  [
    "/*",
    ...Object.entries(SECURITY_HEADERS).map(([key, value]) => `  ${key}: ${value}`),
    "",
    "# Hashed filenames never change contents, so they can be cached forever.",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "# HTML must revalidate, or a deploy stays invisible to returning readers.",
    "/*.html",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
  ].join("\n"),
  "utf8",
);

writeFileSync(join(DIST, "csp.txt"), `${CSP}\n`, "utf8");

/* ==========================================================================
   Report
   ========================================================================== */

// The SSR bundle is a build artefact, not something to deploy.
rmSync(join(ROOT, "dist-ssr"), { recursive: true, force: true });

console.log(`prerender: ${written}/${routes.length} routes -> dist/`);
console.log(`prerender: sitemap.xml (${sitemapRoutes(BUILD_TIME).length} urls), robots.txt, 404.html`);
console.log(`prerender: _headers, csp.txt (${scriptHashes.length} inline script hash(es))`);
console.log(`prerender: origin ${ORIGIN}`);

if (failures.length > 0) {
  console.error(`prerender: ${failures.length} route(s) failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
