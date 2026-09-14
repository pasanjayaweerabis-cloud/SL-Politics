#!/usr/bin/env node
/**
 * Javora — Parliament of Sri Lanka: Directory of PAST Members.
 *
 *   node --experimental-strip-types scripts/import-past-members.mjs \
 *     [--profiles] [--delay=700] [--pages=N] [--only=id,id,...]
 *
 * The historical half of the people universe. ~175 listing pages, eight
 * members each, and every one of them has the same profile page structure as
 * a sitting member — so the qualification, legislative-history, portfolio and
 * ministerial-service parsers are reused unchanged.
 *
 * WHY THIS IS SAFE TO MERGE WITH THE CURRENT DIRECTORY
 *
 * Past and current members share ONE identifier space: `mp-profile/<id>` is
 * the same URL for both, and Javora's person id is `parliament:<id>`. A member
 * who leaves Parliament keeps their id and moves between directories, so a
 * person cannot be duplicated across the two imports — the id collides and the
 * upsert collapses onto the existing record. That is why this is a separate
 * script rather than a separate database: same people, same ids, more of them.
 *
 * WHAT PAST PROFILES CARRY THAT CURRENT ONES DO NOT
 *
 *   "Last Elected Party"  instead of "Political Party"
 *   "Political Career"    a dated narrative of the member's career
 *
 * and what they LACK: District and Profession, which the current directory
 * publishes and this one does not.
 *
 * POLITENESS. robots.txt allows everything except /adminpanel, /api and
 * /preview. Requests are issued one at a time with a delay. A full profile
 * crawl is ~1,400 requests, so `--profiles` is opt-in and the default delay is
 * deliberately slower than the current-members importer's.
 *
 * RESUMABLE. Re-running reuses everything already collected, keyed on the
 * parser version, so an interrupted crawl continues instead of restarting.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseProfileDetail } from "../server/fetchers/parliamentProfileDetail.ts";
import { parseProfile } from "./import-parliament.mjs";
import { decodeEntities, stripTags, clean, sleep } from "../src/lib/html.ts";
import { contentHash } from "../src/sync/snapshot.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_FILE = resolve(ROOT, "src/data/imported/parliamentPastMembers.json");

const BASE = "https://www.parliament.lk";
const LISTING = (page) => `${BASE}/en/members-of-parliament/past-mp-listing?page=${page}`;
const DIRECTORY_URL = `${BASE}/en/members-of-parliament/past-mp-listing`;
const PROFILE = (id) => `${BASE}/en/members-of-parliament/mp-profile/${id}`;
const PARSER_VERSION = "parliament-past-members@1";
const SOURCE_ID = "S001";

const args = process.argv.slice(2);
const WANT_PROFILES = args.includes("--profiles");
const DELAY = Number((args.find((a) => a.startsWith("--delay=")) ?? "").split("=")[1]) || 700;
const MAX_PAGES = Number((args.find((a) => a.startsWith("--pages=")) ?? "").split("=")[1]) || 0;
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").split("=")[1];
const IDS = (args.find((a) => a.startsWith("--ids=")) ?? "").split("=")[1];

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "SLPoliticsImporter/1.0 (civic records; contact via repository)" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/* --------------------------------------------------------------- parsing */

/**
 * Parse one past-member listing page.
 *
 * The card differs from the current directory's in two ways that matter: the
 * name sits in `pmp_name_div` rather than `mp_name_div`, and the single
 * labelled field is "Legislative Service" rather than party and district.
 * Reusing the current-member parser here silently returns zero rows.
 */
