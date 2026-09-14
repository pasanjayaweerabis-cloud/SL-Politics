/**
 * Javora — classifying the offices of earlier parliaments.
 *
 * Reading the Directory of Past Members brought in fifty years of office
 * titles, and roughly 120 of them matched none of the patterns written for the
 * sitting Parliament. Left unclassified they all became "other public office",
 * which is the bucket this platform uses to mean "we do not know" — so a
 * Governor, a Chief Minister and a District Minister were being filed
 * identically, and identically wrongly.
 *
 * TWO KINDS OF MISMATCH, HANDLED DIFFERENTLY
 *
 * 1. OFFICES THAT NO LONGER EXIST. District Ministers (1978–1990s) and
 *    Parliamentary Secretaries (pre-1978) are real ranks that the current
 *    Parliament has no equivalent of. They get their own role types rather
 *    than being mapped onto the nearest modern office: a Parliamentary
 *    Secretary was not a Deputy Minister, and asserting they were the same
 *    thing would be a claim about constitutional history that no source here
 *    supports.
 *
 * 2. THE SOURCE'S OWN TYPOS. "Deputy Ministr", "Deputy Minster", "Parlimentary
 *    Scretary", "Minister 0f Tourism" (a zero for an o), "Laedr of the House".
 *    These are misspellings of offices that plainly exist, and matching them is
 *    reading the source rather than reinterpreting it. Each is listed
 *    explicitly, so the patterns stay auditable and a future maintainer can see
 *    exactly which oddity each one is for.
 *
 * Anything still unmatched falls through to the caller and is REPORTED, not
 * silently bucketed. That is the property worth keeping: the list of things
 * this file cannot classify has to stay visible.
 */

import { RoleType, type RoleTypeValue } from "../types/models.ts";

/**
 * Ordered patterns. First match wins, so the more specific forms come first:
 * "Minister not in the Cabinet" must be tested before a bare "Minister of".
 */
