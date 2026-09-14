/**
 * Javora — Parliament of Sri Lanka connector.
 *
 * Source: the official Directory of Members at
 * https://www.parliament.lk/en/members-of-parliament/directory-of-members/
 * (paginated as `mp-listing?page=N`), plus each member's own profile page at
 * `mp-profile/<id>`. `robots.txt` was checked before any retrieval: it
 * disallows only `/adminpanel`, `/api` and `/preview`, and allows the member
 * directory.
 *
 * WHAT THE SOURCE ACTUALLY GIVES US, AND WHAT IT DOES NOT
 *
 * Gives: member name, electoral district (or "National List"), political
 * party, current portfolio/parliamentary role, a stable numeric member id,
 * a profile URL, a portrait URL, and — from the profile page — date of birth
 * at day precision and profession.
 *
 * Does NOT give: any date on which an office began or ended. The directory
 * asserts *that* a person currently holds an office, never *since when*. So
 * every position produced here has `startDate: null` and carries
 * `currentAsOf` instead — see `Position.currentAsOf`. The profile page's
 * "Legislative Service" duration is deliberately NOT used to back-compute a
 * start date: for members with previous terms it is cumulative across
 * parliaments, so treating it as this term's start would manufacture a wrong
 * date. Unknown stays unknown.
 *
 * NOT RETAINED: profile pages also publish each member's home address,
 * personal telephone numbers and email. Javora is a record of public office,
 * not a contact database, and republishing 225 residential addresses carries
 * real-world risk for no product benefit. The parser drops those fields.
 */

import { RoleType, type RoleTypeValue } from "../../types/models.ts";
import { historicalRoleType } from "../../data/historicalOffices.ts";
import type {
  FetchedDocument,
  SourceConnector,
  ValidationProblem,
  ValidationResult,
} from "./types.ts";

/** The Parliament source's own row shape, in its own vocabulary. */
export interface ParliamentMemberRow {
  parliamentId: string;
  name: string;
  profileUrl: string;
  portraitUrl: string | null;
  /** Verbatim party name as Parliament writes it, e.g. "Jathika Jana balawegaya". */
  party: string | null;
  /** Verbatim district, e.g. "Mahanuwara", or "National List". */
  district: string | null;
  /** Verbatim compound role string, or null for a member holding no extra office. */
  role: string | null;
  dateOfBirth: string | null;
  profession: string | null;
  /** Party as printed on the member's own profile page, for cross-checking. */
  partyOnProfile?: string | null;
  districtOnProfile?: string | null;
}

/* ==========================================================================
   Compound role splitting
   ========================================================================== */

/**
 * Office-starting phrases. A " and " is treated as a separator between two
 * offices ONLY when what follows begins with one of these.
 *
 * This matters because "and" appears inside ministry names at least as often
 * as it separates offices: "Ports and Civil Aviation", "Finance and
 * Planning", "Trade, Commerce and Food Security". A naive split on " and "
 * would shred those into offices that do not exist — inventing public
 * positions, which is the single worst thing this importer could do.
 *
 * Ordered longest-first so "Deputy Minister of" is tested before "Minister
 * of". Validated against all 56 distinct role strings the directory
 * currently publishes; see `parliament.test.ts`, which pins every compound
 * case found in the live data.
 */
const OFFICE_STARTERS = [
  "Deputy Minister of ",
  "State Minister of ",
  "Minister of ",
  "Prime Minister",
  "Chief Government Whip",
  "Chief Opposition Whip",
  "Leader of the House",
  "Leader of the Opposition",
];

const startsWithOffice = (text: string): boolean =>
  OFFICE_STARTERS.some((starter) => text.startsWith(starter));

/**
 * Split a verbatim role string into the individual offices it names.
 *
 * Conservative by construction: anything that does not match the explicit
 * separator rule is returned unchanged as a single office. "Deputy Speaker
 * and the Chair of Committees" therefore stays whole — that is one office
 * with a compound official name, and the rule correctly declines to split it.
 */
export function splitCompoundRole(role: string | null): string[] {
  const text = (role ?? "").trim();
  if (!text) return [];

  const offices: string[] = [];
  let current = "";
  const words = text.split(" ");

  for (let i = 0; i < words.length; i++) {
    if (words[i] === "and" && current) {
      const rest = words.slice(i + 1).join(" ");
      if (startsWithOffice(rest)) {
        offices.push(current.trim());
        current = "";
        continue;
      }
    }
    current += (current ? " " : "") + words[i];
  }
  if (current.trim()) offices.push(current.trim());
  return offices.filter(Boolean);
}

