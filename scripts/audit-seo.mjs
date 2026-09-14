/**
 * Javora — final search-engine readiness audit.
 *
 * TECHNICAL READINESS ONLY. This proves the machinery is correct — unique
 * URLs, correct canonicals, no accidental noindex, valid structured data, no
 * duplicate content. It does not, and cannot, prove Google will index or
 * rank anything: that depends on crawl budget, external links, domain trust
 * and factors this script has no visibility into. Passing every check here
 * is the necessary condition, not the sufficient one.
 *
 * Runs against a REAL running server (a static build served by
 * scripts/serve-dist.mjs), checking every one of the ~1,624 person profiles
 * plus every static page — not a sample.
 *
 * Usage:
 *   npm run build && npm run serve:dist &
 *   node scripts/audit-seo.mjs --base http://localhost:5190
 */

import { allPeople } from "../src/services/repository.ts";
import { mapPool, extractHead, extractTag } from "./lib/seo-checks.mjs";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const BASE = (baseIndex !== -1 ? args[baseIndex + 1] : "http://localhost:5190").replace(/\/+$/, "");
const CONCURRENCY = Number(args[args.indexOf("--concurrency") + 1]) || 24;

const defects = [];
const flag = (category, url, detail) => defects.push({ category, url, detail });

console.log(`audit-seo: base=${BASE}\n`);

/* ==========================================================================
   1. robots.txt
   ========================================================================== */

console.log("1. /robots.txt");
const robotsRes = await fetch(`${BASE}/robots.txt`);
const robotsTxt = await robotsRes.text();
if (robotsRes.status !== 200) flag("robots.txt", `${BASE}/robots.txt`, `status ${robotsRes.status}, expected 200`);
if (!/^User-agent:\s*\*/m.test(robotsTxt)) flag("robots.txt", `${BASE}/robots.txt`, "no 'User-agent: *' block");
if (!/^Allow:\s*\/\s*$/m.test(robotsTxt)) flag("robots.txt", `${BASE}/robots.txt`, "no 'Allow: /' — public paths may be blocked");
const disallowLines = robotsTxt.split("\n").filter((l) => /^\s*Disallow:/i.test(l));
for (const line of disallowLines) {
  const path = line.split(":")[1]?.trim() ?? "";
  if (path && ("/person/x".startsWith(path) || "/directory".startsWith(path) || "/government".startsWith(path))) {
    flag("robots.txt", `${BASE}/robots.txt`, `Disallow rule "${path}" blocks a public content path`);
  }
}
const sitemapLine = robotsTxt.match(/^Sitemap:\s*(\S+)/m)?.[1];
if (!sitemapLine) flag("robots.txt", `${BASE}/robots.txt`, "no Sitemap: directive");
console.log(`   ${defects.length === 0 ? "OK" : `${defects.length} issue(s) so far`}`);

/* ==========================================================================
   2. sitemap.xml
   ========================================================================== */

console.log("\n2. /sitemap.xml");
const sitemapRes = await fetch(`${BASE}/sitemap.xml`);
const sitemapXml = await sitemapRes.text();
if (sitemapRes.status !== 200) flag("sitemap.xml", `${BASE}/sitemap.xml`, `status ${sitemapRes.status}`);
if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sitemapXml)) flag("sitemap.xml", `${BASE}/sitemap.xml`, "missing/malformed XML declaration");
if (!sitemapXml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) flag("sitemap.xml", `${BASE}/sitemap.xml`, "wrong or missing namespace");

const allLocs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const sitemapDupes = allLocs.length - new Set(allLocs).size;
if (sitemapDupes > 0) flag("sitemap.xml", `${BASE}/sitemap.xml`, `${sitemapDupes} duplicate <loc> entries`);

const toLocal = (absoluteUrl) => BASE + new URL(absoluteUrl).pathname;
const personProductionUrls = allLocs.filter((u) => u.includes("/person/"));
const personUrls = personProductionUrls.map(toLocal);
const productionUrlFor = new Map(personUrls.map((local, i) => [local, personProductionUrls[i]]));

console.log(`   ${allLocs.length} total URLs, ${personUrls.length} person URLs, ${sitemapDupes} duplicates`);

/* ==========================================================================
   3. Canonical dataset cross-check
   ========================================================================== */

