import { describe, it, expect, vi } from "vitest";
import { RoleType, VerificationState, type Person, type Position } from "../types/models.ts";

/**
 * Javora — end-to-end proof that a confirmed deceased person is excluded
 * from public discovery while their record stays reachable.
 *
 * Nobody in the real bundled dataset has a recorded death (every adapter
 * writes `dateOfDeath: null` — there is simply no evidence of it in any
 * connected source yet), so `repository.test.ts`'s structural assertions
 * against the real dataset can never demonstrate actual exclusion. This file
 * mocks ONE adapter (`cabinetDataset.ts`) to splice in a single synthetic
 * deceased person — keeping every real record untouched — so the exclusion
 * mechanism itself can be exercised rather than merely trusted by reading
 * the code. See `lib/vitalStatus.test.ts` for the pure derivation rule this
 * builds on.
 */

const TODAY = new Date(Date.UTC(2026, 7, 28));

const DECEASED_ID = "test:deceased-1";
const DECEASED_SLUG = "test-deceased-politician";
const DECEASED_NAME = "Test Deceased Politician";

const deceasedPerson: Person = {
  id: DECEASED_ID,
  slug: DECEASED_SLUG,
  canonicalName: DECEASED_NAME,
  names: { en: DECEASED_NAME, si: null, ta: null },
  aliases: [],
  dateOfBirth: "1930-01-01",
  dateOfDeath: "2020-06-15",
  gender: null,
  portrait: null,
  biography: null,
  profession: null,
  externalIds: {},
  claim: { verification: VerificationState.SOURCE_LINKED, evidenceIds: [], verifiedAt: null },
  createdAt: "2020-06-16T00:00:00.000Z",
  updatedAt: "2020-06-16T00:00:00.000Z",
};

/**
 * An OPEN cabinet position with no end date — the exact shape a data error
 * could produce for someone whose death was recorded but whose office never
 * got closed out. This is what makes the `currentGovernment()` assertion
 * below meaningful: without the defensive filter, this person would render
 * as a sitting minister.
 */
const deceasedPosition: Position = {
  id: "test:deceased-1-position",
  personId: DECEASED_ID,
  title: "Cabinet Minister of Testing",
  roleType: RoleType.CABINET_MINISTER,
  institution: "Cabinet of Ministers",
  ministry: "Testing",
  districtId: null,
  constituency: null,
  startDate: null,
  endDate: null,
  currentAsOf: "2026-08-28",
  endStatus: "ongoing",
  appointmentType: "appointed",
  precedence: 5,
  claim: { verification: VerificationState.SOURCE_LINKED, evidenceIds: [], verifiedAt: null },
  createdAt: "2020-06-16T00:00:00.000Z",
  updatedAt: "2020-06-16T00:00:00.000Z",
};

vi.mock("../data/adapters/cabinetDataset.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/adapters/cabinetDataset.ts")>();
  return {
    ...actual,
    cabinetDataset: {
      ...actual.cabinetDataset,
      people: [...actual.cabinetDataset.people, deceasedPerson],
      positions: [...actual.cabinetDataset.positions, deceasedPosition],
    },
  };
});

const {
  allPeople, discoverablePeople, getPersonBySlug, queryPeople, suggestPeopleRanked,
  facetOptions, initialCounts, emptyFacets, datasetStats, directoryStats, currentGovernment,
} = await import("./repository.ts");
const { sitemapRoutes, prerenderRoutes } = await import("../lib/routeManifest.ts");

describe("deceased exclusion (mocked source record)", () => {
  it("keeps the record in the full universe, marked deceased", () => {
    const view = allPeople(TODAY).find((v) => v.person.id === DECEASED_ID);
    expect(view).toBeDefined();
    expect(view?.vitalStatus).toBe("deceased");
  });

  it("keeps the profile reachable by direct URL — historical record, not erased", () => {
    const view = getPersonBySlug(DECEASED_SLUG, TODAY);
    expect(view).not.toBeNull();
    expect(view?.vitalStatus).toBe("deceased");
    expect(view?.person.canonicalName).toBe(DECEASED_NAME);
  });

  it("is absent from discoverablePeople", () => {
    expect(discoverablePeople(TODAY).some((v) => v.person.id === DECEASED_ID)).toBe(false);
  });

  it("is absent from the directory query, even with no filters applied", () => {
    const results = queryPeople({}, TODAY);
    expect(results.some((v) => v.person.id === DECEASED_ID)).toBe(false);
  });

  it("is absent from search/autocomplete suggestions by name", () => {
    const ranked = suggestPeopleRanked(DECEASED_NAME, { today: TODAY });
    expect(ranked.some((entry) => entry.view.person.id === DECEASED_ID)).toBe(false);
  });

  it("is absent from A-Z letter counts", () => {
    const view = allPeople(TODAY).find((v) => v.person.id === DECEASED_ID)!;
    const initial = view.person.canonicalName.charAt(0).toUpperCase();
    const withoutDeceased = queryPeople({ initial }, TODAY).filter((v) => v.person.id !== DECEASED_ID);
    const counts = initialCounts(emptyFacets(), "", TODAY);
    expect(counts.get(initial)).toBe(withoutDeceased.length);
  });

  it("is absent from facet counts (roles)", () => {
    const options = facetOptions(emptyFacets(), "", TODAY);
    const cabinetOption = options.roles.find((r) => r.id === RoleType.CABINET_MINISTER);
    const realCabinetCount = discoverablePeople(TODAY).filter(
      (v) => v.roleTypes.includes(RoleType.CABINET_MINISTER),
    ).length;
    expect(cabinetOption?.count ?? 0).toBe(realCabinetCount);
  });

  it("does not shrink datasetStats (full coverage figure) but does shrink directoryStats", () => {
    expect(datasetStats(TODAY).people).toBe(directoryStats(TODAY).people + 1);
  });

  it("is excluded from the sitemap but stays a real prerendered file", () => {
    const path = `/person/${encodeURIComponent(DECEASED_SLUG)}`;
    expect(sitemapRoutes(TODAY).map((r) => r.path)).not.toContain(path);
    expect(prerenderRoutes(TODAY).map((r) => r.path)).toContain(path);
  });

  it("never renders as a sitting minister, even holding an open Cabinet position", () => {
    const gov = currentGovernment(TODAY);
    expect(gov.cabinet.some((m) => m.personId === DECEASED_ID)).toBe(false);
  });

  it("current government is otherwise unaffected — real ministers still appear", () => {
    const gov = currentGovernment(TODAY);
    // Real Cabinet ministers, unrelated to the synthetic deceased one, are
    // still present and unaffected by the defensive filter.
    expect(gov.cabinet.length).toBeGreaterThan(0);
    expect(gov.cabinet.every((m) => m.personId !== DECEASED_ID)).toBe(true);
  });
});