/**
 * Classify one already-split office title.
 *
 * Prefix-based, unlike `data/roles.ts`'s exact-match table — justified here
 * because these titles come from a single source with a consistent, observed
 * naming convention, and the ordering below tests the more specific prefixes
 * first so "Deputy Minister of X" can never be read as a cabinet post.
 */
export function roleTypeForOffice(title: string): RoleTypeValue {
  const t = title.trim();
  // Historical title forms, which only appear once the past-members directory
  // is read. Parliament wrote offices differently in earlier decades, and the
  // head of state appears in members' own service records.
  if (/^H\.?\s?E\.?\s+the President\b/i.test(t)) return RoleType.PRESIDENT;
  if (/^President of the Democratic Socialist Republic/i.test(t)) return RoleType.PRESIDENT;
  if (/^Foreign Minister$/i.test(t)) return RoleType.CABINET_MINISTER;
  if (/^Speaker$/i.test(t)) return RoleType.SPEAKER;
  if (/^Deputy Speaker/i.test(t)) return RoleType.DEPUTY_SPEAKER;
  if (/^Prime Minister/i.test(t)) return RoleType.PRIME_MINISTER;
  if (/^Leader of the Opposition/i.test(t)) return RoleType.OPPOSITION_LEADER;
  if (/^Deputy Minister of /i.test(t)) return RoleType.DEPUTY_MINISTER;
  if (/^State Minister of /i.test(t)) return RoleType.STATE_MINISTER;
  // Historical titles, which only appear once Ministerial Services is read.
  if (/^Non[- ]Cabinet Minister (of|for) /i.test(t)) return RoleType.NON_CABINET_MINISTER;
  // "Minister for X" and "Minister of X" are the same office; the source uses
  // both, and older entries also carry the source's own typos.
  if (/^Minister (of|for) /i.test(t)) return RoleType.CABINET_MINISTER;
  if (/^(Leader of the House|Chief Government Whip|Chief Opposition Whip|Deputy Chair(person|man) of Committees)/i.test(t)) {
    return RoleType.PARLIAMENTARY_OFFICE;
  }
  // Offices of earlier parliaments, and the source's own misspellings of
  // them. Kept in their own module because there are ~120 of them and they
  // are about historical vocabulary rather than the current directory.
  const historical = historicalRoleType(t);
  if (historical) return historical;
  return RoleType.OTHER_PUBLIC_OFFICE;
}

/**
 * The portfolio a ministerial title governs — the text after "Minister of ".
 *
 * Derived from the title the source published, not separately sourced, and
 * null for any office that is not a ministry.
 */
export function ministryFromTitle(title: string): string | null {
  // "of" and "for" are both used by this source, as is the "Non Cabinet"
  // rank. Matching only "Minister of" leaves a real portfolio unrecorded on
  // offices that plainly have one.
  const m = title.match(/^(?:Deputy |State |Non[- ]Cabinet )?Minister (?:of|for) (.+)$/i);
  return m ? m[1]!.trim() : null;
}

/* ==========================================================================
   Name normalisation
   ========================================================================== */

/**
 * Parliament prints every member as `Hon. (Prof.) A.B.C. Name, M.P.`, and 26
 * of them additionally carry a professional post-nominal:
 * `Hon. Rauff Hakeem, Attorney at Law, M.P.`
 *
 * The honorific prefix, the ", M.P." suffix and the post-nominal are
 * decoration the source applies around the name, not part of it, so they are
 * stripped for the canonical name and captured separately. The verbatim
 * printed string is still kept as an alias, so the form the source actually
 * published remains searchable and auditable.
 *
 * Whitespace is normalised first: the live data contains both a stray space
 * before a comma ("Priyantha Wijerathna , Attorney at Law") and doubled
 * spaces after one, and neither should reach a canonical name.
 */
/**
 * The source writes honorifics three ways, all present in the live data:
 *   parenthesised   — "Hon. (Prof.) A.H.M.H. Abayarathna, M.P."
 *   bare            — "Hon. Dr. Harini Amarasuriya, M.P."
 *   rank + suffix   — "Hon. Major General (Rtd.) Aruna Jayasekera, M.P."
 * All three must be stripped, or the honorific ends up inside the canonical
 * name and the person's URL slug ("dr-harini-amarasuriya").
 */
