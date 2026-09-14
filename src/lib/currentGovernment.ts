/**
 * Javora — deriving the current government from canonical records.
 *
 * ONE DEFINITION, TWO CALLERS
 *
 * The API serves this over rows read from the database; the browser computes
 * it over the bundled canonical dataset. Both call THIS module. That is the
 * point: "who is currently in the Cabinet" must have exactly one definition,
 * or the Current Government page and a person's Political Career tab could
 * disagree about the same fact — which is the failure this platform exists to
 * prevent.
 *
 * NOTHING HERE IS STORED
 *
 * There is no `current_government` table and no curated list. Membership is
 * derived, every time, from positions that have not ended. A minister removed
 * from the Cabinet Office roster gets an end date during sync and disappears
 * from this view on the next render — without anyone editing a page, a JSON
 * file, or a React component.
 *
 * SCOPE IS DELIBERATELY NARROW
 *
 * This answers "who holds the major national offices", not "who works for the
 * government". The role types below are the whole of it; everyone else stays
 * in the Directory.
 */

/** A position as this module needs to see it. Both callers can supply this. */
export interface GovPosition {
  id: string;
  personId: string;
  title: string;
  roleType: string;
  institution: string;
  ministry: string | null;
  startDate: string | null;
  endDate: string | null;
  currentAsOf: string | null;
  /** See `Position.endStatus` — "not-recorded" must never read as current. */
  endStatus?: string | null;
  precedence: number;
  /** Which source is canonical for this office, for the per-source status line. */
  sourceId?: string | null;
}

/** A person as this module needs to see them. */
export interface GovPerson {
  id: string;
  slug: string;
  canonicalName: string;
  portraitUrl?: string | null;
  portraitCredit?: string | null;
  partyLabel?: string | null;
  districtLabel?: string | null;
}

/** One office, as presented on the page. */
export interface GovOffice {
  positionId: string;
  title: string;
  roleType: string;
  ministry: string | null;
  /** Only ever a date the source actually published. */
  since: string | null;
  sourceId: string | null;
  precedence: number;
}

/** A person holding one or more current offices. */
export interface GovMember {
  personId: string;
  slug: string;
  name: string;
  portraitUrl: string | null;
  portraitCredit: string | null;
  partyLabel: string | null;
  districtLabel: string | null;
  /** Highest-precedence office first. */
  offices: GovOffice[];
  /** The office that placed them in their section. */
  primaryRoleType: string;
}

export interface CurrentGovernment {
  president: GovMember | null;
  primeMinister: GovMember | null;
  cabinet: GovMember[];
  deputyMinisters: GovMember[];
  stateMinisters: GovMember[];
  parliamentaryLeadership: GovMember[];
  otherMajorLeadership: GovMember[];
}

/**
 * Role types this page covers, and the section each belongs to.
 *
 * A person is placed in exactly ONE section, by their highest-precedence
 * current office. The Prime Minister who also holds an education portfolio
 * appears once, under Prime Minister, with both offices listed on her card —
 * not twice, once in each section.
 */
export const SECTION_FOR_ROLE: Record<string, keyof CurrentGovernment> = {
  president: "president",
  "prime-minister": "primeMinister",
  "cabinet-minister": "cabinet",
  "non-cabinet-minister": "cabinet",
  "deputy-minister": "deputyMinisters",
  "state-minister": "stateMinisters",
  speaker: "parliamentaryLeadership",
  "deputy-speaker": "parliamentaryLeadership",
  "opposition-leader": "parliamentaryLeadership",
  "parliamentary-office": "parliamentaryLeadership",
};

/**
 * Offices that belong on this page at all.
 *
 * Membership of Parliament is deliberately absent: 225 sitting members is the
 * Directory's job, not this page's. So is every provincial, local and
 * public-service office.
 */
const IN_SCOPE = new Set(Object.keys(SECTION_FOR_ROLE));

/**
 * Is this office held right now?
 *
 * Mirrors `isCurrent()` in lib/positions.ts and must stay in step with it.
 * The `endStatus` guard is the one that matters for historical records: a
 * source that gave a start date and never said when the office ended has NOT
 * asserted it is still held, and reading that silence as tenure is how a
 * minister who left in 1997 ends up on a page titled "Current Government".
 */
export function isHeldNow(position: GovPosition, todayIso: string): boolean {
  if (position.endDate) return false;
  if (position.endStatus === "not-recorded") return false;
  const asserted = position.startDate ?? position.currentAsOf;
  if (!asserted) return false;
  // A future-dated appointment is announced, not held.
  return asserted.slice(0, 10) <= todayIso.slice(0, 10);
}

/**
 * Two titles that name the same office.
 *
 * Punctuation and case only — nothing clever. "Minister of Energy" and
 * "Minister of Energy and Power" are deliberately NOT collapsed: those are
 * genuinely different portfolios, and treating a renamed ministry as the same
 * office would hide a real change rather than surface it.
 */