const HISTORICAL_OFFICES: [RegExp, RoleTypeValue][] = [
  /* ---- head of state and government, in the source's older phrasings ---- */
  // "H.E.the President of the D.S.R. of Sri Lanka" — no space after the stop.
  [/^H\.?\s?E\.?\s*the President\b/i, RoleType.PRESIDENT],
  // "The President of the Demo.Socialist Republic…", "Elected Executive
  // President of Sri Lanka" — the office named at length.
  [/^(The\s+)?(Elected\s+)?(Executive\s+)?President of\b/i, RoleType.PRESIDENT],
  // "P.S/Prime Minister & Minister of Defence…" — Parliamentary Secretary TO
  // the Prime Minister, abbreviated. Tested before the Prime Minister pattern
  // so the secretary is not recorded as the office-holder.
  [/^P\.?\s?S\.?\s*\//i, RoleType.PARLIAMENTARY_SECRETARY],
  // "Hon, Prime Minister of the D S R of Sri lanka" — comma for a full stop.
  [/^Hon\s*,\s*Prime Minister\b/i, RoleType.PRIME_MINISTER],
  [/^Prime Minister\b/i, RoleType.PRIME_MINISTER],

  /* ---------------------------------------------------------- parliament */
  // "Speaker of parliament.", "Speaker of the National State Assembly"
  [/^Speaker\b/i, RoleType.SPEAKER],
  [/^Deputy Speaker\b/i, RoleType.DEPUTY_SPEAKER],
  // "Laedr of the House of Parliament" is the source's spelling.
  [/^(Leader|Laedr) of the (House|National State Assembly)\b/i, RoleType.PARLIAMENTARY_OFFICE],
  // "Leader of Opposition" — the source omits "the" in older records.
  [/^Leader of (the )?Opposition\b/i, RoleType.OPPOSITION_LEADER],
  [/^(Chief |Deputy )?(Government |Opposition )?Whip\b/i, RoleType.PARLIAMENTARY_OFFICE],
  [/^Deputy Chair(person|man)? of Committees\b/i, RoleType.PARLIAMENTARY_OFFICE],

  /*
   * Parliamentary Secretary — the pre-1978 junior ministerial office.
   *
   * Given its own role type rather than mapped to Deputy Minister. The two
   * are commonly described as equivalents, but that is a constitutional
   * judgement and no source in this platform makes it.
   *
   * Spellings in the live data: "Parliamentary Secretary", "Parliament
   * Secretary", "Parlimentary Secretary", "Parlimentary Scretary",
   * "Par.Secretary", and one bare "Parlimentary to the Minister of Justice".
   */
  [/^(Parliamentary|Parliament|Parlimentary|Par\.)\s*(Secretary|Scretary)?\b.*\bMinister\b/i,
    RoleType.PARLIAMENTARY_SECRETARY],
  [/^(Parliamentary|Parliament|Parlimentary|Par\.)\s*(Secretary|Scretary)\b/i,
    RoleType.PARLIAMENTARY_SECRETARY],

  /* ------------------------------------------------------------ ministers */
  // "Minister not in the Cabinet" is the older phrasing of a non-Cabinet rank.
  [/^Minister not in the Cabinet\b/i, RoleType.NON_CABINET_MINISTER],
  [/^Non[- ]Cabinet Minister\b/i, RoleType.NON_CABINET_MINISTER],
  // "Minister (Non Cabinet)" — the rank stated in a trailing parenthesis.
  [/^Minister\s*\(\s*Non[- ]?Cabinet\s*\)/i, RoleType.NON_CABINET_MINISTER],
  // District Ministers held a district portfolio at national level, an office
  // abolished in the 1990s and with no modern counterpart.
  [/^District Minister\b/i, RoleType.DISTRICT_MINISTER],
  // "Minister State for Plantation Industries" inverts the modern wording.
  [/^(State Minister|Minister State)\b/i, RoleType.STATE_MINISTER],
  // Deputy, including the source's misspellings and the "of"-less form
  // ("Deputy Minister Agriculture and Lands").
  // Includes the abbreviated "Deputy Min.of Rehabiliation, Recons.& Devp."
  [/^(Deputy|Dty|Dy)\.?\s*(Minister|Ministr|Minster|Min\.)/i, RoleType.DEPUTY_MINISTER],
  // "Minister without Portfolio" and "Minister Assisting X" are Cabinet ranks.
  [/^Minister (without Portfolio|Assisting|in charge of)\b/i, RoleType.CABINET_MINISTER],
  [/^Acting Minister\b/i, RoleType.CABINET_MINISTER],
  // "Minister 0f Tourism" — a zero typed for an o — and the abbreviated
  // "Min.of Pub.Admin., ...".
  [/^Min(ister|istr|\.)\s*(of|0f|for)\b/i, RoleType.CABINET_MINISTER],

  /* ---------------------------------------------------------- provincial */
  // Governors are appointed and Chief Ministers elected; both are provincial
  // offices, and the verbatim title preserves which is which.
  // "Governer-Central Province" is the source's spelling.
  [/^Govern(o|e)r\b/i, RoleType.PROVINCIAL_OFFICE],
  [/^Chief Minister\b/i, RoleType.PROVINCIAL_OFFICE],
  [/^Provincial Council\b/i, RoleType.PROVINCIAL_OFFICE],
  [/^(Mayor|Deputy Mayor)\b/i, RoleType.LOCAL_GOVERNMENT],
];

/**
 * Classify an office title from an earlier parliament.
 *
 * Returns null when nothing matches, so the caller keeps its own fallback and
 * the unmatched titles stay reportable.
 */
export function historicalRoleType(title: string): RoleTypeValue | null {
  const t = title.trim();
  if (!t) return null;
  for (const [pattern, roleType] of HISTORICAL_OFFICES) {
    if (pattern.test(t)) return roleType;
  }
  return null;
}