const HONORIFIC = "Prof|Dr|Mrs|Ms|Mr|Rev|Ven|Eng|Adv|Major General|Major|Colonel|Lt\\. Col|Rear Admiral|Admiral";
// Whitespace is allowed INSIDE the brackets: the source publishes
// "Hon. (Ven.)( Dr.) OMALPE SOBHITHA THERO", with a space before "Dr.".
const HONORIFIC_PATTERN =
  `(?:\\(\\s*(?:${HONORIFIC})\\.?\\s*\\)|(?:${HONORIFIC})\\.?)(?:\\s*\\(Rtd\\.?\\))?`;
const POST_NOMINAL = "Attorney at Law|PC";

export function canonicalNameFrom(printed: string): string {
  // "Hon." can repeat: the source publishes "Hon. Hon. L.G. Wasantha
  // Piyatissa M.P., M.P." Stripping once leaves the second one in the name.
  let name = String(printed)
    .replace(/\s+/g, " ")
    .trim()
    // "Rt. Hon." (Right Honourable) precedes the plain "Hon." on the earliest
    // members — "Rt. Hon. D.S. Senanayake" — and "Hon." can itself repeat:
    // the source publishes "Hon. Hon. L.G. Wasantha Piyatissa".
    .replace(/^(?:(?:Rt\.?|Right)\s*)?(?:Hon(?:ourable)?\.?\s*)+/i, "")
    /*
     * A bracketed block of titles anywhere in the name.
     *
     * "John Lionel (General the Rt.Hon. Sir) Kotelawala" — the parenthetical
     * holds a rank and two honorifics, not a name. It is removed ONLY when
     * every word inside it is a title word, so a genuine parenthetical (an
     * alternate spelling, a maiden name) is left alone.
     */
    .replace(
      /\s*\((?:\s*(?:General|Colonel|Major|Admiral|Sir|Dame|the|Rt\.?|Right|Hon(?:ourable)?\.?|Dr\.?|Prof\.?|Ven\.?|Rev\.?)\s*)+\)\s*/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  // Honorifics can STACK — the live data contains "Hon. (Dr.)(Ms.) Kaushalya
  // Ariyarathne, M.P." — so strip repeatedly rather than once. The `+g`
  // guard stops a pathological pattern from looping forever.
  const leading = new RegExp(`^${HONORIFIC_PATTERN}\\s*`, "i");
  for (let guard = 0; guard < 4 && leading.test(name); guard++) {
    name = name.replace(leading, "").trim();
  }

  // Post-nominals stack too, and the past-members directory doubles them:
  // "Hon. MR. RAJAH KUGANESWARAN, M.P., M.P." is what the source publishes.
  // Stripping once leaves the second one inside the canonical name.
  // `[\s,]*` rather than a single optional comma: the source publishes
  // "Hon. DAYASRITHA THISSERA, M.P.,, M.P." — two commas and two post-nominals
  // — and a one-comma pattern leaves ", M.P." inside the canonical name.
  //
  // "Thero" requires a preceding COMMA, unlike the others. It is a Buddhist
  // monastic title that the source both appends as a suffix AND uses as part
  // of the name — "Hon. (Ven.) APAREKKE PUNNANANDA THERO, M.P., Thero, M.P."
  // The trailing ", Thero" is the duplicate; the one inside the name is how
  // the member is actually known, and stripping it would rename them.
  const trailing = new RegExp(
    `(?:[\\s,]*(?:M\\.?P\\.?|${POST_NOMINAL})|,\\s*Thero)[\\s,]*$`,
    "i",
  );
  for (let guard = 0; guard < 4 && trailing.test(name); guard++) {
    name = name.replace(trailing, "").trim();
  }
  return name.replace(/[,\s]+$/, "").trim();
}

/** Honorific captured from the printed name, where the source gave one. */
export function honorificFrom(printed: string): string | null {
  const m = String(printed)
    .replace(/\s+/g, " ")
    .match(new RegExp(`^Hon\\.\\s*(${HONORIFIC_PATTERN})\\s`, "i"));
  return m ? m[1]!.replace(/[()]/g, "").trim() : null;
}

/** Professional post-nominal ("Attorney at Law", "PC"), where the source gave one. */
export function postNominalFrom(printed: string): string | null {
  const m = String(printed)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*M\.?P\.?\s*$/i, "")
    .match(new RegExp(`,\\s*(${POST_NOMINAL})\\s*$`, "i"));
  return m ? m[1]! : null;
}

