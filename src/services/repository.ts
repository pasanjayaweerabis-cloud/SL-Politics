/**
 * Javora — repository boundary.
 *
 * Every component reads records through this module and nothing else. No page
 * or component imports the dataset directly, and none of them constructs a
 * query against a raw array. That constraint is what makes the eventual move
 * to an HTTP API a change to this one file rather than a rewrite of the
 * interface — and it is what let the underlying data be swapped from a
 * hand-entered demonstration sample to the real Parliament of Sri Lanka
 * import without a single component changing.
 *
 * The current implementation is synchronous because the imported dataset is
 * bundled and in memory. The exported functions are shaped so an async
 * implementation can satisfy them; see the README's backend notes.
 */

import { parliamentDataset } from "../data/adapters/parliamentDataset.ts";
import { researchDataset } from "../data/adapters/researchDataset.ts";
import { pastMembersDataset } from "../data/adapters/pastMembersDataset.ts";
import { cabinetDataset } from "../data/adapters/cabinetDataset.ts";
import { overrideForPersonId, overrideForRetiredSlug } from "../data/identityOverrides.ts";
import { DATASET } from "../data/adapters/datasetDescriptor.ts";
import { sources, getSource } from "../data/sources.ts";
import {
  parties,
  districts,
  statuses,
  getParty,
  getDistrict,
  partyLabel,
  districtLabel,
} from "../data/taxonomy.ts";
import { ROLE_TYPES, roleTypeName } from "../data/roles.ts";
import { matchesQuery, normaliseName, buildSearchIndex } from "../lib/identity.ts";
import {
  isCurrent,
  isServing,
  primaryPosition,
  sortPositions,
  type PositionLike,
} from "../lib/positions.ts";
import { toSortKey } from "../lib/date.ts";
import {
  deriveCurrentGovernment,
  type CurrentGovernment,
  type GovPerson,
  type GovPosition,
} from "../lib/currentGovernment.ts";
import { presentVerification } from "../lib/verification.ts";
import { deriveVitalStatus } from "../lib/vitalStatus.ts";
import type {
  Person,
  Position,
  PositionEvent,
  Qualification,
  Education,
  ExamResult,
  Employment,
  PublicService,
  LegalChallenge,
  PoliticalAffiliation,
  SourceEvidence,
  PersonStatus,
  VitalStatus,
  RoleTypeValue,
  VerificationStateValue,
  InstitutionalSource,
} from "../types/models.ts";

export { DATASET, getSource, getParty, getDistrict, partyLabel, districtLabel };
export { parties, districts, statuses, sources };

/* ==========================================================================
   Denormalised view models
   ========================================================================== */

/**
 * A person assembled with their related records, ready to render.
 *
 * Derived fields (`headline`, `serving`) are computed here rather than stored,
 * and are recomputed against the `today` passed in, so nothing goes stale.
 */
export interface PersonView {
  person: Person;
  positions: Position[];
  qualifications: Qualification[];
  /** Education records, newest first. Empty means none recorded, not none held. */
  education: Education[];
  examResults: ExamResult[];
  employment: Employment[];
  publicService: PublicService[];
  /**
   * Challenges to this person's mandate. A challenge is an allegation; the
   * interface must render a pending one as under review, never as a finding.
   */
  legalChallenges: LegalChallenge[];
  events: PositionEvent[];
  affiliations: PoliticalAffiliation[];
  /** Person-level party/district carried over from the legacy shape. */
  partyId: string | null;
  districtId: string | null;
  partyLabel: string | null;
  districtLabel: string | null;
  /** The office the profile leads with. Null when none is recorded. */
  headline: Position | null;
  serving: boolean;
  /**
   * Where this person stands relative to public office.
   *
   * Derived from their positions, never asserted by an import: a person is
   * current because they hold an office with no recorded end, which is the
   * same rule `isCurrent()` applies to a single position.
   */
  status: PersonStatus;
  statusId: "serving" | "former";
  roleTypes: RoleTypeValue[];
  verification: VerificationStateValue;
  /**
   * Alive, confirmed deceased, or not established either way.
   *
   * Independent of `status`: a `former` or `historical` person defaults to
   * `unknown` here, never `deceased` — see `deriveVitalStatus()`. This is
   * the field every public-discovery surface (directory, search, A-Z,
   * facets, homepage, sitemap) filters on to exclude confirmed deceased
   * people; it never removes anyone merely `unknown`, and a direct profile
   * URL (`getPersonBySlug`) ignores it entirely so a deceased person's
   * historical record stays reachable.
   */
  vitalStatus: VitalStatus;
}

/**
 * Current members take precedence over past ones on an id collision.
 *
 * The two directories share Parliament's identifier space, so a person who
 * appears in both is ONE person whose current record is the fresher of the
 * two. Preferring the current one means a member who has just been re-elected
 * cannot be shown as a former member because a stale past-member row sorted
 * first.
 */
function mergePeople<T extends { id: string }>(current: readonly T[], past: readonly T[]): T[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...past.filter((row) => !seen.has(row.id))];
}

