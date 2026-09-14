import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IDENTITY_OVERRIDES } from "../src/data/identityOverrides.ts";

/** Slugs written to disk on purpose but kept out of the sitemap. */
const RETIRED_SLUGS = IDENTITY_OVERRIDES.flatMap((o) => o.retiredSlugs);

/**
 * Javora — assertions against the artefact that is actually deployed.
 *
 * Everything else in this suite tests source. This tests dist/, because the
 * three prerender bugs this pipeline exists to prevent were all invisible in
 * source and visible only in the built HTML:
 *
 *   - TabPanel rendering nothing to crawlers (pinned separately by
 *     src/lib/prerenderContent.test.ts)
 *   - three meta tags duplicated on all 1,628 pages (shellMeta.mjs)
 *   - preloads left in the body, failing hydration (preloads.mjs)
 *
 * SKIPPING. dist/ is gitignored and absent until `npm run build` has run, so
 * these skip rather than fail in CI or a fresh clone. Build with
 * VITE_SITE_ORIGIN set, then run again to exercise them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");
const HAVE_DIST = existsSync(join(DIST, "index.html"));

/*
 * M-3 (docs/security-audit-followup-2026-09-04.md). Skipping quietly when
 * dist/ is absent is right for a fresh local clone, but CI ran `npm run
 * test` with no `npm run build` step ahead of it — so this suite (and
 * deploy/nginxCsp.test.mjs, scripts/distSecretScan.test.mjs) skipped on
 * EVERY push and pull request, silently, while still reporting green. A
 * build failure could ship with none of these three checks having run even
 * once. In CI, a missing dist/ is a pipeline defect, not something to shrug
 * off the same way a fresh clone does.
 */
if (process.env.CI && !HAVE_DIST) {
  throw new Error(
    "dist/ is missing in CI. `npm run build` (with VITE_SITE_ORIGIN set) must run before `npm test` " +
      "so this suite actually exercises the build artefact instead of skipping silently.",
  );
}

const read = (p) => readFileSync(p, "utf8");

/** Every prerendered page in dist/, as [relative path, html]. */
function allPages() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".html")) out.push([full.slice(DIST.length + 1), read(full)]);
    }
  };
  walk(DIST);
  return out;
}

const HEAD = (html) => html.slice(0, html.indexOf("</head>"));
const BODY = (html) => html.slice(html.indexOf("</head>"));

describe.skipIf(!HAVE_DIST)("prerendered output", () => {
  const pages = allPages();

  it("emitted a substantial number of pages", () => {
    expect(pages.length).toBeGreaterThan(1000);
  });

  it("puts every preload in <head> and none in the body", () => {
    // The React #418 hydration failure. A preload left in the body makes the
    // client tree differ from the server tree and React throws the whole
    // prerendered document away.
    const offenders = pages
      .filter(([, html]) => /<link rel="preload"/.test(BODY(html)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("gives every page exactly one document <title>", () => {
    // Scoped to <head> on purpose. Inline SVG icons legitimately carry their
    // own <title> elements for accessibility - dist/index.html has 18 - so a
    // whole-document count measures the icon set, not the page title.
    const offenders = pages
      .map(([path, html]) => [path, (HEAD(html).match(/<title>/g) ?? []).length])
      .filter(([, n]) => n !== 1);
    expect(offenders).toEqual([]);
  });

  it("does not duplicate the meta tags the shell and page meta both emit", () => {
    // The exact bug shellMeta.mjs exists to prevent: og:site_name, og:type and
    // twitter:card were added to renderMetaTags without the shell-stripping
    // list being updated, so all 1,628 pages carried each of them twice.
    const singles = [
      ['name="description"', /<meta\s+name="description"/g],
      ['property="og:site_name"', /<meta\s+property="og:site_name"/g],
      ['property="og:type"', /<meta\s+property="og:type"/g],
      ['name="twitter:card"', /<meta\s+name="twitter:card"/g],
    ];
    const offenders = [];
    for (const [path, html] of pages) {
      for (const [label, re] of singles) {
        const n = (HEAD(html).match(re) ?? []).length;
        if (n > 1) offenders.push(`${path}: ${label} x${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives every page exactly one canonical link", () => {
    const offenders = pages
      .map(([path, html]) => [path, (html.match(/rel="canonical"/g) ?? []).length])
      .filter(([, n]) => n !== 1)
      // 404.html is served for unknown URLs and deliberately has no canonical.
      .filter(([path]) => path !== "404.html");
    expect(offenders).toEqual([]);
  });

  it("renders real content into #root on every page", () => {
    // An empty root means the page shipped as a client-only shell, which is
    // the failure prerendering exists to prevent.
    const offenders = pages
      .filter(([, html]) => /<div id="root"><\/div>/.test(html))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("lists every person page it wrote in the sitemap, and vice versa", () => {
    const sitemap = read(join(DIST, "sitemap.xml"));
    const inSitemap = new Set(
      [...sitemap.matchAll(/<loc>[^<]*\/person\/([^<\/]+)\/?<\/loc>/g)].map((m) => m[1]),
    );
    const onDisk = new Set(
      pages
        .map(([path]) => path.replace(/\\/g, "/"))
        .filter((p) => p.startsWith("person/"))
        .map((p) => p.slice("person/".length).replace(/\/index\.html$/, "")),
    );
    // Retired slugs are deliberately written but not advertised — a URL this
    // site published and still honours, pointing at the current one as
    // canonical. Every OTHER page on disk must be in the sitemap, and every
    // sitemap entry must exist on disk.
    const retired = new Set(RETIRED_SLUGS);
    const missingFromSitemap = [...onDisk].filter((s) => !inSitemap.has(s) && !retired.has(s));
    const missingFromDisk = [...inSitemap].filter((s) => !onDisk.has(s));
    expect({ missingFromSitemap, missingFromDisk }).toEqual({
      missingFromSitemap: [],
      missingFromDisk: [],
    });
  });

  it("writes every retired slug as a page that points at the current one", () => {
    // The reason the sitemap exemption above is safe: the file exists, and it
    // does not compete with the live URL for indexing.
    for (const slug of RETIRED_SLUGS) {
      const page = pages.find(
        ([path]) => path.replace(/\\/g, "/") === `person/${slug}/index.html`,
      );
      expect(page, `no prerendered page for retired slug /person/${slug}`).toBeDefined();
      const canonical = page[1].match(/<link rel="canonical" href="[^"]*\/person\/([^"\/]+)/);
      expect(canonical, `retired /person/${slug} has no canonical link`).not.toBeNull();
      expect(canonical[1]).not.toBe(slug);
    }
  });
});

describe.skipIf(HAVE_DIST)("prerendered output", () => {
  it("skipped: dist/ has not been built", () => {
    expect(HAVE_DIST).toBe(false);
  });
});
