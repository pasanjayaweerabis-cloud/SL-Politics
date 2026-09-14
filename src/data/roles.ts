/**
 * Javora — office classification.
 *
 * `title` is whatever the official source wrote and is displayed verbatim.
 * `roleType` is the machine-readable classification everything else keys off:
 * filtering, precedence, grouping, and eventually API queries.
 *
 * Why an exact-match table rather than string matching:
 *
 * The previous implementation classified with `title.startsWith("Minister of")`.
 * That silently mis-files real Sri Lankan titles — "State Minister of National
 * Policies and Economic Affairs" and "Deputy Minister of Foreign Affairs" are
 * neither cabinet posts, yet both contain "Minister of"; "Secretary to the
 * Ministry of Defence" is a civil-service post, not a ministerial one. Prefix
 * rules cannot separate these without accumulating exceptions that silently
 * reorder the directory.
 *
 * So classification is an explicit decision per title. Production ingestion is
 * expected to set `roleType` at write time from the source's own structure;
 * this table exists to classify the demonstration dataset and to give the
 * ingestion pipeline a seed vocabulary. Unmapped titles resolve to
 * `other-public-office` and are reported by `unmappedTitles()` rather than
 * being guessed at.
 */

import { RoleType, type RoleTypeValue } from "../types/models.ts";

/** Display metadata and directory precedence for each role type. */
export const ROLE_TYPES: Array<{
  id: RoleTypeValue;
  name: string;
  /** Lower ranks higher when choosing a person's headline office. */
  precedence: number;
}> = [
  { id: RoleType.PRESIDENT, name: "President", precedence: 1 },
  { id: RoleType.PRIME_MINISTER, name: "Prime Minister", precedence: 2 },
  { id: RoleType.OPPOSITION_LEADER, name: "Leader of the Opposition", precedence: 5 },
  { id: RoleType.SPEAKER, name: "Speaker of Parliament", precedence: 8 },
  { id: RoleType.DEPUTY_SPEAKER, name: "Deputy Speaker", precedence: 9 },
  { id: RoleType.CABINET_MINISTER, name: "Cabinet Minister", precedence: 10 },
  // Ranked between Cabinet and State ministers: a non-Cabinet minister heads
  // a ministry but does not sit in Cabinet. Left out of this table the role
  // fell through to the catch-all precedence of 99, which sorted a minister
  // below "other public office" on their own profile.
  { id: RoleType.NON_CABINET_MINISTER, name: "Non-Cabinet Minister", precedence: 12 },
  { id: RoleType.DISTRICT_MINISTER, name: "District Minister", precedence: 14 },
  { id: RoleType.STATE_MINISTER, name: "State Minister", precedence: 15 },
  { id: RoleType.DEPUTY_MINISTER, name: "Deputy Minister", precedence: 16 },
  { id: RoleType.PARLIAMENTARY_SECRETARY, name: "Parliamentary Secretary", precedence: 17 },
  { id: RoleType.PARLIAMENTARY_OFFICE, name: "Parliamentary Office", precedence: 18 },
  { id: RoleType.PARTY_LEADER, name: "Party Leadership", precedence: 20 },
  { id: RoleType.PROVINCIAL_OFFICE, name: "Provincial Office", precedence: 30 },
  { id: RoleType.LOCAL_GOVERNMENT, name: "Local Government", precedence: 32 },
  { id: RoleType.MEMBER_OF_PARLIAMENT, name: "Member of Parliament", precedence: 40 },
  { id: RoleType.PUBLIC_SERVICE, name: "Public Service", precedence: 50 },
  { id: RoleType.OTHER_PUBLIC_OFFICE, name: "Other Public Office", precedence: 60 },
];

const roleTypeIndex = new Map(ROLE_TYPES.map((r) => [r.id, r]));

export const getRoleType = (id: RoleTypeValue) => roleTypeIndex.get(id) ?? null;

export function roleTypeName(id: RoleTypeValue): string {
  return roleTypeIndex.get(id)?.name ?? "Other Public Office";
}