/**
 * Fold EVERY source's person-level evidence onto the ONE record that
 * survives `mergePeople()`'s id collision, rather than only whichever
 * source's `Person` object happened to win.
 *
 * Two separate reasons a person's own `claim.evidenceIds` can under-cite:
 *
 *   1. `mergePeople()` (by design — see its own comment) keeps the current
 *      source's `Person` object and drops a later source's object for the
 *      same id entirely. For the President that dropped Cabinet Office's own
 *      identity evidence, since Parliament's object won the merge.
 *   2. The Cabinet Office adapter never creates a `Person` object AT ALL for
 *      someone it resolves onto an existing Parliament id (see
 *      `cabinetDataset.ts`'s `project()` — a match short-circuits before any
 *      `people.push(...)`) — only Cabinet's OWN identity evidence row, added
 *      to `cabinetDataset.evidence` directly. A fix that only unioned
 *      `Person.claim.evidenceIds` across source lists (case 1) would miss
 *      this entirely, because there is no second `Person` object to union
 *      from — the very case that makes up nearly every sitting minister.
 *
 * So this reads the raw evidence pool directly by `(entityType: "person",
 * entityId)` rather than by which `Person` object carried it, which handles
 * both cases uniformly. It does not change WHICH person object publishes
 * (aliases, canonical name, slug are untouched) and creates no new person —
 * it only widens `claim.evidenceIds` with ids not already present,
 * deduplicated so re-citing the same evidence twice can never double up.
 */
function personEvidenceIdsByPersonId(evidencePool: readonly SourceEvidence[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const item of evidencePool) {
    if (item.entityType !== "person") continue;
    const bucket = byId.get(item.entityId);
    if (bucket) bucket.push(item.id);
    else byId.set(item.entityId, [item.id]);
  }
  return byId;
}

function withAllPersonEvidence(persons: readonly Person[], evidencePool: readonly SourceEvidence[]): Person[] {
  const available = personEvidenceIdsByPersonId(evidencePool);
  return persons.map((person) => {
    const ids = available.get(person.id);
    if (!ids) return person;
    const known = new Set(person.claim.evidenceIds);
    const extra = ids.filter((id) => !known.has(id));
    if (!extra.length) return person;
    return { ...person, claim: { ...person.claim, evidenceIds: [...person.claim.evidenceIds, ...extra] } };
  });
}

/**
 * Publish a merged person under the name a human asserted for them.
 *
 * When `data/identityOverrides.ts` resolves two source records to one human,
 * the Cabinet resolver already attached the Cabinet Office's offices to the
 * Parliament person's id. What it cannot do is decide which of the two
 * spellings the record should PUBLISH under — that is an editorial call, and
 * it lives in the override beside the evidence for the merge.
 *
 * The displaced spelling is kept as an alias rather than dropped: it is how
 * one of the two institutions still refers to this person, and it must stay
 * searchable. The displaced slug is kept resolvable by `getPersonBySlug`.
 */
function applyIdentityOverrides(persons: readonly Person[]): Person[] {
  return persons.map((person) => {
    const override = overrideForPersonId(person.id);
    if (!override) return person;
    if (person.canonicalName === override.canonicalName && person.slug === override.slug) return person;
    const aliases = person.aliases.includes(person.canonicalName)
      ? person.aliases
      : [...person.aliases, person.canonicalName];
    return { ...person, canonicalName: override.canonicalName, slug: override.slug, aliases };
  });
}

const {
  people: currentPersons,
  positions: currentPositions,
  qualifications: allQualifications,
  education: allEducation,
  employment: allEmployment,
  publicService: allPublicService,
  legalChallenges: allLegalChallenges,
  events: allEvents,
  affiliations: allAffiliations,
  evidence: allEvidence,
  searchIndex: currentSearchIndex,
  personContext,
} = parliamentDataset;

/*
 * The people universe: sitting members plus every former member the
 * historical import has collected so far.
 *
 * The past-members crawl is incremental and resumable, so this number grows
 * between runs. Nothing here assumes it is complete, and the coverage report
 * states exactly how much of the historical directory has been read.
 */
const allPersons = withAllPersonEvidence(
  applyIdentityOverrides(mergePeople(
    mergePeople(currentPersons, pastMembersDataset.people),
    // The President is not a Member of Parliament and appears in neither
    // parliamentary directory; without the Cabinet Office he is absent entirely.
    cabinetDataset.people,
  )),
  [...allEvidence, ...pastMembersDataset.evidence, ...cabinetDataset.evidence, ...researchDataset.evidence],
);

/** Lowercased, whitespace-collapsed — enough to match "Prime Minister" against
 * itself across two sources without the aggressive punctuation-stripping
 * `lib/identity.ts`'s `normaliseName` applies for name matching, which this
 * is not. */
