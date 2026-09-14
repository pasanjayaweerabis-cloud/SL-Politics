/**
 * Javora — crawlability validation.
 *
 * Retrieves the REAL sitemap from a running server, extracts every person
 * URL, and requests every single one — not a sample of five, not a sample of
 * fifty. At roughly 1,600 profiles, "check a handful and assume the rest are
 * the same" is exactly the assumption that would miss one bad build, one
 * missing evidence row, one person whose slug collided during generation.
 *
 * For each profile URL:
 *   - status is 200
 *   - <title> exists and matches the canonical person's name (not a generic
 *     fallback, not another person's title reused by mistake)
 *   - <link rel="canonical"> exists and is exactly this URL (self-referential —
 *     a canonical pointing somewhere else is not this page's identity)
 *   - a Person JSON-LD block exists, parses as valid JSON, and names the
 *     same person
 *   - robots meta does NOT say noindex
 *
 * Plus: an invalid slug must return 404, and the robots.txt Disallow list
 * must not touch /person/.
 *
 * Usage (a server must already be serving the built site — this script does
 * not start one):
 *
 *   npm run build
 *   npm run serve:dist &
 *   node scripts/validate-crawlability.mjs --base http://localhost:5190
 */

import { allPeople } from "../src/services/repository.ts";
import { mapPool, extractHead, extractTag } from "./lib/seo-checks.mjs";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const BASE = (baseIndex !== -1 ? args[baseIndex + 1] : "http://localhost:5190").replace(/\/+$/, "");
const CONCURRENCY = Number(args[args.indexOf("--concurrency") + 1]) || 24;

const failures = [];
const pass = (label) => process.stdout.write(".");
const fail = (url, reason) => {
  failures.push({ url, reason });
  process.stdout.write("F");
};

/** A small concurrency pool — 1,624 sequential requests would be needlessly slow; 1,624 at once would hammer the server for no reason. */
/* ==========================================================================
   1. Retrieve the sitemap, extract every person URL
   ========================================================================== */

console.log(`validate-crawlability: fetching ${BASE}/sitemap.xml`);
const sitemapRes = await fetch(`${BASE}/sitemap.xml`);
if (sitemapRes.status !== 200) {
  console.error(`FATAL: sitemap.xml returned ${sitemapRes.status}, not 200. Is the server running?`);
  process.exit(1);
}
const sitemapContentType = sitemapRes.headers.get("content-type") ?? "";
if (!/xml/.test(sitemapContentType)) {
  failures.push({ url: `${BASE}/sitemap.xml`, reason: `content-type "${sitemapContentType}" does not look like XML` });
}

const sitemapXml = await sitemapRes.text();
const allLocs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/*
 * The sitemap correctly contains ABSOLUTE PRODUCTION URLs (https://javora.lk/...)
 * — that is what a real sitemap must do. Testing against a local server means
 * requesting the same PATH against `BASE`, not fetching the production origin
 * itself, which this environment cannot reach. Every check below still
 * verifies the page's own <link rel="canonical"> equals the real production
 * URL from the sitemap, so the production identity is what actually gets
 * validated — only the transport target changes.
 */
const sitemapOrigin = new URL(allLocs[0]).origin;
const toLocal = (absoluteUrl) => BASE + new URL(absoluteUrl).pathname;

const personProductionUrls = allLocs.filter((u) => u.includes("/person/"));
const personUrls = personProductionUrls.map(toLocal);
const productionUrlFor = new Map(personUrls.map((local, i) => [local, personProductionUrls[i]]));

console.log(`sitemap: ${allLocs.length} total URLs, ${personUrls.length} person profile URLs`);
console.log(`sitemap origin: ${sitemapOrigin}  ->  testing against: ${BASE}`);

/* ==========================================================================
   2. Cross-check against the canonical dataset BEFORE making one request
   ========================================================================== */

const today = new Date();
const canonicalPeople = allPeople(today).filter((v) => Boolean(v.person.slug));
const canonicalBySlug = new Map(canonicalPeople.map((v) => [v.person.slug, v]));

console.log(`canonical dataset: ${canonicalPeople.length} sluggable people`);

if (personUrls.length !== canonicalPeople.length) {
  failures.push({
    url: "(sitemap vs. canonical count)",
    reason: `sitemap has ${personUrls.length} person URLs, canonical dataset has ${canonicalPeople.length} sluggable people — these must be equal`,
  });
}

const sitemapSlugs = new Set(personUrls.map((u) => decodeURIComponent(u.split("/person/")[1])));
const missingFromSitemap = canonicalPeople.filter((v) => !sitemapSlugs.has(v.person.slug));
const extraInSitemap = [...sitemapSlugs].filter((slug) => !canonicalBySlug.has(slug));

for (const v of missingFromSitemap) failures.push({ url: `/person/${v.person.slug}`, reason: "in canonical dataset but missing from sitemap" });
for (const slug of extraInSitemap) failures.push({ url: `/person/${slug}`, reason: "in sitemap but no matching canonical person" });

const duplicateSlugs = personUrls.length !== sitemapSlugs.size;
if (duplicateSlugs) failures.push({ url: "(sitemap)", reason: `${personUrls.length - sitemapSlugs.size} duplicate person URL(s) in sitemap` });