export function normaliseOfficeKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Which of two records for the same office to keep. */
function preferPosition(candidate: GovPosition, incumbent: GovPosition): boolean {
  // A real start date beats a dated observation: it says when the office
  // began rather than merely that it was held when someone last looked.
  const candidateDated = candidate.startDate !== null;
  const incumbentDated = incumbent.startDate !== null;
  if (candidateDated !== incumbentDated) return candidateDated;
  // Otherwise keep it stable and deterministic.
  return candidate.id.localeCompare(incumbent.id, "en") < 0;
}

/**
 * Build the current-government view.
 *
 * `today` is passed in rather than read from the clock, so the result is a
 * pure function of its inputs and can be tested at a fixed date.
 */
export function deriveCurrentGovernment(
  people: readonly GovPerson[],
  positions: readonly GovPosition[],
  today: string,
): CurrentGovernment {
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const held = positions.filter(
    (p) => IN_SCOPE.has(p.roleType) && isHeldNow(p, today) && peopleById.has(p.personId),
  );

  const byPerson = new Map<string, GovPosition[]>();
  for (const position of held) {
    const bucket = byPerson.get(position.personId);
    if (bucket) bucket.push(position);
    else byPerson.set(position.personId, [position]);
  }

  // One office per person per title.
  //
  // Two sources describe the same ministry, and each holds a different half
  // of the truth: Parliament publishes the appointment DATE, the Cabinet
  // Office publishes that the office is CURRENTLY held. They arrive as two
  // rows with different ids, and rendering both put "Prime Minister" on the
  // Prime Minister's card twice.
  //
  // They are merged rather than one being dropped, keeping the row that
  // carries a real start date — the more informative record — so the page
  // shows each office once, dated where any source dated it.
  for (const [personId, list] of byPerson) {
    const best = new Map<string, GovPosition>();
    for (const position of list) {
      const key = normaliseOfficeKey(position.title);
      const existing = best.get(key);
      if (!existing || preferPosition(position, existing)) best.set(key, position);
    }
    byPerson.set(personId, [...best.values()]);
  }

  const government: CurrentGovernment = {
    president: null,
    primeMinister: null,
    cabinet: [],
    deputyMinisters: [],
    stateMinisters: [],
    parliamentaryLeadership: [],
    otherMajorLeadership: [],
  };

  const members: GovMember[] = [];
  for (const [personId, list] of byPerson) {
    const person = peopleById.get(personId)!;
    const offices = [...list].sort(
      (a, b) => a.precedence - b.precedence || a.title.localeCompare(b.title, "en"),
    );
    const primary = offices[0]!;
    members.push({
      personId,
      slug: person.slug,
      name: person.canonicalName,
      portraitUrl: person.portraitUrl ?? null,
      portraitCredit: person.portraitCredit ?? null,
      partyLabel: person.partyLabel ?? null,
      districtLabel: person.districtLabel ?? null,
      primaryRoleType: primary.roleType,
      offices: offices.map((o) => ({
        positionId: o.id,
        title: o.title,
        roleType: o.roleType,
        ministry: o.ministry,
        // Never a fabricated date. `currentAsOf` is a dated OBSERVATION that
        // the office is held, not the date it began, so it is not shown as one.
        since: o.startDate,
        sourceId: o.sourceId ?? null,
        precedence: o.precedence,
      })),
    });
  }

  // Stable ordering: by the person's best office, then by name.
  members.sort(
    (a, b) =>
      (a.offices[0]?.precedence ?? 99) - (b.offices[0]?.precedence ?? 99) ||
      a.name.localeCompare(b.name, "en"),
  );

  for (const member of members) {
    const section = SECTION_FOR_ROLE[member.primaryRoleType];
    if (!section) continue;
    if (section === "president") {
      // If a source somehow reports two, the better-precedenced one already
      // sorted first; the second is not silently discarded but falls to other
      // leadership, where it stays visible rather than disappearing.
      if (!government.president) government.president = member;
      else government.otherMajorLeadership.push(member);
    } else if (section === "primeMinister") {
      if (!government.primeMinister) government.primeMinister = member;
      else government.otherMajorLeadership.push(member);
    } else {
      (government[section] as GovMember[]).push(member);
    }
  }

  return government;
}

/** Total people shown, for the page's own summary line. */
export function governmentSize(government: CurrentGovernment): number {
  return (
    (government.president ? 1 : 0) +
    (government.primeMinister ? 1 : 0) +
    government.cabinet.length +
    government.deputyMinisters.length +
    government.stateMinisters.length +
    government.parliamentaryLeadership.length +
    government.otherMajorLeadership.length
  );
}