export function parsePastListing(html) {
  const rows = [];
  const cardRe = /<a\s+href=['"]([^'"]*mp-profile\/(\d+))['"][^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const [, profileUrl, id, inner] = m;
    if (!inner.includes("white_box")) continue;

    const nameM = inner.match(/<div class=['"]pmp_name_div['"]>[\s\S]*?<b>([\s\S]*?)<\/b>/);
    const imgM = inner.match(/<img[\s\S]*?src=['"]([^'"]+)['"]/);
    const serviceM = inner.match(/<b>\s*Legislative Service\s*<\/b>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/i);

    if (!nameM) continue;
    rows.push({
      parliamentId: id,
      profileUrl,
      name: stripTags(nameM[1]),
      portraitUrl: imgM ? imgM[1] : null,
      legislativeService: serviceM ? clean(stripTags(serviceM[1])) : null,
    });
  }
  return rows;
}

/** The member's name as printed on their own profile page. */
export function nameFromProfile(html) {
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
  const fromTitle = (titleMatch?.[1] ?? "")
    .replace(/^\s*Parliament of Sri Lanka\s*-\s*/i, "")
    .trim();
  if (fromTitle) return decodeEntities(fromTitle);
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return h ? stripTags(h[1]) : null;
}

/** Profiles already collected, keyed by id, for resume and merge. */
async function loadExisting() {
  const map = new Map();
  if (!existsSync(OUT_FILE)) return map;
  try {
    const prev = JSON.parse(await readFile(OUT_FILE, "utf8"));
    if (prev.snapshot?.parserVersion === PARSER_VERSION) {
      for (const m of prev.members ?? []) map.set(m.parliamentId, m);
    }
  } catch { /* start clean */ }
  return map;
}

/* ----------------------------------------------------------------- main */

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`SL Politics past-members importer — ${startedAt}`);
  console.log(`Delay ${DELAY}ms · profiles: ${WANT_PROFILES ? "yes" : "no (--profiles to enable)"}`);

  /*
   * 0. Direct-id mode: fetch named profiles WITHOUT crawling the listing.
   *
   * The listing is 175 pages and this source throttles hard — around twelve
   * seconds per page — so discovering a known person through it costs an hour
   * to learn something already known. `--ids=` skips discovery entirely, which
   * is what makes it possible to guarantee a specific, named set of people
   * (former Presidents, former Prime Ministers, a priority list) independently
   * of whether the full historical crawl has finished.
   *
   * Records fetched this way merge into the same file on the same ids, so a
   * later full crawl neither duplicates them nor re-fetches them.
   */
  if (IDS) {
    const ids = IDS.split(",").map((s) => s.trim()).filter(Boolean);
    console.log(`Direct-id mode: ${ids.length} profile(s), listing not crawled.`);
    const existing = await loadExisting();
    const rows = [];
    let fetched = 0, failed = 0, reused = 0;

    for (const id of ids) {
      const cached = existing.get(id);
      if (cached?.detail) { rows.push(cached); reused++; continue; }
      const row = { parliamentId: id, profileUrl: PROFILE(id), name: cached?.name ?? null, portraitUrl: cached?.portraitUrl ?? null, legislativeService: cached?.legislativeService ?? null };
      try {
        await sleep(DELAY);
        const html = await get(PROFILE(id));
        Object.assign(row, parseProfile(html));
        row.detail = parseProfileDetail(html);
        // The listing supplies the name for a crawled member; in direct-id
        // mode it has to come from the profile page itself.
        row.name = row.name ?? nameFromProfile(html);
        row.portraitUrl = row.portraitUrl ?? `${BASE}/uploads/images/members/profile_images/thumbs/${id}.jpg`;
        fetched++;
        console.log(`  ${id.padEnd(6)} ${row.name ?? "(name not parsed)"}`);
      } catch (e) {
        row.profileError = String(e.message ?? e);
        failed++;
        console.warn(`  ${id.padEnd(6)} FAILED: ${row.profileError}`);
      }
      rows.push(row);
    }

    // Merge with everything already collected so a direct run never discards
    // the bulk crawl's work.
    const merged = new Map(existing);
    for (const r of rows) merged.set(r.parliamentId, r);

    const snapshot = {
      sourceId: SOURCE_ID, url: DIRECTORY_URL, retrievedAt: startedAt,
      contentHash: contentHash(JSON.stringify(ids.sort())),
      rawContentHash: null, rawHashIsStable: false,
      parserVersion: PARSER_VERSION, pages: 0, bytes: 0,
      mode: "direct-id",
    };
    await write([...merged.values()], snapshot, startedAt);
    console.log(`\nDirect-id import: ${fetched} fetched, ${reused} already present, ${failed} failed. Total in file: ${merged.size}.`);
    return;
  }

  /* 1. Discover the page count rather than assuming it. */
  const first = await get(LISTING(1));
  const nums = [...first.matchAll(/past-mp-listing\?page=(\d+)/g)].map((m) => Number(m[1]));
  const discovered = nums.length ? Math.max(...nums) : 1;
  const lastPage = MAX_PAGES ? Math.min(MAX_PAGES, discovered) : discovered;
  console.log(`Listing pages: ${discovered}${MAX_PAGES ? ` (limited to ${lastPage})` : ""}`);

  /* 2. Crawl the listing. */
  const byId = new Map();
  let listingPayload = first;
  for (const row of parsePastListing(first)) byId.set(row.parliamentId, row);

  for (let page = 2; page <= lastPage; page++) {
    await sleep(DELAY);
    const html = await get(LISTING(page));
    listingPayload += html;
    for (const row of parsePastListing(html)) byId.set(row.parliamentId, row);
    process.stdout.write(`\r  listing ${page}/${lastPage} — ${byId.size} members`);
  }
  process.stdout.write("\n");

  /*
   * Merge in anything already collected that this crawl did not see.
   *
   * The output is written from `rows`, so without this a crawl replaces the
   * file wholesale — and every profile fetched by `--ids=` before the crawl
   * reached that person's listing page is silently deleted. The direct-id
   * mode exists precisely because the full crawl is slow, so losing its
   * results to the slow crawl would defeat the point of having it.
   */
  const alreadyHave = await loadExisting();
  let carriedOver = 0;
  for (const [id, member] of alreadyHave) {
    if (byId.has(id)) continue;
    byId.set(id, { ...member, profileUrl: PROFILE(id) });
    carriedOver++;
  }
  if (carriedOver) console.log(`Carried over ${carriedOver} member(s) collected outside this listing crawl.`);

  let rows = [...byId.values()];
  console.log(`Parsed ${rows.length} past members from the listing.`);

  if (ONLY) {
    const wanted = new Set(ONLY.split(",").map((s) => s.trim()));
    rows = rows.filter((r) => wanted.has(r.parliamentId));
    console.log(`--only: restricted to ${rows.length} member(s).`);
  }

  const canonicalRows = JSON.stringify(
    rows.map((r) => [r.parliamentId, r.name, r.legislativeService]).sort((a, b) => a[0].localeCompare(b[0], "en")),
  );

  const snapshot = {
    sourceId: SOURCE_ID,
    url: DIRECTORY_URL,
    retrievedAt: startedAt,
    contentHash: contentHash(canonicalRows),
    rawContentHash: contentHash(listingPayload),
    rawHashIsStable: false,
    parserVersion: PARSER_VERSION,
    pages: lastPage,
    bytes: listingPayload.length,
  };

  /* 3. Profiles. */
  if (WANT_PROFILES) {
    const existing = new Map();
    if (existsSync(OUT_FILE)) {
      try {
        const prev = JSON.parse(await readFile(OUT_FILE, "utf8"));
        // A record parsed by an older parser must not be reused: the cached
        // detail records how the page was READ, not only what it said.
        if (prev.snapshot?.parserVersion === PARSER_VERSION) {
          for (const m of prev.members ?? []) if (m.detail) existing.set(m.parliamentId, m);
        }
      } catch { /* start clean */ }
    }
    if (existing.size) console.log(`Resuming: ${existing.size} profile(s) already collected.`);

    let done = 0, fetched = 0, failed = 0;
    for (const row of rows) {
      done++;
      const cached = existing.get(row.parliamentId);
      if (cached) {
        row.dateOfBirth = cached.dateOfBirth ?? null;
        row.profession = cached.profession ?? null;
        row.partyOnProfile = cached.partyOnProfile ?? null;
        row.districtOnProfile = cached.districtOnProfile ?? null;
        row.detail = cached.detail;
        continue;
      }
      try {
        await sleep(DELAY);
        const html = await get(PROFILE(row.parliamentId));
        Object.assign(row, parseProfile(html));
        row.detail = parseProfileDetail(html);
        fetched++;
      } catch (e) {
        row.profileError = String(e.message ?? e);
        failed++;
      }
      if (done % 10 === 0 || done === rows.length) {
        process.stdout.write(`\r  profiles ${done}/${rows.length} (fetched ${fetched}, failed ${failed})`);
      }
      // Checkpoint periodically so a long crawl survives interruption.
      if (fetched > 0 && fetched % 50 === 0) await write(rows, snapshot, startedAt);
    }
    process.stdout.write("\n");
  }

  await write(rows, snapshot, startedAt);

  const failedRows = rows.filter((r) => r.profileError || (WANT_PROFILES && !r.detail));
  if (failedRows.length) {
    console.warn(`\nWARNING: ${failedRows.length} profile(s) did not import. Re-run to retry.`);
    for (const r of failedRows.slice(0, 20)) console.warn(`  ${r.parliamentId}  ${r.name}  ${r.profileError ?? "(no detail)"}`);
    process.exitCode = 1;
  }
}