/* ==========================================================================
   3. Request every single one
   ========================================================================== */

console.log(`\nrequesting all ${personUrls.length} profile URLs (concurrency ${CONCURRENCY})...`);

let checked = 0;
await mapPool(personUrls, CONCURRENCY, async (url) => {
  const slug = decodeURIComponent(url.split("/person/")[1]);
  const canonical = canonicalBySlug.get(slug);
  // The page's own tags correctly carry the PRODUCTION URL regardless of
  // which host actually served the bytes — that is the identity being
  // checked, not the local test transport.
  const productionUrl = productionUrlFor.get(url);
  checked++;

  let res, html;
  try {
    res = await fetch(url);
    html = await res.text();
  } catch (error) {
    fail(url, `request failed: ${error.message}`);
    return;
  }

  if (res.status !== 200) {
    fail(url, `expected 200, got ${res.status}`);
    return;
  }

  const head = extractHead(html);

  // <title> exists and names the right person.
  const title = extractTag(head, /<title>([^<]*)<\/title>/);
  if (!title) {
    fail(url, "no <title> tag");
  } else if (canonical && !title.includes(canonical.person.canonicalName)) {
    fail(url, `<title> "${title}" does not contain the canonical name "${canonical.person.canonicalName}"`);
  } else {
    pass();
  }

  // <meta name="description"> exists and is non-empty.
  const description = extractTag(head, /<meta name="description" content="([^"]*)"/);
  if (!description) fail(url, "no <meta name=\"description\">");

  // canonical is present and self-referential.
  const canonicalHref = extractTag(head, /<link rel="canonical" href="([^"]*)"/);
  if (!canonicalHref) {
    fail(url, "no <link rel=\"canonical\">");
  } else if (canonicalHref !== productionUrl) {
    fail(url, `canonical href "${canonicalHref}" does not match the production URL "${productionUrl}"`);
  }

  // robots must not say noindex — this IS a public, indexable profile.
  const robots = extractTag(head, /<meta name="robots" content="([^"]*)"/);
  if (robots?.includes("noindex")) fail(url, `robots meta says "${robots}" — a public profile must not be noindex`);

  // Person JSON-LD: present, valid JSON, correct type, correct name.
  const ldJson = extractTag(head, /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!ldJson) {
    fail(url, "no JSON-LD structured data block");
  } else {
    try {
      const data = JSON.parse(ldJson);
      if (data["@type"] !== "Person") fail(url, `JSON-LD @type is "${data["@type"]}", not "Person"`);
      else if (canonical && data.name !== canonical.person.canonicalName) {
        fail(url, `JSON-LD name "${data.name}" does not match canonical name "${canonical.person.canonicalName}"`);
      } else if (data.url !== productionUrl) {
        fail(url, `JSON-LD url "${data.url}" does not match the production URL "${productionUrl}"`);
      }
    } catch (error) {
      fail(url, `JSON-LD is not valid JSON: ${error.message}`);
    }
  }
});

console.log(`\nchecked ${checked}/${personUrls.length} profile URLs`);

/* ==========================================================================
   4. Invalid profiles must 404
   ========================================================================== */

console.log("\nchecking invalid profile URLs return 404...");
const invalidSlugs = ["nonexistent-person-xyz", "../../etc/passwd", "person-that-does-not-exist-12345"];
for (const slug of invalidSlugs) {
  const url = `${BASE}/person/${encodeURIComponent(slug)}`;
  const res = await fetch(url);
  if (res.status !== 404) {
    failures.push({ url, reason: `invalid profile expected 404, got ${res.status}` });
  } else {
    console.log(`  OK   404  /person/${slug}`);
  }
}

/* ==========================================================================
   5. robots.txt must not block profiles
   ========================================================================== */

console.log("\nchecking robots.txt does not block /person/...");
const robotsTxt = await (await fetch(`${BASE}/robots.txt`)).text();
const disallowLines = robotsTxt.split("\n").filter((l) => /^\s*Disallow:/i.test(l));
const blocksProfiles = disallowLines.some((line) => {
  const path = line.split(":")[1]?.trim() ?? "";
  return path && "/person/example".startsWith(path);
});
if (blocksProfiles) {
  failures.push({ url: `${BASE}/robots.txt`, reason: `a Disallow rule blocks /person/: ${disallowLines.join(", ")}` });
} else {
  console.log(`  OK   robots.txt Disallow rules do not touch /person/ (${disallowLines.length} rule(s): ${disallowLines.map((l) => l.trim()).join(", ") || "none"})`);
}

/* ==========================================================================
   Report
   ========================================================================== */

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURE(S)`}`);
console.log(`  sitemap person URLs   : ${personUrls.length}`);
console.log(`  canonical profiles    : ${canonicalPeople.length}`);
console.log(`  profiles requested    : ${checked}`);
console.log(`  count matches         : ${personUrls.length === canonicalPeople.length ? "yes" : "NO"}`);

if (failures.length > 0) {
  console.log("\nfailures:");
  for (const f of failures.slice(0, 50)) console.log(`  ${f.url} — ${f.reason}`);
  if (failures.length > 50) console.log(`  ... and ${failures.length - 50} more`);
  process.exit(1);
}
