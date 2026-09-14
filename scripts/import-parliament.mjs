#!/usr/bin/env node
/**
 * Javora — Parliament of Sri Lanka importer.
 *
 *   node scripts/import-parliament.mjs [--profiles] [--delay=600]
 *
 * Retrieves the official Directory of Members, parses it, and writes
 * `src/data/imported/parliamentMembers.json` together with a snapshot
 * record describing exactly what was retrieved and when.
 *
 * This runs in Node, deliberately: the browser bundle must never be
 * responsible for reaching out to official sources (see the sync worker
 * notes in the README). It is the first real connector — the same code a
 * scheduled worker would call, minus the scheduling.
 *
 * POLITENESS. `robots.txt` was checked before this was written: it allows
 * everything except /adminpanel, /api and /preview. Requests are issued one
 * at a time with a delay between them, and `--profiles` (225 extra requests)
 * is opt-in rather than the default. An earlier browser-based extraction
 * that issued ~350 rapid requests got throttled, which is exactly the
 * behaviour this pacing exists to avoid.
 *
 * NOT RETRIEVED: profile pages also publish each member's home address,
 * telephone numbers and email. Javora records public office, not personal
 * contact details, so the parser does not read those fields at all.
 *
 * ALSO RETRIEVED (since parser version 2): the "Related Information" tab
 * panes — Qualifications, Legislative History, Portfolios Held and
 * Ministerial Services. These are inline in the profile HTML this script was
 * already downloading, so reading them costs no additional requests. An
 * earlier survey of this source concluded it published no education data;
 * that survey read only the eleven labelled fields at the top of the page and
 * was wrong. See server/fetchers/parliamentProfileDetail.ts.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { parseProfileDetail } from "../server/fetchers/parliamentProfileDetail.ts";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripTags, clean, sleep } from "../src/lib/html.ts";
import { contentHash } from "../src/sync/snapshot.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_FILE = resolve(ROOT, "src/data/imported/parliamentMembers.json");

const BASE = "https://www.parliament.lk";
const LISTING = (page) => `${BASE}/en/members-of-parliament/mp-listing?page=${page}`;
const PROFILE = (id) => `${BASE}/en/members-of-parliament/mp-profile/${id}`;
const DIRECTORY_URL = `${BASE}/en/members-of-parliament/directory-of-members/`;
const PARSER_VERSION = "parliament-directory@7";
const SOURCE_ID = "S001";

const args = process.argv.slice(2);
const WANT_PROFILES = args.includes("--profiles");
const DELAY = Number((args.find((a) => a.startsWith("--delay=")) ?? "").split("=")[1]) || 600;

/* ---------------------------------------------------------------- utils */

/** FNV-1a 32-bit, matching src/sync/snapshot.ts. Change detection only. */
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "SLPoliticsImporter/1.0 (civic records; contact via repository)" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/* --------------------------------------------------------------- parsing */

/**
 * Parse one listing page into member rows.
 *
 * Anchored on the `mp-profile/<id>` link and the `white_box` card that
 * follows it. Label-driven for party/district rather than positional, so a
 * layout change reorders nothing silently — if the labels stop matching, the
 * fields come back null and validation reports it, which is the failure mode
 * we want over quietly importing a district into the party field.
 */