/* ==========================================================================
   Validation
   ========================================================================== */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Assert what must hold for a Parliament row to be importable.
 *
 * Returns problems rather than throwing: a single malformed member should
 * surface for review, not abort an import of 224 good ones. Cross-page
 * disagreement (listing vs profile) is reported as an error because it means
 * one of the two pages is being parsed wrongly, or the source itself is
 * inconsistent — either way a human should look before it is published.
 */
export function validateMemberRows(rows: ParliamentMemberRow[]): ValidationResult {
  const problems: ValidationProblem[] = [];
  const seen = new Map<string, string>();

  for (const row of rows) {
    const subject = row.parliamentId || row.name || null;

    if (!row.parliamentId) {
      problems.push({ severity: "error", code: "missing-external-id", message: "Row has no Parliament member id; identity cannot be resolved safely.", subject });
    } else if (seen.has(row.parliamentId)) {
      problems.push({ severity: "error", code: "duplicate-external-id", message: `Parliament id ${row.parliamentId} appears more than once (also "${seen.get(row.parliamentId)}").`, subject });
    } else {
      seen.set(row.parliamentId, row.name);
    }

    if (!row.name?.trim()) {
      problems.push({ severity: "error", code: "missing-name", message: "Row has no member name.", subject });
    }
    if (!row.profileUrl?.startsWith("https://")) {
      problems.push({ severity: "error", code: "bad-profile-url", message: "Profile URL is missing or not https.", subject });
    }
    if (!row.party) {
      problems.push({ severity: "warning", code: "missing-party", message: "No political party recorded for this member.", subject });
    }
    if (!row.district) {
      problems.push({ severity: "warning", code: "missing-district", message: "No district recorded for this member.", subject });
    }
    if (row.dateOfBirth && !ISO_DAY.test(row.dateOfBirth)) {
      problems.push({ severity: "warning", code: "unparsable-dob", message: `Date of birth "${row.dateOfBirth}" is not an ISO day-precision date.`, subject });
    }

    // Cross-check the two pages that both state party and district.
    if (row.partyOnProfile && row.party && row.partyOnProfile !== row.party) {
      problems.push({ severity: "error", code: "party-conflict", message: `Directory says party "${row.party}", profile page says "${row.partyOnProfile}".`, subject });
    }
    if (row.districtOnProfile && row.district && row.districtOnProfile !== row.district) {
      problems.push({ severity: "error", code: "district-conflict", message: `Directory says district "${row.district}", profile page says "${row.districtOnProfile}".`, subject });
    }
  }

  return { ok: !problems.some((p) => p.severity === "error"), problems };
}

/* ==========================================================================
   Connector
   ========================================================================== */

export const PARLIAMENT_SOURCE_ID = "S001";
export const PARLIAMENT_PARSER_VERSION = "parliament-directory@1";

export const PARLIAMENT_DIRECTORY_URL =
  "https://www.parliament.lk/en/members-of-parliament/directory-of-members/";
export const parliamentListingUrl = (page: number) =>
  `https://www.parliament.lk/en/members-of-parliament/mp-listing?page=${page}`;
export const parliamentProfileUrl = (id: string) =>
  `https://www.parliament.lk/en/members-of-parliament/mp-profile/${id}`;

/**
 * The Parliament connector.
 *
 * `parse`, `normalise` and `validate` are implemented and tested. `fetch` is
 * NOT: performing the HTTP retrieval belongs to a server-side worker, not to
 * the browser bundle (see `server/scheduler/worker.ts` and the README). The rows this
 * connector operates on were retrieved once, by hand, through the documented
 * DOM extraction and committed as a snapshot — see
 * `data/imported/parliamentMembers.json`.
 */
export const parliamentConnector: Pick<
  SourceConnector<ParliamentMemberRow, never>,
  "sourceId" | "parserVersion" | "validate"
> & {
  fetch(): Promise<FetchedDocument[]>;
} = {
  sourceId: PARLIAMENT_SOURCE_ID,
  parserVersion: PARLIAMENT_PARSER_VERSION,

  async fetch(): Promise<FetchedDocument[]> {
    throw new Error(
      "ParliamentConnector.fetch() is not implemented in the browser bundle. " +
        "Official-source retrieval runs in the server-side sync worker; see server/scheduler/worker.ts.",
    );
  },

  validate: validateMemberRows,
};
