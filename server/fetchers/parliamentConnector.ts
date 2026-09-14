/**
 * Javora — Parliament of Sri Lanka connector (live).
 *
 * The real, working connector: it retrieves
 * https://www.parliament.lk/en/members-of-parliament/directory-of-members/
 * (paginated) and each member's own profile page, parses them, and normalises
 * the result into the shape `syncSource` writes to the canonical database.
 *
 * `robots.txt` was checked before this was written — it disallows only
 * /adminpanel, /api and /preview. Requests are issued one at a time with a
 * configurable delay; the profile pass is opt-in because it is 225 extra
 * requests. An earlier browser-based extraction that fired a few hundred
 * rapid requests was throttled by the source, which is the correct response
 * from them and the reason for the pacing here.
 *
 * NOT RETRIEVED: profile pages also publish each member's home address,
 * telephone numbers and email. Javora records public office, not contact
 * details, so those fields are never read.
 */

import {
  splitCompoundRole,
  roleTypeForOffice,
  ministryFromTitle,
  canonicalNameFrom,
  honorificFrom,
  postNominalFrom,
  validateMemberRows,
  parliamentProfileUrl,
  parliamentListingUrl,
  PARLIAMENT_DIRECTORY_URL,
  PARLIAMENT_SOURCE_ID,
  PARLIAMENT_PARSER_VERSION,
  type ParliamentMemberRow,
} from "../../src/sync/connectors/parliament.ts";
import { contentHash } from "../../src/sync/snapshot.ts";
import { buildSearchIndex } from "../../src/lib/identity.ts";
import { slugify } from "../../src/lib/slug.ts";
import { stripTags, clean, sleep } from "../../src/lib/html.ts";
import { precedenceFor } from "../../src/data/roles.ts";
import { RoleType } from "../../src/types/models.ts";
import type { ConnectorRun, NormalisedPerson, NormalisedPosition } from "../sync/syncSource.ts";
import type { ValidationProblem } from "../../src/sync/connectors/types.ts";

export const PARLIAMENT_CONNECTOR_VERSION = "parliament-connector@1";

const USER_AGENT = "SLPoliticsSync/1.0 (civic public-record platform)";

/* ==========================================================================
   HTTP
   ========================================================================== */