export function parseListing(html) {
  const rows = [];
  // NOTE: this source writes attributes with SINGLE quotes. Every attribute
  // pattern here is quote-agnostic (['"]) — matching only double quotes
  // silently parses zero members, which is exactly what happened first time.
  const cardRe = /<a\s+href=['"]([^'"]*mp-profile\/(\d+))['"][^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const [, profileUrl, id, inner] = m;
    if (!inner.includes("white_box")) continue;

    const nameM = inner.match(/<div class=['"]mp_name_div['"]>[\s\S]*?<b>([\s\S]*?)<\/b>/);
    const roleM = inner.match(/<p class=['"]fst-italic['"]>([\s\S]*?)<\/p>/);
    const imgM = inner.match(/<img[\s\S]*?src=['"]([^'"]+)['"]/);

    const labelled = (label) => {
      const re = new RegExp(`<b>\\s*${label}\\s*</b>\\s*</p>\\s*<p[^>]*>([\\s\\S]*?)</p>`, "i");
      const hit = inner.match(re);
      return hit ? clean(stripTags(hit[1])) : null;
    };

    rows.push({
      parliamentId: id,
      profileUrl,
      name: nameM ? stripTags(nameM[1]) : null,
      role: roleM ? clean(stripTags(roleM[1])) : null,
      portraitUrl: imgM ? imgM[1] : null,
      party: labelled("Political Party"),
      district: labelled("District"),
    });
  }
  return rows;
}

/**
 * Parse a member profile page.
 *
 * Only the office-relevant fields are read. Address/phone/email are
 * deliberately not extracted — see the header note.
 */
export function parseProfile(html) {
  const fields = {};
  const re = /<div class=['"]text_tag[^'"]*['"]>\s*<p[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) fields[stripTags(m[1])] = stripTags(m[2]);
  return {
    dateOfBirth: clean(fields["Date of Birth"]),
    profession: clean(fields["Profession"]),
    portfolio: clean(fields["Portfolio"]),
    // Current members are labelled "Political Party"; past members' profiles
    // say "Last Elected Party" instead. Reading only the first label leaves
    // every former MP with no party at all.
    partyOnProfile: clean(fields["Political Party"] ?? fields["Last Elected Party"]),
    districtOnProfile: clean(fields["District"]),
  };
}

/* ----------------------------------------------------------------- main */

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`SL Politics Parliament importer — started ${startedAt}`);
  console.log(`Delay between requests: ${DELAY}ms. Profiles: ${WANT_PROFILES ? "yes" : "no (--profiles to enable)"}`);

  // 1. Discover how many listing pages there are, rather than assuming.
  const first = await get(LISTING(1));
  const pageNums = [...first.matchAll(/mp-listing\?page=(\d+)/g)].map((m) => Number(m[1]));
  const lastPage = pageNums.length ? Math.max(...pageNums) : 1;
  console.log(`Listing pages: ${lastPage}`);

  const pages = [{ page: 1, html: first }];
  for (let p = 2; p <= lastPage; p++) {
    await sleep(DELAY);
    process.stdout.write(`\r  fetching listing page ${p}/${lastPage}`);
    pages.push({ page: p, html: await get(LISTING(p)) });
  }
  process.stdout.write("\n");

  const rows = [];
  for (const { html } of pages) rows.push(...parseListing(html));
  console.log(`Parsed ${rows.length} members from listing.`);

  // Two hashes, and the difference between them matters.
  //
  // `rawContentHash` is over the bytes as retrieved. For THIS source it is
  // useless as a change signal: every page embeds a freshly generated CSRF
  // token, so the raw bytes differ on every single fetch even when not one
  // member has changed. Hashing raw HTML here would report "changed" forever
  // and fire a stream of spurious change events. It is kept only as a record
  // of what was retrieved.
  //
  // `dataHash` is over the PARSED rows in a canonical order — semantic
  // change detection. It moves if and only if a member, party, district or
  // portfolio actually changed, which is the question the pipeline is
  // really asking. This is the hash change detection should compare.
  const listingPayload = pages.map((p) => p.html).join("\n");
  const canonicalRows = JSON.stringify(
    [...rows]
      .sort((a, b) => a.parliamentId.localeCompare(b.parliamentId, "en"))
      .map((r) => [r.parliamentId, r.name, r.party, r.district, r.role]),
  );

  const snapshot = {
    sourceId: SOURCE_ID,
    url: DIRECTORY_URL,
    retrievedAt: startedAt,
    /** Semantic hash — the one to compare. See note above. */
    contentHash: contentHash(canonicalRows),
    /** Byte hash of the retrieved HTML. Unstable for this source (CSRF token). */
    rawContentHash: contentHash(listingPayload),
    rawHashIsStable: false,
    parserVersion: PARSER_VERSION,
    pages: lastPage,
    bytes: listingPayload.length,
  };
  console.log(`Snapshot data hash: ${snapshot.contentHash} (semantic, over ${rows.length} parsed rows)`);
  console.log(`Snapshot raw hash:  ${snapshot.rawContentHash} (unstable — page embeds a per-request CSRF token)`);

  // 2. Optionally enrich from each member's own profile page.
  if (WANT_PROFILES) {
    // Resume from whatever a previous run already collected.
    let existing = {};
    if (existsSync(OUT_FILE)) {
      try {
        const prev = JSON.parse(await readFile(OUT_FILE, "utf8"));
        // A record parsed by an OLDER parser must not be reused: the cached
        // `detail` reflects how the page was read, not just what it said.
        // Skipping this check silently preserves every parsing bug the new
        // version fixes.
        if (prev.snapshot?.parserVersion !== PARSER_VERSION) throw new Error("parser changed");
        for (const m of prev.members ?? []) {
          // Only treat a member as cached when the CROSS-CHECK fields are
          // present, not merely the biographical ones. An earlier version
          // cached on dateOfBirth alone and carried forward only that and
          // profession, silently dropping partyOnProfile/districtOnProfile —
          // which quietly disabled conflict detection on every resumed run.
          // The cache key must cover EVERYTHING a run needs, not just what
          // an older run happened to collect. When the parser started reading
          // the Related Information panes, a cache keyed only on
          // party/district would have marked all 225 members "already done"
          // and written null qualifications for every one of them.
          if ((m.partyOnProfile || m.districtOnProfile) && m.detail) {
            existing[m.parliamentId] = {
              dateOfBirth: m.dateOfBirth ?? null,
              profession: m.profession ?? null,
              partyOnProfile: m.partyOnProfile ?? null,
              districtOnProfile: m.districtOnProfile ?? null,
              // The "Related Information" panes. Cached alongside the fields
              // above so a resumed run does not report every member's
              // qualifications as newly vanished.
              detail: m.detail ?? null,
            };
          }
        }
      } catch { /* start clean if the previous file is unreadable */ }
    }

    let done = 0;
    for (const row of rows) {
      done++;
      if (existing[row.parliamentId]) {
        Object.assign(row, existing[row.parliamentId]);
        continue;
      }
      try {
        await sleep(DELAY);
        // One fetch, both readings. The detail panes are inline in this
        // same document; the original importer downloaded and discarded them.
        const html = await get(PROFILE(row.parliamentId));
        Object.assign(row, parseProfile(html));
        row.detail = parseProfileDetail(html);
      } catch (e) {
        row.profileError = String(e.message ?? e);
      }
      process.stdout.write(`\r  profiles ${done}/${rows.length}`);
    }
    process.stdout.write("\n");
  }

  // 3. Write the dataset.
  const members = rows.map((r) => ({
    parliamentId: r.parliamentId,
    name: r.name,
    party: r.party,
    district: r.district,
    role: r.role ?? null,
    dateOfBirth: r.dateOfBirth ?? null,
    profession: r.profession ?? null,
    portraitUrl: r.portraitUrl ?? null,
    partyOnProfile: r.partyOnProfile ?? null,
    districtOnProfile: r.districtOnProfile ?? null,
    detail: r.detail ?? null,
    // A failed fetch MUST survive into the output. Recorded on the row but
    // dropped here, a member whose profile could not be retrieved looked
    // exactly like a member the source publishes nothing about — the same
    // "absence of data" / "absence of retrieval" confusion this project
    // exists to prevent, this time inside its own importer.
    profileError: r.profileError ?? null,
  }));

  const payload = {
    $comment:
      "Retrieved from the official Parliament of Sri Lanka Directory of Members by scripts/import-parliament.mjs. " +
      "Not hand-edited. Personal contact details published on the source are deliberately not imported.",
    snapshot,
    counts: {
      members: members.length,
      withRole: members.filter((m) => m.role).length,
      withDateOfBirth: members.filter((m) => m.dateOfBirth).length,
      withProfession: members.filter((m) => m.profession).length,
      withAcademicQualifications: members.filter((m) => m.detail?.qualifications?.academic?.length).length,
      withProfessionalQualifications: members.filter((m) => m.detail?.qualifications?.professional?.length).length,
      withLegislativeHistory: members.filter((m) => m.detail?.legislativeHistory?.length).length,
      withPortfoliosHeld: members.filter((m) => m.detail?.portfoliosHeld?.length).length,
      withMinisterialServices: members.filter((m) => m.detail?.ministerialServices?.length).length,
      profileFetchFailures: members.filter((m) => m.profileError).length,
      profilesMissingDetail: WANT_PROFILES ? members.filter((m) => !m.detail).length : null,
    },
    members,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`Wrote ${OUT_FILE}`);
  console.log(JSON.stringify(payload.counts, null, 2));

  // Loud, not buried in a count. A silent partial import is worse than a
  // failed one, because it looks like it worked.
  const failed = members.filter((m) => m.profileError || (WANT_PROFILES && !m.detail));
  if (failed.length) {
    console.warn(`
WARNING: ${failed.length} profile(s) did not import. Re-run to retry:`);
    for (const m of failed) console.warn(`  ${m.parliamentId}  ${m.name}  ${m.profileError ?? "(no detail returned)"}`);
    process.exitCode = 1;
  }
}

/**
 * Run only when executed directly.
 *
 * This file exports its parsers, and importing one of them used to execute the
 * entire import as a side effect — which silently overwrote the dataset with a
 * listing-only run, discarding every profile detail it had just spent four
 * minutes fetching. A module that does work merely by being imported is a trap
 * for exactly the kind of small utility script that wants to reuse its parsers.
 */
const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  main().catch((e) => {
    console.error("Import failed:", e);
    process.exit(1);
  });
}