console.log("\n3. Canonical dataset cross-check");
const today = new Date();
const canonicalPeople = allPeople(today).filter((v) => Boolean(v.person.slug));
const canonicalBySlug = new Map(canonicalPeople.map((v) => [v.person.slug, v]));

if (personUrls.length !== canonicalPeople.length) {
  flag("orphan/missing", "(count)", `sitemap has ${personUrls.length} person URLs; canonical dataset has ${canonicalPeople.length}`);
}

const sitemapSlugs = new Set(personUrls.map((u) => decodeURIComponent(u.split("/person/")[1])));

// ORPHAN PROFILES: exist canonically but have no sitemap entry — undiscoverable via sitemap.
const orphans = canonicalPeople.filter((v) => !sitemapSlugs.has(v.person.slug));
for (const v of orphans) flag("orphan profile", `/person/${v.person.slug}`, "in canonical dataset but missing from sitemap.xml");

// Sitemap entries with no matching canonical person — a link to nothing real.
const phantom = [...sitemapSlugs].filter((slug) => !canonicalBySlug.has(slug));
for (const slug of phantom) flag("invalid sitemap entry", `/person/${slug}`, "in sitemap.xml but no matching canonical person");

// DUPLICATE PERSON PAGES: same person, two different slugs (would be two URLs for one person).
const byPersonId = new Map();
for (const v of canonicalPeople) {
  const existing = byPersonId.get(v.person.id);
  if (existing) flag("duplicate person page", `/person/${v.person.slug}`, `same person id "${v.person.id}" as /person/${existing}`);
  else byPersonId.set(v.person.id, v.person.slug);
}

/*
 * NAME COLLISIONS in the raw dataset: two different real people who happen
 * to share a canonical name. This is a fact about Sri Lankan political
 * history (see the three pairs below — none overlap in office, some are
 * decades apart), NOT itself an SEO defect: src/lib/pageMeta.ts's
 * `personMeta()` already disambiguates the served <title> for exactly this
 * case by appending the year each person's earliest recorded position
 * began. Section 6 below checks the ACTUALLY SERVED titles over real HTTP
 * responses and is the authoritative check for duplicate titles; this is
 * printed as context for why that disambiguation logic exists, not flagged
 * as a defect.
 */
const byName = new Map();
for (const v of canonicalPeople) {
  if (!byName.has(v.person.canonicalName)) byName.set(v.person.canonicalName, []);
  byName.get(v.person.canonicalName).push(v.person.slug);
}
const nameCollisions = [...byName].filter(([, slugs]) => slugs.length > 1);

console.log(`   canonical people: ${canonicalPeople.length}`);
console.log(`   orphan profiles (missing from sitemap): ${orphans.length}`);
console.log(`   phantom sitemap entries (no canonical match): ${phantom.length}`);
console.log(`   duplicate person pages (same id, two slugs): ${defects.filter((d) => d.category === "duplicate person page").length}`);
console.log(`   name collisions in raw dataset (disambiguated at render time, not a defect): ${nameCollisions.length}`);
for (const [name, slugs] of nameCollisions) console.log(`     "${name}": ${slugs.map((s) => "/person/" + s).join(" & ")}`);

/* ==========================================================================
   4. Invalid / malformed profile URLs and soft-404 behaviour
   ========================================================================== */