function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge Parliament's and the Cabinet Office's positions on SEMANTIC identity,
 * not id and not title alone.
 *
 * The previous rule deduplicated only when a Cabinet position's id happened
 * to exactly equal a Parliament position's id. That stopped working the
 * moment Parliament started suffixing ids with a term's start date to keep
 * repeat terms distinct (see `src/sync/importRun.ts`): the Cabinet Office's
 * id for an office never carries a date, so an exact-id match became rare,
 * and Harini Amarasuriya's Prime Minister and Education portfolios each
 * rendered twice — once from each source under two different ids.
 *
 * The identity used here is (person, role type, title) restricted to
 * positions BOTH sources currently describe as open (no end date). That
 * restriction is what keeps this safe: a CLOSED historical term — a past
 * Prime Ministership with its own end date — can never be the match target,
 * so a claim about the CURRENT holder of an office can never absorb a
 * distinct earlier term. Title alone is deliberately not sufficient (two
 * different people could hold the same office title over time); person and
 * role type must agree too.
 *
 * When a match is found, Parliament's row is kept — it, not the Cabinet
 * Office, publishes the dates the profile needs — and the Cabinet Office's
 * evidence is folded onto it rather than discarded, so its
 * portfolio-assignment authority still appears as a citation. A Cabinet
 * Office position with no open Parliament counterpart (a portfolio
 * Parliament's own page does not separately list) is kept standalone, as
 * before — Cabinet remains authoritative for portfolio assignment, this only
 * changes what happens when the two sources agree.
 */
function mergeCrossSourcePositions(
  parliamentary: readonly Position[],
  cabinet: readonly Position[],
): Position[] {
  const exactIds = new Set(cabinet.map((p) => p.id));
  const semanticKey = (p: Pick<Position, "personId" | "roleType" | "title">) =>
    `${p.personId}|${p.roleType}|${normaliseTitle(p.title)}`;

  const openParliamentByKey = new Map<string, Position>();
  for (const p of parliamentary) {
    if (!p.endDate && !exactIds.has(p.id)) openParliamentByKey.set(semanticKey(p), p);
  }

  const matchedCabinetFor = new Map<string, Position>();
  const standaloneCabinet: Position[] = [];
  for (const cab of cabinet) {
    const match = !cab.endDate ? openParliamentByKey.get(semanticKey(cab)) : undefined;
    if (match) matchedCabinetFor.set(match.id, cab);
    else standaloneCabinet.push(cab);
  }

  const parliamentResolved = parliamentary
    .filter((p) => !exactIds.has(p.id))
    .map((p) => {
      const cab = matchedCabinetFor.get(p.id);
      if (!cab) return p;
      const known = new Set(p.claim.evidenceIds);
      const extra = cab.claim.evidenceIds.filter((id) => !known.has(id));
      return extra.length
        ? { ...p, claim: { ...p.claim, evidenceIds: [...p.claim.evidenceIds, ...extra] } }
        : p;
    });

  return [...parliamentResolved, ...standaloneCabinet];
}

const parliamentaryPositions = mergePeople(currentPositions, pastMembersDataset.positions);
const allPositions = mergeCrossSourcePositions(parliamentaryPositions, cabinetDataset.positions);

const searchIndex = new Map(currentSearchIndex);
for (const [personId, text] of pastMembersDataset.searchIndex) {
  if (!searchIndex.has(personId)) searchIndex.set(personId, text);
}
for (const person of cabinetDataset.people) {
  if (searchIndex.has(person.id)) continue;
  const offices = cabinetDataset.positions.filter((p) => p.personId === person.id).map((p) => p.title);
  searchIndex.set(person.id, [person.canonicalName, ...person.aliases, ...offices].join(" ").toLowerCase());
}

/**
 * A curated identity override (`identityOverrides.ts`) changes which name a
 * merged record PUBLISHES under, but every entry above it was built from the
 * pre-override datasets — the same records `applyIdentityOverrides()` later
 * renames. Left alone, that means a person is displayed under one name and
 * searchable only under the OTHER one: the President's Cabinet Office
 * spelling ("Anura Kumara Dissanayake") is exactly the name his profile shows
 * and exactly the name the site's own search could not find him by, because
 * his search-index entry was written from his Parliament past-member record
 * ("Anura Dissanayaka") before the override ever ran. Folding the published
 * name and its aliases into the existing index entry (never replacing it —
 * the pre-override spelling must stay searchable too, since it is kept as an
 * alias) is what keeps "searchable by the name on the page" true after a merge.
 */
for (const person of allPersons) {
  const override = overrideForPersonId(person.id);
  if (!override) continue;
  const existing = searchIndex.get(person.id) ?? "";
  const published = buildSearchIndex([person.canonicalName, ...person.aliases]);
  searchIndex.set(person.id, [existing, published].filter(Boolean).join(" "));
}

/** Status is only recorded for past members; anyone else is derived below. */
const pastStatus = pastMembersDataset.status;

const positionsByPerson = groupBy(allPositions, (p) => p.personId);
const qualificationsByPerson = groupBy(allQualifications, (q) => q.personId);
/**
 * Institutional records first, research-derived records after.
 *
 * The order is the point: a profile shows what Parliament publishes, then
 * whatever a research compilation adds on top, each carrying its own
 * verification state. Merging them into one undifferentiated list — or
 * letting the weaker set sort above the stronger one — would erase exactly
 * the distinction the verification states exist to draw.
 *
 * Ids are deterministic and shared between the two adapters, so a research
 * claim that duplicates an institutional record collapses onto it rather than
 * appearing twice.
 */
function mergeById<T extends { id: string }>(institutional: T[], derived: T[]): T[] {
  const seen = new Set(institutional.map((row) => row.id));
  return [...institutional, ...derived.filter((row) => !seen.has(row.id))];
}

const educationByPerson = groupBy(
  mergeById(mergeById(allEducation, pastMembersDataset.education), researchDataset.education),
  (e) => e.personId);
const employmentByPerson = groupBy(
  mergeById(allEmployment, researchDataset.employment), (e) => e.personId);
const publicServiceByPerson = groupBy(
  mergeById(allPublicService, researchDataset.publicService), (s) => s.personId);
const legalChallengesByPerson = groupBy(allLegalChallenges, (c) => c.personId);
const eventsByPerson = groupBy(allEvents, (e) => e.personId);
const affiliationsByPerson = groupBy(
  mergeById(allAffiliations, pastMembersDataset.affiliations), (a) => a.personId);
const evidenceById = new Map(
  [...allEvidence, ...pastMembersDataset.evidence, ...cabinetDataset.evidence,
   ...researchDataset.evidence].map((e) => [e.id, e]),
);

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/**
 * Party/district for anyone `personContext` has no entry for.
 *
 * `personContext` is built only from the current sitting-members listing
 * (`parliamentDataset.ts`), so it never had an entry for a former member in
 * the first place — not "the source says they have no party", simply "this
 * source was never asked". Every former member's own affiliation and
 * position history is already sitting in the exact same bundle (it is what
 * the Political Career tab's party-history and district facts render from),
 * so falling back to it is reading data this module already has, not
 * inventing anything.
 *
 * Mirrors the database's own derivation exactly (`server/api/queries.ts`'s
 * `PARTY_JOIN`/`DISTRICT_SELECT`): party comes from the affiliation with no
 * recorded end date (ties broken by the latest start date, since the two
 * stores' arbitrary-row behaviour on a genuine multi-open-affiliation record
 * does not need to match bit-for-bit); district comes from the position with
 * a district, preferring one still open, then by precedence. Positions
 * without a district (ministerial, presidential) are simply skipped, same as
 * the SQL does.
 */
export function deriveFallbackContext(
  positions: readonly Position[],
  affiliations: readonly PoliticalAffiliation[],
): { partyId: string | null; districtId: string | null } {
  const open = affiliations.filter((a) => !a.endDate);
  const pool = open.length ? open : affiliations;
  const party = [...pool].sort((a, b) => toSortKey(b.startDate) - toSortKey(a.startDate))[0] ?? null;

  const districted = positions.filter((p) => p.districtId);
  const district = [...districted].sort(
    (a, b) => Number(Boolean(a.endDate)) - Number(Boolean(b.endDate)) || a.precedence - b.precedence,
  )[0];

  return { partyId: party?.partyId ?? null, districtId: district?.districtId ?? null };
}

function buildView(person: Person, today: Date): PersonView {
  const positions = sortPositions(positionsByPerson.get(person.id) ?? [], today);
  const qualifications = [...(qualificationsByPerson.get(person.id) ?? [])].sort(
    (a, b) => toSortKey(b.endDate) - toSortKey(a.endDate),
  );
  const events = [...(eventsByPerson.get(person.id) ?? [])].sort(
    (a, b) => toSortKey(b.eventDate) - toSortKey(a.eventDate),
  );
  const affiliations = affiliationsByPerson.get(person.id) ?? [];
  const context =
    personContext.get(person.id) ?? deriveFallbackContext(positionsByPerson.get(person.id) ?? [], affiliations);
  const serving = isServing(positions as PositionLike[], today);

  /**
   * Education order: school first, then university, then postgraduate, then
   * professional — the order a life runs in, not the order the source listed
   * them. Within a level, whatever order the source gave is preserved, because
   * this source publishes no dates to sort by and imposing one would invent a
   * sequence.
   */
  const EDUCATION_ORDER = ["school", "university", "postgraduate", "professional", "other"];
  const education = [...(educationByPerson.get(person.id) ?? [])].sort(
    (a, b) => EDUCATION_ORDER.indexOf(a.educationType) - EDUCATION_ORDER.indexOf(b.educationType),
  );

  return {
    person,
    positions,
    qualifications,
    education,
    examResults: [],
    employment: employmentByPerson.get(person.id) ?? [],
    publicService: publicServiceByPerson.get(person.id) ?? [],
    legalChallenges: legalChallengesByPerson.get(person.id) ?? [],
    events,
    affiliations,
    status: serving ? "current" : (pastStatus.get(person.id) ?? "former"),
    partyId: context.partyId,
    districtId: context.districtId,
    partyLabel: partyLabel(context.partyId),
    districtLabel: districtLabel(context.districtId),
    headline: primaryPosition(positions, today),
    serving,
    statusId: serving ? "serving" : "former",
    roleTypes: [...new Set(positions.map((p) => p.roleType))],
    verification: person.claim.verification,
    vitalStatus: deriveVitalStatus(person, serving),
  };
}

/**
 * All people as view models. Built once per `today`; the demonstration dataset
 * is static so there is nothing to invalidate within a session.
 */
let viewCache: { key: string; views: PersonView[] } | null = null;

export function allPeople(today: Date = new Date()): PersonView[] {
  const key = today.toISOString().slice(0, 10);
  if (viewCache?.key === key) return viewCache.views;
  const views = allPersons.map((p) => buildView(p, today));
  viewCache = { key, views };
  return views;
}

/**
 * Only the people currently holding office.
 *
 * Javora's people universe now spans sitting members AND everyone the
 * historical import has collected, so "everyone in the dataset" and "everyone
 * in office" stopped being the same set. Anything that means the second —
 * counts of the sitting Parliament, the default directory view, coverage
 * reporting — must ask for it explicitly rather than relying on the dataset
 * happening to contain nothing else.
 */
export function currentPeople(today: Date = new Date()): PersonView[] {
  return allPeople(today).filter((v) => v.status === "current");
}

/** Everyone who has left office. The historical half of the record. */
export function formerPeople(today: Date = new Date()): PersonView[] {
  return allPeople(today).filter((v) => v.status !== "current");
}

/**
 * Memoised the same way as `allPeople`'s own cache, and for the same reason:
 * the prerenderer calls this once per person route - 1,624 times in a single
 * build - and rebuilding a 1,624-entry Map on every call turned that into
 * roughly 2.6 million Map insertions for no benefit, since `today` is the
 * same `BUILD_TIME` for the whole build.
 */
let slugMapCache: { key: string; map: Map<string, PersonView> } | null = null;

function viewBySlug(today: Date): Map<string, PersonView> {
  const key = today.toISOString().slice(0, 10);
  if (slugMapCache?.key === key) return slugMapCache.map;
  const map = new Map(allPeople(today).map((v) => [v.person.slug, v]));
  slugMapCache = { key, map };
  return map;
}

/**
 * A person by slug, including slugs they no longer publish under.
 *
 * Slugs are permanent public URLs. When a curated identity merge changes which
 * spelling a record publishes under, the displaced slug keeps resolving to the
 * same person rather than 404ing a link someone already has. It is not a
 * second address for the record: `personMeta` builds the canonical URL from
 * `view.person.slug`, so the retired slug declares the current one canonical
 * and search engines consolidate on it.
 */
export function getPersonBySlug(slug: string, today: Date = new Date()): PersonView | null {
  if (!slug) return null;
  const direct = viewBySlug(today).get(slug);
  if (direct) return direct;
  const retired = overrideForRetiredSlug(slug);
  return retired ? viewBySlug(today).get(retired.slug) ?? null : null;
}

/**
 * The subset of `pool` eligible for public discovery — everyone except a
 * person whose death is recorded with reliable evidence.
 *
 * A person with `vitalStatus === "unknown"` (the overwhelming majority of
 * the historical half of the register) is deliberately KEPT: "former",
 * "historical" and "old" are not evidence of death, and excluding on that
 * basis would be exactly the guess this platform exists to avoid.
 */
export function excludeDeceased(pool: readonly PersonView[]): PersonView[] {
  return pool.filter((view) => view.vitalStatus !== "deceased");
}

/**
 * Every consumer that offers people up for DISCOVERY — the directory, the
 * search box, the A-Z index, facets, the homepage's featured profiles —
 * reads from this rather than from `allPeople()` directly. A profile stays
 * reachable by its own URL regardless (`getPersonBySlug` deliberately does
 * NOT filter), exactly like a retired slug: honoured, not advertised.
 */
export function discoverablePeople(today: Date = new Date()): PersonView[] {
  return excludeDeceased(allPeople(today));
}

/* ==========================================================================
   Query
   ========================================================================== */

export interface Facets {
  parties: string[];
  districts: string[];
  roles: string[];
  statuses: string[];
  verification: string[];
}

export const emptyFacets = (): Facets => ({
  parties: [],
  districts: [],
  roles: [],
  statuses: [],
  verification: [],
});

export const hasActiveFacets = (facets: Facets): boolean =>
  Object.values(facets).some((list) => list.length > 0);

export function searchPeople(query: string, pool: PersonView[]): PersonView[] {
  if (!query.trim()) return pool;
  return pool.filter((view) => matchesQuery(searchIndex.get(view.person.id) ?? "", query));
}

/**
 * The letter a person files under in an A-Z index — the first letter of the
 * canonical name, which for this register is a surname-initial convention
 * roughly half the time and a given name the rest, because that is how the
 * sources write them. `#` collects every name that does not begin with a
 * Latin letter rather than dropping it: a register whose index silently
 * omits people is worse than one with an untidy bucket.
 */
export function initialOf(view: PersonView): string {
  const first = view.person.canonicalName.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

const matchesInitial = (initial: string, view: PersonView): boolean =>
  !initial || initialOf(view) === initial;

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * How many people each letter would yield, counted against the CURRENT
 * search and filters but not against the letter itself — the same rule
 * `facetOptions` uses for a facet's own dimension, so a letter's count is
 * what choosing it would actually show.
 */
export function initialCounts(
  facets: Facets = emptyFacets(),
  query = "",
  today: Date = new Date(),
): Map<string, number> {
  const pool = filterPeople(facets, searchPeople(query, discoverablePeople(today)));
  const counts = new Map<string, number>();
  for (const view of pool) {
    const key = initialOf(view);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const matchesFacet = (selected: string[], test: (id: string) => boolean): boolean =>
  selected.length === 0 || selected.some(test);

export function filterPeople(facets: Facets, pool: PersonView[]): PersonView[] {
  return pool.filter(
    (view) =>
      matchesFacet(facets.parties, (id) => view.partyId === id) &&
      matchesFacet(facets.districts, (id) => view.districtId === id) &&
      matchesFacet(facets.roles, (id) => view.roleTypes.includes(id as RoleTypeValue)) &&
      matchesFacet(facets.statuses, (id) => view.statusId === id) &&
      matchesFacet(facets.verification, (id) => view.verification === id),
  );
}

export interface FacetOption {
  id: string;
  name: string;
  count: number;
}

export interface FacetOptions {
  parties: FacetOption[];
  districts: FacetOption[];
  roles: FacetOption[];
  statuses: FacetOption[];
  verification: FacetOption[];
}

/**
 * Counts for each facet value, computed against the other facets only — so a
 * party's count reflects what selecting it would actually yield, rather than
 * being zeroed out by its own selection.
 */
export function facetOptions(
  facets: Facets,
  query: string,
  today: Date = new Date(),
  /**
   * The directory's A-Z index, when one is chosen. Narrows the pool every
   * count is computed against, exactly as the search text does — otherwise a
   * reader on "W" would be offered "United National Party 479" beside a
   * result set of thirty, which is the specific kind of number this site
   * must not print.
   */
  initial = "",
): FacetOptions {
  const searched = searchPeople(query, discoverablePeople(today)).filter((view) => matchesInitial(initial, view));

  /**
   * Single pass over `pool`, tallying how many people carry each id this
   * dimension can produce. Previously each OPTION ran its own `pool.filter()`
   * pass - roughly 70 full passes over up to 1,624 records per call, on every
   * keystroke (directory search has no debounce). `keysFor` returns every id
   * one person contributes to for this dimension: zero or one for
   * parties/districts/statuses/verification, but possibly several for roles,
   * since a person can hold more than one role type at once and must be
   * tallied under each - matching the original `.includes()` test exactly.
   */
  const tally = (pool: readonly PersonView[], keysFor: (view: PersonView) => Iterable<string>) => {
    const counts = new Map<string, number>();
    for (const view of pool) {
      for (const key of keysFor(view)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const countFor = <T extends { id: string }>(
    dimension: keyof Facets,
    list: readonly T[],
    name: (item: T) => string,
    keysFor: (view: PersonView) => Iterable<string>,
  ): FacetOption[] => {
    const others = { ...facets, [dimension]: [] } as Facets;
    const pool = filterPeople(others, searched);
    const counts = tally(pool, keysFor);
    return list
      .map((item) => ({
        id: item.id,
        name: name(item),
        count: counts.get(item.id) ?? 0,
      }))
      .filter((option) => option.count > 0 || facets[dimension].includes(option.id));
  };

  const verificationStates = [...new Set(discoverablePeople(today).map((v) => v.verification))];

  return {
    parties: countFor("parties", parties, (p) => p.name, (v) => (v.partyId ? [v.partyId] : [])),
    districts: countFor("districts", districts, (d) => d.name, (v) => (v.districtId ? [v.districtId] : [])),
    roles: countFor("roles", ROLE_TYPES, (r) => r.name, (v) => v.roleTypes),
    statuses: countFor("statuses", statuses, (s) => s.name, (v) => [v.statusId]),
    verification: countFor(
      "verification",
      verificationStates.map((id) => ({ id })),
      (s) => presentVerification(s.id as VerificationStateValue).label,
      (v) => [v.verification],
    ),
  };
}

export interface Query {
  query?: string;
  facets?: Facets;
  /** A-Z index letter, or "" for the whole register. See `initialOf`. */
  initial?: string;
}

export function queryPeople(
  { query = "", facets = emptyFacets(), initial = "" }: Query = {},
  today: Date = new Date(),
): PersonView[] {
  const pool = searchPeople(query, discoverablePeople(today)).filter((view) => matchesInitial(initial, view));
  const matches = sortForDisplay(filterPeople(facets, pool), today);
  // Same incidental-match problem suggestionRank exists for below (typing
  // "anura" also token-prefix-matches the Anuradhapura district): without
  // this, the directory listed ministers from that district ahead of the
  // member actually named Anuradha, on office precedence alone. Sort is
  // stable, so ties keep the serving/precedence/alphabetical order above.
  if (!query.trim()) return matches;
  return [...matches].sort((a, b) => suggestionRank(a, query) - suggestionRank(b, query));
}

/**
 * Typeahead suggestions for the primary search box.
 *
 * This is the seam the UI's autocomplete dropdown calls through — deliberately
 * separate from `queryPeople` (which backs the full directory listing) so that
 * swapping local data for a real search API later is a change to this one
 * function, not to the search box component. See `components/SearchTypeahead`.
 */
export function suggestPeople(
  query: string,
  { limit = 8, today = new Date() }: { limit?: number; today?: Date } = {},
): PersonView[] {
  return suggestPeopleRanked(query, { limit, today }).map((entry) => entry.view);
}

export interface RankedSuggestion {
  view: PersonView;
  rank: number;
}

/**
 * Same suggestions as `suggestPeople`, with each one's rank still attached.
 *
 * `suggestPeople` strips the rank once it's sorted by it, which was fine
 * until the search box needed the number itself: a bare Enter should only
 * jump straight to the top suggestion when it is an unambiguous direct name
 * match, not whenever a result set happens to exist (typing a district name
 * like "kandy" should not silently land the reader on one person's
 * biography). See `shouldAutoJump` in `lib/typeahead.ts`, the pure function
 * that decision lives in.
 */
export function suggestPeopleRanked(
  query: string,
  { limit = 8, today = new Date() }: { limit?: number; today?: Date } = {},
): RankedSuggestion[] {
  if (!query.trim()) return [];
  const matches = searchPeople(query, discoverablePeople(today));
  return sortForDisplay(matches, today)
    .map((view) => ({ view, rank: suggestionRank(view, query) }))
    .sort((a, b) => a.rank - b.rank) // stable: ties keep display order
    .slice(0, limit);
}

/**
 * How directly a person answers what the user typed. Lower ranks higher.
 *
 * Without this, typing "anura" put three ministers from *Anuradhapura*
 * district above the member actually named Anuradha — every one a legitimate
 * token-prefix match, but not what someone typing a name is looking for. The
 * index deliberately covers party, district, office and profession so those
 * searches work; ranking is what stops the incidental matches from burying
 * the direct ones.
 */
interface SuggestionTokens {
  nameTokens: string[];
  aliasTokens: string[];
  officeTokens: string[];
}

/**
 * A person's own name/alias/office tokens, keyed by person id and computed
 * once. `suggestionRank` re-tokenised canonicalName, every alias and every
 * position title FOR EVERY PERSON on every call - and suggestPeople() runs
 * once per keystroke with no debounce. None of the three token sets depend on
 * `query` or on `today` (position TITLES are a fixed set per person; only
 * their sort order is date-dependent, via sortPositions - membership in
 * officeTokens is unaffected), so they are safe to cache indefinitely rather
 * than recomputed per call.
 */
const suggestionTokenCache = new Map<string, SuggestionTokens>();

function suggestionTokensFor(view: PersonView): SuggestionTokens {
  const cached = suggestionTokenCache.get(view.person.id);
  if (cached) return cached;
  const tokensOf = (value: string | null | undefined) =>
    normaliseName(value ?? "").split(" ").filter(Boolean);
  const tokens: SuggestionTokens = {
    nameTokens: tokensOf(view.person.canonicalName),
    aliasTokens: view.person.aliases.flatMap(tokensOf),
    officeTokens: view.positions.flatMap((p) => tokensOf(p.title)),
  };
  suggestionTokenCache.set(view.person.id, tokens);
  return tokens;
}

function suggestionRank(view: PersonView, query: string): number {
  const terms = normaliseName(query).split(" ").filter(Boolean);
  if (!terms.length) return 3;

  const { nameTokens, aliasTokens, officeTokens } = suggestionTokensFor(view);

  const hits = (tokens: string[]) =>
    terms.every((term) => tokens.some((token) => token.startsWith(term)));

  if (hits(nameTokens)) return 0;
  if (hits([...nameTokens, ...aliasTokens])) return 1;
  if (hits(officeTokens)) return 2;
  return 3;
}

/** Serving first, then by office precedence, then alphabetically. */
export function sortForDisplay(list: PersonView[], today: Date = new Date()): PersonView[] {
  return [...list].sort((a, b) => {
    const servingDelta = Number(b.serving) - Number(a.serving);
    if (servingDelta !== 0) return servingDelta;
    const rank = (v: PersonView) => v.headline?.precedence ?? 99;
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.person.canonicalName.localeCompare(b.person.canonicalName, "en");
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  perPage: number;
  total: number;
  shown: number;
  hasMore: boolean;
}

export function paginate<T>(list: T[], { page = 1, perPage = 12 } = {}): Page<T> {
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;
  const items = list.slice(start, start + perPage);
  return {
    items,
    page: current,
    pages,
    perPage,
    total: list.length,
    shown: start + items.length,
    hasMore: start + items.length < list.length,
  };
}

/* ==========================================================================
   Evidence and sources
   ========================================================================== */

export const getEvidence = (id: string): SourceEvidence | null => evidenceById.get(id) ?? null;

export function evidenceFor(claim: { evidenceIds: string[] }): SourceEvidence[] {
  return claim.evidenceIds.map((id) => evidenceById.get(id)).filter((e): e is SourceEvidence => Boolean(e));
}

/** Distinct source ids cited anywhere within a person's record, with counts. */
export function sourcesCitedBy(view: PersonView): Array<{ sourceId: string; count: number }> {
  const tally = new Map<string, number>();
  const note = (claim: { evidenceIds: string[] }) => {
    for (const evidence of evidenceFor(claim)) {
      tally.set(evidence.sourceId, (tally.get(evidence.sourceId) ?? 0) + 1);
    }
  };
  note(view.person.claim);
  view.positions.forEach((p) => note(p.claim));
  view.qualifications.forEach((q) => note(q.claim));
  view.events.forEach((e) => note(e.claim));
  return [...tally.entries()]
    .map(([sourceId, count]) => ({ sourceId, count }))
    .sort((a, b) => b.count - a.count);
}

/** How many people cite a given source anywhere in their record. */
export function recordsCiting(sourceId: string, today: Date = new Date()): number {
  return allPeople(today).filter((view) =>
    sourcesCitedBy(view).some((entry) => entry.sourceId === sourceId),
  ).length;
}

/**
 * How many CLAIMS — not people, not positions alone — currently carry each
 * verification state, across every claim-bearing record a person has: their
 * own identity claim, each position, qualification, event and affiliation.
 * "Claims" is the unit because that is what the verification model actually
 * attaches a state to (see `lib/verification.ts`); a single person can carry
 * many claims in many states at once, so counting people or positions alone
 * would either double-count or silently drop qualification/event/affiliation
 * claims.
 *
 * Used by the About page's legend so it can say which states are actually in
 * use on the loaded dataset instead of listing all seven as if they were
 * equally real.
 */
export function verificationStateCounts(
  today: Date = new Date(),
): Record<VerificationStateValue, number> {
  const counts = {} as Record<VerificationStateValue, number>;
  const tally = (claim: { verification: VerificationStateValue }) => {
    counts[claim.verification] = (counts[claim.verification] ?? 0) + 1;
  };
  for (const view of allPeople(today)) {
    tally(view.person.claim);
    view.positions.forEach((p) => tally(p.claim));
    view.qualifications.forEach((q) => tally(q.claim));
    view.events.forEach((e) => tally(e.claim));
    view.affiliations.forEach((a) => tally(a.claim));
  }
  return counts;
}

/* ==========================================================================
   Elections — modelled, not yet populated
   ========================================================================== */

/**
 * No election records are loaded. The demonstration dataset never contained
 * structured election results, and inventing them would be exactly the failure
 * this platform exists to avoid. The types and query surface exist so a real
 * Election Commission connector has somewhere to write.
 */
export const allElections = (): never[] => [];
export const allCandidacies = (): never[] => [];

/* ==========================================================================
   Dataset statistics
   ========================================================================== */

/**
 * Institutional sources actually feeding a record shown on the site today —
 * connected AND authoritative for something, the same predicate
 * `computeStats` counts by (see the comment on `connectedSources` below). S900
 * is excluded by construction: its own definition declares `authoritativeFor`
 * empty, because a research compilation is not a source, it is a compilation
 * about sources.
 */
export function sourcesInUse(): InstitutionalSource[] {
  return sources.filter((s) => s.syncState !== "not-connected" && s.authoritativeFor.length > 0);
}

function computeStats(views: PersonView[], today: Date) {
  const offices = new Set<string>();
  let positionCount = 0;
  let currentPositions = 0;

  for (const view of views) {
    for (const position of view.positions) {
      positionCount++;
      offices.add(position.title);
      if (isCurrent(position, today)) currentPositions++;
    }
  }

  const years = views
    .flatMap((v) => v.positions.map((p) => Number(String(p.startDate ?? "").slice(0, 4))))
    .filter((y) => Number.isFinite(y) && y > 1800);

  return {
    people: views.length,
    serving: views.filter((v) => v.serving).length,
    former: views.filter((v) => !v.serving).length,
    positions: positionCount,
    currentPositions,
    distinctOffices: offices.size,
    sources: sources.length,
    /*
      Connected INSTITUTIONAL sources. `syncState !== "not-connected"` alone also
      counted S900, the research compilation, whose own definition says it is
      authoritative for nothing and is a compilation ABOUT sources rather than a
      source. The home page therefore read "7 institutional sources - 3
      connected" while only two institutions were connected. Requiring
      authoritativeFor to be non-empty is the same rule sources.ts already uses
      to mark a source non-authoritative, rather than a second hard-coded list.
    */
    connectedSources: sourcesInUse().length,
    evidenceRecords: allEvidence.length,
    elections: 0,
    earliestYear: years.length ? Math.min(...years) : null,
    parties: new Set(views.map((v) => v.partyId).filter(Boolean)).size,
    districts: new Set(views.map((v) => v.districtId).filter(Boolean)).size,
  };
}

/**
 * Memoised like `allPeople` and `getPersonBySlug`: the prerenderer calls this
 * once per page across ~1,629 pages, each walk covering every person and all
 * 6,649 positions. `today` is the same `BUILD_TIME` for the whole build, so
 * every one of those calls after the first was recomputing an identical
 * result.
 */
let datasetStatsCache: { key: string; stats: ReturnType<typeof computeStats> } | null = null;

/**
 * What this dataset HOLDS — the full historical record, confirmed deceased
 * people included. This is a coverage/provenance figure (the About page, the
 * homepage's "trust" panel), not a discovery listing, so it is deliberately
 * NOT filtered by `vitalStatus`: removing a deceased person from it would
 * understate how much of the register is actually retained. See
 * `directoryStats()` for the figure that DOES reflect public discovery.
 */
export function datasetStats(today: Date = new Date()): ReturnType<typeof computeStats> {
  const key = today.toISOString().slice(0, 10);
  if (datasetStatsCache?.key === key) return datasetStatsCache.stats;
  const stats = computeStats(allPeople(today), today);
  datasetStatsCache = { key, stats };
  return stats;
}

let directoryStatsCache: { key: string; stats: ReturnType<typeof computeStats> } | null = null;

/**
 * What a reader can actually browse or search to right now — the same pool
 * `queryPeople`/`facetOptions`/`suggestPeople` draw from. Directory totals,
 * A-Z counts and facet counts must be computed from THIS, not `datasetStats`,
 * or a reader would be told "showing all 1,623" while only 1,620 are
 * reachable, or vice versa.
 */
export function directoryStats(today: Date = new Date()): ReturnType<typeof computeStats> {
  const key = today.toISOString().slice(0, 10);
  if (directoryStatsCache?.key === key) return directoryStatsCache.stats;
  const stats = computeStats(discoverablePeople(today), today);
  directoryStatsCache = { key, stats };
  return stats;
}

export { roleTypeName, ROLE_TYPES };

/* ==========================================================================
   Current government
   ========================================================================== */

/**
 * The current government, derived from the SAME canonical records the rest of
 * the app renders.
 *
 * This calls `deriveCurrentGovernment` — the identical function the API uses
 * over database rows. One definition, two callers. Without that, the Current
 * Government page and a person's Political Career tab could disagree about
 * which portfolio someone holds, which is exactly the kind of split truth this
 * platform exists to avoid.
 *
 * Nothing is stored or curated. Membership falls out of positions that have
 * not ended, so a minister whose office is closed by a sync stops appearing
 * here with no code, JSON or page edit.
 *
 * `excludeDeceased` is a defensive belt-and-braces filter, not a fix for a
 * live bug: nobody in today's dataset has a recorded death, so no current
 * output changes. It exists so that a future record with BOTH a confirmed
 * death and (through a data error) an open position can never render that
 * person as a sitting office-holder here.
 */
export function currentGovernment(today: Date = new Date()): CurrentGovernment {
  const iso = today.toISOString();
  const views = excludeDeceased(allPeople(today));

  const people: GovPerson[] = views.map((v) => ({
    id: v.person.id,
    slug: v.person.slug,
    canonicalName: v.person.canonicalName,
    portraitUrl: v.person.portrait?.url ?? null,
    portraitCredit: v.person.portrait?.credit ?? null,
    partyLabel: v.partyLabel,
    districtLabel: v.districtLabel,
  }));

  const positions: GovPosition[] = views.flatMap((v) =>
    v.positions.map((p) => ({
      id: p.id,
      personId: p.personId,
      title: p.title,
      roleType: p.roleType,
      institution: p.institution,
      ministry: p.ministry,
      startDate: p.startDate,
      endDate: p.endDate,
      currentAsOf: p.currentAsOf,
      endStatus: p.endStatus,
      precedence: p.precedence,
      sourceId: evidenceFor(p.claim)[0]?.sourceId ?? null,
    })),
  );

  return deriveCurrentGovernment(people, positions, iso);
}

/**
 * Per-source freshness for the sources the government view depends on.
 *
 * Reports what the source definitions actually record. A source that has
 * never been checked reports null rather than a plausible-looking date —
 * the page must not imply a check that did not happen.
 */
export function governmentSourceStatus(): Array<{
  sourceId: string;
  name: string;
  syncLabel: string;
  lastSuccessfulSyncAt: string | null;
}> {
  return ["S006", "S001"]
    .map((id) => getSource(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({
      sourceId: s.id,
      name: s.name,
      syncLabel: s.syncLabel,
      lastSuccessfulSyncAt: s.lastSuccessfulSyncAt,
    }));
}