export function precedenceFor(id: RoleTypeValue): number {
  return roleTypeIndex.get(id)?.precedence ?? 99;
}

/**
 * Exact title → role type. Every distinct title in the demonstration dataset
 * is classified here deliberately; nothing is inferred from substrings.
 */
export const ROLE_TYPE_BY_TITLE: Record<string, RoleTypeValue> = {
  // Head of state / government
  "President of Sri Lanka": RoleType.PRESIDENT,
  "Prime Minister of Sri Lanka": RoleType.PRIME_MINISTER,
  "Prime Minister of Ceylon": RoleType.PRIME_MINISTER,

  // Legislature
  "Member of Parliament": RoleType.MEMBER_OF_PARLIAMENT,
  "Speaker of Parliament": RoleType.SPEAKER,
  "Leader of the Opposition": RoleType.OPPOSITION_LEADER,

  // Cabinet portfolios
  "Minister of Agriculture and Lands": RoleType.CABINET_MINISTER,
  "Minister of Agriculture, Livestock, Lands and Irrigation": RoleType.CABINET_MINISTER,
  "Minister of Cultural Affairs and National Heritage": RoleType.CABINET_MINISTER,
  "Minister of Finance": RoleType.CABINET_MINISTER,
  "Minister of Fisheries": RoleType.CABINET_MINISTER,
  "Minister of Foreign Affairs": RoleType.CABINET_MINISTER,
  "Minister of Health": RoleType.CABINET_MINISTER,
  "Minister of Health and Local Government": RoleType.CABINET_MINISTER,
  "Minister of Housing and Construction": RoleType.CABINET_MINISTER,
  "Minister of Justice": RoleType.CABINET_MINISTER,
  "Minister of Megapolis and Western Development": RoleType.CABINET_MINISTER,
  "Minister of Power and Energy": RoleType.CABINET_MINISTER,
  "Minister of Youth and Sports": RoleType.CABINET_MINISTER,

  // Sub-cabinet — deliberately NOT cabinet, despite containing "Minister of"
  "State Minister of National Policies and Economic Affairs": RoleType.STATE_MINISTER,
  "Deputy Minister of Foreign Affairs": RoleType.DEPUTY_MINISTER,

  // Party office
  "Leader of the Janatha Vimukthi Peramuna": RoleType.PARTY_LEADER,
  "Leader of the Samagi Jana Balawegaya": RoleType.PARTY_LEADER,
  "Leader of the Sri Lanka Freedom Party": RoleType.PARTY_LEADER,
  "Leader of the Sri Lanka Muslim Congress": RoleType.PARTY_LEADER,
  "Leader of the United National Party": RoleType.PARTY_LEADER,
  "General Secretary of the Sri Lanka Freedom Party": RoleType.PARTY_LEADER,

  // Sub-national office
  "Chief Minister of the Western Province": RoleType.PROVINCIAL_OFFICE,
  "Mayor of Colombo": RoleType.LOCAL_GOVERNMENT,
  "Mayor of Galle": RoleType.LOCAL_GOVERNMENT,

  // Appointed public service — not a ministerial post
  "Secretary to the Ministry of Defence": RoleType.PUBLIC_SERVICE,
};

/**
 * Classify an office. An explicit `roleType` on the record always wins; the
 * table is the fallback for records that predate explicit classification.
 */
export function resolveRoleType(position: {
  title: string;
  roleType?: RoleTypeValue | null;
}): RoleTypeValue {
  if (position.roleType) return position.roleType;
  return ROLE_TYPE_BY_TITLE[position.title] ?? RoleType.OTHER_PUBLIC_OFFICE;
}

/** True when a title had to fall back to the catch-all classification. */
export function isUnmappedTitle(title: string): boolean {
  return !(title in ROLE_TYPE_BY_TITLE);
}

/**
 * Titles present in a dataset that no rule classifies. Surfaced by the data
 * quality report so new offices are noticed rather than silently bucketed.
 */
export function unmappedTitles(titles: Iterable<string>): string[] {
  return [...new Set([...titles].filter(isUnmappedTitle))].sort();
}