console.log("\n4. Invalid profile URLs and soft-404 behaviour");
const invalidCases = [
  ["nonexistent-person-xyz-123", 404],
  ["", 404], // /person/ with nothing
  ["../../etc/passwd", 404],
  ["%00", 404],
  [" ", 404],
];
for (const [slug, expected] of invalidCases) {
  const url = `${BASE}/person/${encodeURIComponent(slug)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    flag("invalid URL handling", url, `request failed: ${error.message}`);
    continue;
  }
  if (res.status !== expected) {
    flag("soft 404 / wrong status", url, `expected ${expected}, got ${res.status}`);
    continue;
  }
  if (res.status === 200) {
    // A 200 that actually says "not found" in its body is a soft 404 by a
    // different mechanism — check the body wouldn't fool a reader either.
    const body = await res.text();
    if (/not found|no record/i.test(body)) flag("soft 404", url, "200 status but body says not found");
  }
}
console.log(`   ${invalidCases.length} invalid-URL cases checked`);

/* ==========================================================================
   5. Every single profile — the exhaustive per-page audit
   ========================================================================== */

console.log(`\n5. Exhaustive per-profile audit (${personUrls.length} pages, concurrency ${CONCURRENCY})`);

const seenTitles = new Map(); // title text -> [urls] actually served, independent of the dataset-level check above
const seenCanonicals = new Map();
let checked = 0;

await mapPool(personUrls, CONCURRENCY, async (url) => {
  const slug = decodeURIComponent(url.split("/person/")[1]);
  const canonical = canonicalBySlug.get(slug);
  const productionUrl = productionUrlFor.get(url);
  checked++;

  let res, html;
  try {
    res = await fetch(url);
    html = await res.text();
  } catch (error) {
    flag("request failed", url, error.message);
    return;
  }

  if (res.status !== 200) {
    flag("wrong status", url, `expected 200, got ${res.status}`);
    return;
  }

  const head = extractHead(html);

  // Unique title
  const title = extractTag(head, /<title>([^<]*)<\/title>/);
  if (!title) flag("missing title", url, "no <title>");
  else {
    if (canonical && !title.includes(canonical.person.canonicalName)) {
      flag("wrong title", url, `"${title}" does not name "${canonical.person.canonicalName}"`);
    }
    if (!seenTitles.has(title)) seenTitles.set(title, []);
    seenTitles.get(title).push(url);
  }

  // Useful meta description — present, non-empty, not a generic placeholder
  const description = extractTag(head, /<meta name="description" content="([^"]*)"/);
  if (!description) flag("missing description", url, "no <meta name=\"description\">");
  else if (description.trim().length === 0) flag("empty description", url, "description attribute is empty");
  else if (description.trim().length < 15) flag("thin description", url, `description is only ${description.length} chars: "${description}"`);

  // Canonical: present, self-referential, NOT pointing at home or another person
  const canonicalHref = extractTag(head, /<link rel="canonical" href="([^"]*)"/);
  if (!canonicalHref) {
    flag("missing canonical", url, "no <link rel=\"canonical\">");
  } else {
    if (canonicalHref === new URL(BASE).origin + "/" || /\/$/.test(canonicalHref) && new URL(canonicalHref).pathname === "/") {
      flag("canonical points to home", url, `canonical is "${canonicalHref}"`);
    } else if (canonicalHref !== productionUrl) {
      flag("canonical points elsewhere", url, `canonical "${canonicalHref}" != own production URL "${productionUrl}"`);
    }
    if (!seenCanonicals.has(canonicalHref)) seenCanonicals.set(canonicalHref, []);
    seenCanonicals.get(canonicalHref).push(url);
  }

  // Accidental noindex
  const robots = extractTag(head, /<meta name="robots" content="([^"]*)"/);
  if (robots?.includes("noindex")) flag("accidental noindex", url, `robots meta is "${robots}"`);
  if (!robots) flag("missing robots meta", url, "no <meta name=\"robots\">");

  // Person structured data — present, valid, names the right person, no unverified facts
  const ldJson = extractTag(head, /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!ldJson) {
    flag("missing structured data", url, "no Person JSON-LD");
  } else {
    try {
      const data = JSON.parse(ldJson);
      if (data["@type"] !== "Person") flag("wrong structured data type", url, `@type is "${data["@type"]}"`);
      if (canonical && data.name !== canonical.person.canonicalName) {
        flag("structured data name mismatch", url, `JSON-LD name "${data.name}" != "${canonical.person.canonicalName}"`);
      }
      if (data.url !== productionUrl) flag("structured data url mismatch", url, `JSON-LD url "${data.url}" != "${productionUrl}"`);
      // No unverified facts: this endpoint's contract (personStructuredData in
      // seo.ts) only ever emits name/url/jobTitle/description — a birthDate,
      // nationality or sameAs field would be an unsourced claim this project
      // does not make.
      const allowedKeys = new Set(["@context", "@type", "name", "url", "jobTitle", "description"]);
      const extraKeys = Object.keys(data).filter((k) => !allowedKeys.has(k));
      if (extraKeys.length) flag("unverified structured data field", url, `unexpected JSON-LD key(s): ${extraKeys.join(", ")}`);
    } catch (error) {
      flag("invalid structured data", url, `JSON-LD is not valid JSON: ${error.message}`);
    }
  }

  // Meaningful HTML content and crawlable links — the body must have real
  // text (not an empty shell) and at least one real <a href> back into the
  // site (never JS-only navigation as the sole path).
  const body = html.slice(html.indexOf("<body"));
  const visibleText = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (visibleText.length < 200) flag("thin content", url, `only ${visibleText.length} chars of visible text`);
  const realAnchors = [...body.matchAll(/<a\s[^>]*href="(\/[^"]*)"/g)];
  if (realAnchors.length === 0) flag("no crawlable links", url, "zero real <a href> anchors in the page");

  // Source information — at least one link to the institutional source, not
  // just a bare source id with nothing to click through to.
  const hasSourceLink = /class="source-pill[^"]*" href="https?:\/\//.test(body);
  if (!hasSourceLink) flag("missing source information", url, "no linked source/evidence found on the page");
});

console.log(`   checked ${checked}/${personUrls.length} profiles`);

/* ==========================================================================
   6. Site-wide duplicate detection (across what was actually served)
   ========================================================================== */

console.log("\n6. Site-wide duplicates (served titles/canonicals, not just dataset)");
let dupTitleGroups = 0;
for (const [title, urls] of seenTitles) {
  if (urls.length > 1) {
    dupTitleGroups++;
    flag("duplicate served title", urls.join(" & "), `"${title}" served identically on ${urls.length} pages`);
  }
}
let dupCanonicalGroups = 0;
for (const [canonical, urls] of seenCanonicals) {
  if (urls.length > 1) {
    dupCanonicalGroups++;
    flag("duplicate canonical URL", urls.join(" & "), `${urls.length} different pages declare canonical "${canonical}"`);
  }
}
console.log(`   duplicate title groups: ${dupTitleGroups}`);
console.log(`   duplicate canonical groups: ${dupCanonicalGroups}`);

/* ==========================================================================
   7. Static pages
   ========================================================================== */

console.log("\n7. Static pages");
for (const path of ["/", "/directory", "/government", "/corrections"]) {
  const res = await fetch(`${BASE}${path}`);
  const html = await res.text();
  if (res.status !== 200) { flag("static page status", path, `expected 200, got ${res.status}`); continue; }
  const head = extractHead(html);
  if (!extractTag(head, /<title>([^<]*)<\/title>/)) flag("missing title", path, "no <title>");
  if (!extractTag(head, /<meta name="description" content="([^"]*)"/)) flag("missing description", path, "no description");
  if (!extractTag(head, /<link rel="canonical" href="([^"]*)"/)) flag("missing canonical", path, "no canonical");
  console.log(`   ${path}: ${res.status}`);
}

// A 404 must actually be a 404, not a soft one.
const notFoundRes = await fetch(`${BASE}/this-path-does-not-exist-anywhere`);
if (notFoundRes.status !== 404) flag("soft 404", "/this-path-does-not-exist-anywhere", `expected 404, got ${notFoundRes.status}`);
else {
  const nfHtml = await notFoundRes.text();
  const nfRobots = extractTag(extractHead(nfHtml), /<meta name="robots" content="([^"]*)"/);
  if (!nfRobots?.includes("noindex")) flag("404 not marked noindex", "/this-path-does-not-exist-anywhere", `robots="${nfRobots}"`);
}
console.log(`   404 page: ${notFoundRes.status}`);

/* ==========================================================================
   Report
   ========================================================================== */

console.log("\n" + "=".repeat(70));
console.log(`SEO READINESS AUDIT: ${defects.length === 0 ? "NO DEFECTS FOUND" : `${defects.length} DEFECT(S) FOUND`}`);
console.log("(technical readiness only — this does not measure or predict actual search engine indexing)");

if (defects.length > 0) {
  const byCategory = new Map();
  for (const d of defects) {
    if (!byCategory.has(d.category)) byCategory.set(d.category, []);
    byCategory.get(d.category).push(d);
  }
  console.log("\nby category:");
  for (const [cat, items] of byCategory) {
    console.log(`\n  ${cat} (${items.length}):`);
    for (const d of items.slice(0, 10)) console.log(`    ${d.url} — ${d.detail}`);
    if (items.length > 10) console.log(`    ... and ${items.length - 10} more`);
  }
  process.exitCode = 1;
}