async function get(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
   Parsing
   ========================================================================== */

/**
 * Parse one listing page.
 *
 * NOTE: this source writes attributes with SINGLE quotes. Every attribute
 * pattern is quote-agnostic — matching only double quotes silently parses
 * zero members, which is exactly what happened the first time.
 */
export function parseListing(html: string): ParliamentMemberRow[] {
  const rows: ParliamentMemberRow[] = [];
  const cardRe = /<a\s+href=['"]([^'"]*mp-profile\/(\d+))['"][^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;

  while ((match = cardRe.exec(html))) {
    const [, profileUrl, id, inner] = match as unknown as [string, string, string, string];
    if (!inner.includes("white_box")) continue;

    const nameM = inner.match(/<div class=['"]mp_name_div['"]>[\s\S]*?<b>([\s\S]*?)<\/b>/);
    const roleM = inner.match(/<p class=['"]fst-italic['"]>([\s\S]*?)<\/p>/);
    const imgM = inner.match(/<img[\s\S]*?src=['"]([^'"]+)['"]/);

    const labelled = (label: string): string | null => {
      const re = new RegExp(`<b>\\s*${label}\\s*</b>\\s*</p>\\s*<p[^>]*>([\\s\\S]*?)</p>`, "i");
      const hit = inner.match(re);
      return hit ? clean(stripTags(hit[1]!)) : null;
    };

    rows.push({
      parliamentId: id,
      profileUrl,
      name: nameM ? stripTags(nameM[1]!) : "",
      role: roleM ? clean(stripTags(roleM[1]!)) : null,
      portraitUrl: imgM ? imgM[1]! : null,
      party: labelled("Political Party"),
      district: labelled("District"),
      dateOfBirth: null,
      profession: null,
    });
  }
  return rows;
}

/** Parse a member profile page. Office-relevant fields only. */
export function parseProfile(html: string): {
  dateOfBirth: string | null;
  profession: string | null;
  partyOnProfile: string | null;
  districtOnProfile: string | null;
} {
  const fields: Record<string, string> = {};
  const re =
    /<div class=['"]text_tag[^'"]*['"]>\s*<p[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) fields[stripTags(m[1]!)] = stripTags(m[2]!);

  return {
    dateOfBirth: clean(fields["Date of Birth"]),
    profession: clean(fields["Profession"]),
    partyOnProfile: clean(fields["Political Party"]),
    districtOnProfile: clean(fields["District"]),
  };
}

/* ==========================================================================
   Normalisation
   ========================================================================== */

const partyDisplayName = (name: string): string => name.replace(/\s*\([^)]+\)\s*$/, "").trim();

function abbreviationFrom(name: string): string {
  const m = name.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1]!.trim();
  return name.split(/\s+/).filter((w) => w.length > 2).map((w) => w[0]!.toUpperCase()).join("").slice(0, 5);
}

/**
 * Turn parsed rows into canonical people.
 *
 * Every position gets `startDate: undefined` and `currentAsOf` instead: the
 * directory asserts *that* an office is held, never *since when*, and
 * inventing a start date is exactly the fabrication this platform forbids.
 *
 * UNDEFINED, NOT NULL — the same distinction `dateOfBirth`/`profession`
 * already draw two lines down. This connector never parses a member's
 * legislative-history pane (see the file header: "details, so those fields
 * are never read"), so it can never truthfully assert "no start date exists"
 * — only "this run did not look". `null` would tell `upsertPosition`'s
 * `keep()` the opposite: that the absence is confirmed, which erases a real
 * per-term start date `scripts/promote-detail.mjs` or
 * `scripts/promote-past-members.mjs` already established from the profile's
 * own Legislative History pane. Verified against a live run: before this
 * fix, a single ordinary S001 sync reset 269 members' start dates to null.
 */
export function normaliseMembers(
  rows: ParliamentMemberRow[],
  retrievedAt: string,
  /**
   * Whether profile pages were fetched this run. When false, date of birth
   * and profession are reported as `undefined` — "this run did not look" —
   * rather than null, so a listing-only sync cannot erase what a fuller run
   * established. See the `keep()` note in server/db/store.ts.
   */
  profilesFetched = true,
): NormalisedPerson[] {
  const asOf = retrievedAt.slice(0, 10);

  // Slugs de-duplicated deterministically: sorting by member id first keeps
  // which person gets the plain slug stable across runs, so a URL does not
  // change because the source reordered its listing.
  const taken = new Set<string>();
  const slugById = new Map<string, string>();
  for (const row of [...rows].sort((a, b) => a.parliamentId.localeCompare(b.parliamentId, "en"))) {
    const base = slugify(canonicalNameFrom(row.name)) || `member-${row.parliamentId}`;
    const slug = taken.has(base) ? `${base}-${row.parliamentId}` : base;
    taken.add(slug);
    slugById.set(row.parliamentId, slug);
  }

  return rows.map((row) => {
    const canonicalName = canonicalNameFrom(row.name);
    const honorific = honorificFrom(row.name);
    const postNominal = postNominalFrom(row.name);

    const aliases = [...new Set([
      row.name.replace(/\s+/g, " ").trim(),
      honorific ? `${honorific} ${canonicalName}` : null,
      postNominal ? `${canonicalName}, ${postNominal}` : null,
    ].filter((a): a is string => Boolean(a) && a !== canonicalName))];

    const partyId = row.party ? slugify(row.party) : null;
    const districtId = row.district ? slugify(row.district) : null;

    const positions: NormalisedPosition[] = [
      {
        // Everyone in this directory is, by definition of the directory, a
        // sitting member.
        title: "Member of Parliament",
        roleType: RoleType.MEMBER_OF_PARLIAMENT,
        institution: "Parliament of Sri Lanka",
        districtId,
        startDate: undefined,
        currentAsOf: asOf,
        precedence: precedenceFor(RoleType.MEMBER_OF_PARLIAMENT),
        factType: "parliamentary-membership",
        // Membership is not a slot another office replaces.
        supersedable: false,
      },
    ];

    for (const title of splitCompoundRole(row.role)) {
      const roleType = roleTypeForOffice(title);
      const ministerial =
        roleType === RoleType.CABINET_MINISTER ||
        roleType === RoleType.STATE_MINISTER ||
        roleType === RoleType.DEPUTY_MINISTER ||
        roleType === RoleType.PRIME_MINISTER;

      positions.push({
        title,
        roleType,
        institution: ministerial ? "Cabinet of Ministers" : "Parliament of Sri Lanka",
        ministry: ministryFromTitle(title),
        startDate: undefined,
        currentAsOf: asOf,
        precedence: precedenceFor(roleType),
        factType: ministerial ? "portfolio-assignment" : "parliamentary-membership",
        // A portfolio CAN be replaced by another in a reshuffle.
        supersedable: ministerial,
      });
    }

    return {
      externalId: row.parliamentId,
      externalIdKey: "parliament",
      canonicalName,
      slug: slugById.get(row.parliamentId)!,
      aliases,
      dateOfBirth: profilesFetched ? row.dateOfBirth : undefined,
      // Biography is left null: the source publishes no prose. Profession is
      // its own field, not a sentence pretending to be a biography.
      biography: undefined,
      profession: profilesFetched ? row.profession : undefined,
      portraitUrl: row.portraitUrl,
      portraitCredit: "Parliament of Sri Lanka",
      // parliament.lk states "Copyright © The Parliament of Sri Lanka. All
      // Rights Reserved." A government publishing an image is not a grant of
      // reuse, so the portrait is recorded but not displayed — the profile
      // falls back to the monogram until rights are actually established.
      portraitRights: "all-rights-reserved",
      portraitRightsNote:
        "parliament.lk asserts: Copyright © The Parliament of Sri Lanka. All Rights Reserved. " +
        "No reuse licence is published, so SL Politics records the portrait's location without displaying it.",
      partyId,
      partyName: row.party ? partyDisplayName(row.party) : null,
      partyAbbreviation: row.party ? abbreviationFrom(row.party) : null,
      districtId,
      districtName: row.district,
      sourceUrl: parliamentProfileUrl(row.parliamentId),
      searchText: buildSearchIndex([
        canonicalName, row.name, ...aliases,
        row.party ? partyDisplayName(row.party) : null,
        row.party ? abbreviationFrom(row.party) : null,
        row.district, row.profession, row.role,
        ...splitCompoundRole(row.role),
        "Member of Parliament", "MP",
      ]),
      positions,
    };
  });
}

/**
 * Canonical, order-stable serialisation of the parsed records.
 *
 * This — not the raw HTML — is what gets hashed for change detection. Every
 * page of this source embeds a freshly generated CSRF token, so a raw-byte
 * hash differs on every request and would report "changed" forever.
 */
export function canonicalPayloadFor(rows: ParliamentMemberRow[]): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a.parliamentId.localeCompare(b.parliamentId, "en"))
      .map((r) => [r.parliamentId, r.name, r.party, r.district, r.role, r.dateOfBirth, r.profession]),
  );
}

/* ==========================================================================
   The connector
   ========================================================================== */

export interface ParliamentConnectorOptions {
  /** Milliseconds between requests. Politeness floor, not a suggestion. */
  delayMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Also fetch each member's profile (225 extra requests). */
  withProfiles?: boolean;
  /** Cap pages fetched; for smoke tests. */
  maxPages?: number;
  /** Injectable for tests. */
  fetchImpl?: (url: string, timeoutMs: number) => Promise<string>;
  onProgress?: (message: string) => void;
}

export function createParliamentConnector(options: ParliamentConnectorOptions = {}): ConnectorRun {
  const {
    delayMs = 500,
    timeoutMs = 30_000,
    withProfiles = false,
    maxPages,
    fetchImpl = get,
    onProgress,
  } = options;

  return {
    sourceId: PARLIAMENT_SOURCE_ID,
    connectorVersion: PARLIAMENT_CONNECTOR_VERSION,
    parserVersion: PARLIAMENT_PARSER_VERSION,
    url: PARLIAMENT_DIRECTORY_URL,

    async fetch() {
      const retrievedAt = new Date().toISOString();

      // Discover how many pages there are rather than assuming.
      const firstPage = await fetchImpl(parliamentListingUrl(1), timeoutMs);
      const pageNumbers = [...firstPage.matchAll(/mp-listing\?page=(\d+)/g)].map((m) => Number(m[1]));
      const lastPage = Math.min(
        pageNumbers.length ? Math.max(...pageNumbers) : 1,
        maxPages ?? Number.MAX_SAFE_INTEGER,
      );
      onProgress?.(`listing pages: ${lastPage}`);

      const pages = [firstPage];
      for (let page = 2; page <= lastPage; page++) {
        await sleep(delayMs);
        onProgress?.(`listing ${page}/${lastPage}`);
        pages.push(await fetchImpl(parliamentListingUrl(page), timeoutMs));
      }

      const rows: ParliamentMemberRow[] = [];
      for (const html of pages) rows.push(...parseListing(html));

      const problems: ValidationProblem[] = [];

      if (withProfiles) {
        let done = 0;
        for (const row of rows) {
          done++;
          try {
            await sleep(delayMs);
            const profile = parseProfile(await fetchImpl(parliamentProfileUrl(row.parliamentId), timeoutMs));
            row.dateOfBirth = profile.dateOfBirth;
            row.profession = profile.profession;
            row.partyOnProfile = profile.partyOnProfile;
            row.districtOnProfile = profile.districtOnProfile;
          } catch (error) {
            // One unreadable profile must not abort an otherwise good run.
            problems.push({
              severity: "warning",
              code: "profile-fetch-failed",
              message: error instanceof Error ? error.message : String(error),
              subject: row.parliamentId,
            });
          }
          if (done % 25 === 0) onProgress?.(`profiles ${done}/${rows.length}`);
        }
      }

      // Validation runs on the parsed rows, including the cross-page
      // party/district check when profiles were fetched.
      const validation = validateMemberRows(rows);
      problems.push(...validation.problems);

      const canonical = canonicalPayloadFor(rows);

      return {
        retrievedAt,
        canonicalPayload: canonical,
        rawContentHash: contentHash(pages.join("\n")),
        // Documented false: the pages carry a per-request CSRF token.
        rawHashIsStable: false,
        people: normaliseMembers(rows, retrievedAt, withProfiles),
        problems,
      };
    },
  };
}