async function write(rows, snapshot, startedAt) {
  const members = rows.map((r) => ({
    parliamentId: r.parliamentId,
    name: r.name,
    legislativeService: r.legislativeService ?? null,
    portraitUrl: r.portraitUrl ?? null,
    dateOfBirth: r.dateOfBirth ?? null,
    profession: r.profession ?? null,
    partyOnProfile: r.partyOnProfile ?? null,
    districtOnProfile: r.districtOnProfile ?? null,
    detail: r.detail ?? null,
    profileError: r.profileError ?? null,
  }));

  const payload = {
    $comment:
      "Retrieved from the official Parliament of Sri Lanka Directory of PAST Members by " +
      "scripts/import-past-members.mjs. Not hand-edited. These share an identifier space with " +
      "the current-members import: `mp-profile/<id>` is the same person in both, so the two " +
      "datasets merge on id rather than duplicating anyone. Personal contact details published " +
      "on the source are deliberately not imported.",
    snapshot: { ...snapshot, retrievedAt: startedAt },
    counts: {
      members: members.length,
      withProfile: members.filter((m) => m.detail).length,
      withDateOfBirth: members.filter((m) => m.dateOfBirth).length,
      withParty: members.filter((m) => m.partyOnProfile).length,
      withAcademicQualifications: members.filter((m) => m.detail?.qualifications?.academic?.length).length,
      withLegislativeHistory: members.filter((m) => m.detail?.legislativeHistory?.length).length,
      withMinisterialServices: members.filter((m) => m.detail?.ministerialServices?.length).length,
      withPoliticalCareer: members.filter((m) => m.detail?.politicalCareer?.length).length,
      profileFetchFailures: members.filter((m) => m.profileError).length,
    },
    members,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  main().catch((e) => { console.error("Past-members import failed:", e); process.exit(1); });
}
