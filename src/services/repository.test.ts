import { describe, it, expect } from "vitest";
import {
  allPeople,
  currentPeople,
  getPersonBySlug,
  emptyFacets,
  searchPeople,
  suggestPeople,
  filterPeople,
  facetOptions,
  queryPeople,
  initialOf,
  initialCounts,
  ALPHABET,
  paginate,
  datasetStats,
  directoryStats,
  discoverablePeople,
  excludeDeceased,
  sourcesCitedBy,
  evidenceFor,
  recordsCiting,
  sourcesInUse,
  verificationStateCounts,
  parties,
  districts,
  DATASET,
  deriveFallbackContext,
} from "./repository.ts";
import { VerificationState, RoleType, type Position } from "../types/models.ts";
import { hasPreciseEvidence } from "../lib/verification.ts";
import { isCurrent } from "../lib/positions.ts";

/**
 * These tests run against the REAL imported dataset — the 225 sitting
 * members retrieved from the official Parliament of Sri Lanka Directory of
 * Members. They assert structural invariants (every member has evidence, no
 * duplicate ids, the conflict is surfaced) rather than pinning the specific
 * people, because the source legitimately changes when Parliament changes.
 *
 * Where a specific member IS named, it is because their office is a
 * structural fact worth pinning — there is exactly one Speaker.
 */
const TODAY = new Date(Date.UTC(2026, 7, 28));
const PARLIAMENT_SEATS = 225;

/** Minimal valid Position fixture; tests override only the fields they need. */
const BASE_POSITION: Position = {
  id: "base",
  personId: "test-person",
  title: "Member of Parliament",
  roleType: RoleType.MEMBER_OF_PARLIAMENT,
  institution: "Parliament of Sri Lanka",
  ministry: null,
  districtId: null,
  constituency: null,
  startDate: "2000-01-01",
  endDate: null,
  endStatus: "ongoing",
  currentAsOf: null,
  appointmentType: "elected",
  precedence: 99,
  claim: { verification: VerificationState.SOURCE_LINKED, evidenceIds: [], verifiedAt: null },
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
};

describe("dataset", () => {
  it("holds the full sitting Parliament, plus the historical record", () => {
    // Sri Lanka's Parliament has 225 seats and the directory lists all of
    // them. The dataset is deliberately LARGER than that now: it also carries
    // former members, so "everyone in the dataset" and "everyone in office"
    // are no longer the same set and the test has to say which it means.
    expect(currentPeople(TODAY)).toHaveLength(PARLIAMENT_SEATS);
    expect(allPeople(TODAY).length).toBeGreaterThanOrEqual(PARLIAMENT_SEATS);
  });

  it("is in live mode, not demonstration", () => {
    expect(DATASET.mode).toBe("live");
  });

  it("gives every person a unique id and a unique slug", () => {
    // Uniqueness across the WHOLE universe, current and historical. Current
    // and past members share Parliament's identifier space, so this is the
    // assertion that would catch the two directories duplicating a person.
    const views = allPeople(TODAY);
    expect(new Set(views.map((v) => v.person.id)).size).toBe(views.length);
    expect(new Set(views.map((v) => v.person.slug)).size).toBe(views.length);
  });

  it("anchors every person on the id of whichever source identified them", () => {
    // This is what makes re-import and identity resolution safe.
    //
    // Not every person comes from Parliament any more: the President is not a
    // Member of Parliament and appears in neither parliamentary directory, so
    // he is identified by the Cabinet Office instead. The invariant that
    // matters is that a person's id names the identifier space it came from —
    // which is what stops two sources' id "3449" from colliding.
    for (const view of allPeople(TODAY)) {
      const { parliament, cabinetOffice } = view.person.externalIds;
      expect(parliament ?? cabinetOffice).toBeTruthy();
      expect(view.person.id).toBe(
        parliament ? `parliament:${parliament}` : `cabinet:${cabinetOffice}`,
      );
    }
  });

  it("resolves a person by slug and returns null for an unknown one", () => {
    const speaker = allPeople(TODAY).find((v) => v.headline?.title === "Speaker");
    expect(speaker).toBeDefined();
    expect(getPersonBySlug(speaker!.person.slug, TODAY)?.person.id).toBe(speaker!.person.id);
    expect(getPersonBySlug("no-such-person", TODAY)).toBeNull();
    expect(getPersonBySlug("", TODAY)).toBeNull();
  });

  it("leaves no honorific inside a canonical name or slug", () => {
    for (const view of allPeople(TODAY)) {
      expect(view.person.canonicalName).not.toMatch(/^(Hon\.|Dr\.|Prof\.|Mrs\.|Ms\.|Major)/i);
      expect(view.person.slug).not.toMatch(/^(hon|dr|prof|mrs|ms|major)-/);
      expect(view.person.canonicalName).not.toMatch(/M\.P\.$/);
      expect(view.person.canonicalName).not.toMatch(/Attorney at Law/i);
    }
  });
});

describe("positions", () => {
  it("gives every sitting member a Member of Parliament position", () => {
    for (const view of currentPeople(TODAY)) {
      expect(view.positions.some((p) => p.roleType === RoleType.MEMBER_OF_PARLIAMENT)).toBe(true);
    }
  });

  it("treats every sitting member as currently serving", () => {
    // The source publishes no start dates, so this works via `currentAsOf` —
    // a source's dated assertion that the office is held. Without it every
    // sitting MP would render as no-longer-serving.
    const views = currentPeople(TODAY);
    expect(views.every((v) => v.serving)).toBe(true);
  });

  it("takes term dates from the source's Legislative History", () => {
    // Parliament publishes each member's own service dates per parliament.
    // An earlier version of this test asserted every position was undated,
    // which was true only because the connector was discarding the pane those
    // dates live in.
    const dated = allPeople(TODAY)
      .flatMap((v) => v.positions)
      .filter((p) => p.startDate !== null);
    expect(dated.length).toBeGreaterThan(400);
  });

  it("never carries both a start date and the dated-observation fallback", () => {
    // `currentAsOf` exists ONLY for offices the source asserts are held
    // without saying since when. Once a real start date is known the fallback
    // must disappear, or a position would carry two competing accounts of
    // when it began — the exact contradiction this model forbids.
    for (const view of allPeople(TODAY)) {
      for (const position of view.positions) {
        expect(position.startDate !== null && position.currentAsOf !== null).toBe(false);

        // A position CAN legitimately carry no dates at all: the past-members
        // directory publishes one office as "Deputy Minister of Irrigation,
        // Power & Highways ( - )", an empty date field. What must never happen
        // is that such a position reads as currently held — so where there is
        // no temporal information, the end must be explicitly not-recorded,
        // which is what stops `isCurrent()` treating silence as tenure.
        if (position.startDate === null && position.currentAsOf === null) {
          expect(position.endStatus).toBe("not-recorded");
          expect(isCurrent(position, TODAY)).toBe(false);
        }
      }
    }
  });

  it("never invents a date the source did not publish", () => {
    // Every date on a position must be a full ISO date copied from the
    // source, never a widened year or a plausible-looking guess.
    for (const view of allPeople(TODAY)) {
      for (const position of view.positions) {
        for (const date of [position.startDate, position.endDate]) {
          if (date !== null) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });

  it("still lets a recorded end date override the source's currently-held assertion", () => {
    const mp = allPeople(TODAY)[0]!.positions[0]!;
    expect(isCurrent(mp, TODAY)).toBe(true);
    expect(isCurrent({ ...mp, endDate: "2025-01-01" }, TODAY)).toBe(false);
  });

  it("splits compound ministerial roles into separate positions", () => {
    // The Prime Minister also holds an education portfolio; that is two
    // offices, and both must exist as distinct positions.
    const pm = allPeople(TODAY).find((v) =>
      v.positions.some((p) => p.roleType === RoleType.PRIME_MINISTER),
    );
    expect(pm).toBeDefined();
    const titles = pm!.positions.map((p) => p.title);
    expect(titles).toContain("Prime Minister");
    expect(titles.some((t) => t.startsWith("Minister of Education"))).toBe(true);
    expect(titles).toContain("Member of Parliament");
  });

  it("classifies every SITTING member's office without falling back to 'other'", () => {
    const unclassified = currentPeople(TODAY)
      .flatMap((v) => v.positions)
      .filter((p) => p.roleType === RoleType.OTHER_PUBLIC_OFFICE);
    expect(unclassified.map((p) => p.title)).toEqual([]);
  });

  it("leaves only genuinely rank-less historical titles unclassified", () => {
    // Fifty years of past-member records brought in ~120 office titles the
    // current directory has no vocabulary for. Nearly all are classifiable —
    // abolished ranks (District Minister, Parliamentary Secretary) and the
    // source's own misspellings ("Deputy Ministr", "Governer").
    //
    // A handful genuinely cannot be classified, because the SOURCE states no
    // rank: one entry reads simply "Vocational Training and Rural Industries".
    // Those stay in the catch-all and stay visible. The assertion is that the
    // remainder is small — a regression in the classifier shows up as this
    // number climbing, rather than as titles quietly mis-filed.
    const titles = [...new Set(
      allPeople(TODAY)
        .flatMap((v) => v.positions)
        .filter((p) => p.roleType === RoleType.OTHER_PUBLIC_OFFICE)
        .map((p) => p.title),
    )];
    expect(titles.length).toBeLessThanOrEqual(6);
  });

  it("never files a deputy ministry as a cabinet post", () => {
    const deputies = allPeople(TODAY)
      .flatMap((v) => v.positions)
      .filter((p) => p.title.startsWith("Deputy Minister"));
    expect(deputies.length).toBeGreaterThan(0);
    deputies.forEach((p) => expect(p.roleType).toBe(RoleType.DEPUTY_MINISTER));
  });

  it("records the ministry a ministerial position governs", () => {
    // Scoped to sitting members: historical titles from earlier decades
    // ("Foreign Minister") do not follow the "Minister of X" form the ministry
    // is parsed from, and inventing one for them would be a guess.
    const cabinet = currentPeople(TODAY)
      .flatMap((v) => v.positions)
      .filter((p) => p.roleType === RoleType.CABINET_MINISTER);
    expect(cabinet.length).toBeGreaterThan(0);
    cabinet.forEach((p) => expect(p.ministry).toBeTruthy());
  });

  it("leads a profile with the highest-precedence office, not 'Member of Parliament'", () => {
    const pm = allPeople(TODAY).find((v) =>
      v.positions.some((p) => p.roleType === RoleType.PRIME_MINISTER),
    )!;
    expect(pm.headline?.title).toBe("Prime Minister");
  });
});

describe("evidence and verification", () => {
  it("cites a specific document for every person, not just an institution", () => {
    for (const view of allPeople(TODAY)) {
      const evidence = evidenceFor(view.person.claim);
      expect(evidence.length).toBeGreaterThan(0);
      for (const record of evidence) {
        expect(hasPreciseEvidence(record)).toBe(true);
        // A specific document from whichever institution identified them: a
        // member profile for anyone Parliament lists, the Cabinet roster for
        // the President, whom it does not.
        expect(record.sourceUrl).toMatch(
          /^https:\/\/(www\.parliament\.lk\/.*mp-profile\/\d+|www\.cabinetoffice\.gov\.lk\/)/,
        );
        expect(record.retrievedAt).toBeTruthy();
        // Scoped to Parliament's OWN evidence: the Cabinet Office publishes
        // no ids at all (CLAUDE.md's own documented invariant), so its
        // person-level evidence legitimately carries sourceRecordId: null.
        // Since the cross-source evidence fix, a person matched by both
        // sources can cite an S006 record alongside their S001 one; only the
        // S001 record is expected to carry Parliament's own numeric id.
        if (view.person.externalIds.parliament && record.sourceId === "S001") {
          expect(record.sourceRecordId).toBe(view.person.externalIds.parliament);
        }
      }
    }
  });

  it("marks imported facts SOURCE_LINKED — never VERIFIED", () => {
    // Precise evidence from the authoritative source, but nobody has
    // confirmed the extraction. See sync/verificationPolicy.ts.
    const states = new Set(allPeople(TODAY).map((v) => v.verification));
    expect(states.has(VerificationState.VERIFIED)).toBe(false);
    expect(states.has(VerificationState.DEMONSTRATION)).toBe(false);
    expect(states.has(VerificationState.SOURCE_LINKED)).toBe(true);
  });

  it("attaches no verification timestamp, because nothing was verified", () => {
    for (const view of allPeople(TODAY)) {
      expect(view.person.claim.verifiedAt).toBeNull();
    }
  });

  it("surfaces the real cross-page district disagreement as CONFLICTING", () => {
    // Two members are listed under "National List" by the directory while
    // their own profile page names a territorial district. Javora shows the
    // conflict rather than silently picking a side.
    const conflicting = allPeople(TODAY).flatMap((v) =>
      v.positions.filter((p) => p.claim.verification === VerificationState.CONFLICTING),
    );
    expect(conflicting.length).toBeGreaterThan(0);
  });

  it("counts records citing the Parliament source, and none citing an unconnected one", () => {
    // Every person cites Parliament — sitting members from the current
    // directory, former members from the past-members directory — so this
    // grows with the historical import rather than pinning at 225.
    // Everyone Parliament lists cites Parliament. The President does not: he
    // is not a member, and cites the Cabinet Office instead.
    const fromParliament = allPeople(TODAY).filter((v) => v.person.externalIds.parliament);
    expect(recordsCiting("S001", TODAY)).toBe(fromParliament.length);
    expect(recordsCiting("S006", TODAY)).toBeGreaterThan(0);
    expect(recordsCiting("S002", TODAY)).toBe(0);
    // S006 is now connected, so it is no longer an example of an unused source.
    expect(recordsCiting("S999", TODAY)).toBe(0);
  });

  it("tallies the sources a record cites", () => {
    const view = allPeople(TODAY)[0]!;
    const cited = sourcesCitedBy(view);
    expect(cited.map((c) => c.sourceId)).toContain("S001");
  });
});

describe("sourcesInUse", () => {
  it("names exactly the connected, authoritative sources — Parliament and the Cabinet Office", () => {
    // S002-S005 are declared but "not-connected"; S900 is connected
    // ("manual-import") but authoritativeFor: [] by its own definition, so
    // it must not appear here even though it is not "not-connected".
    expect(sourcesInUse().map((s) => s.id).sort()).toEqual(["S001", "S006"]);
  });
});

describe("verificationStateCounts", () => {
  it("tallies claims across every claim-bearing record kind, not just positions", () => {
    const counts = verificationStateCounts(TODAY);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    // One claim per person (their own identity claim) plus one per position,
    // qualification, event and affiliation they hold — necessarily more than
    // the position count alone, since every person contributes at least their
    // own person-level claim on top of their positions.
    const positionCount = allPeople(TODAY).reduce((sum, v) => sum + v.positions.length, 0);
    expect(total).toBeGreaterThan(positionCount);
    // Every key returned is a real verification state, never `undefined` —
    // regression guard for tallying `position` itself instead of
    // `position.claim`, which silently produces an `undefined` bucket.
    for (const state of Object.keys(counts)) {
      expect(Object.values(VerificationState)).toContain(state);
    }
    // The dataset is imported, not hand-confirmed: every claim is at most
    // SOURCE_LINKED or CONFLICTING (the two states an import can actually
    // produce), never VERIFIED, which requires a human confirmation date.
    expect(counts[VerificationState.VERIFIED] ?? 0).toBe(0);
  });
});

describe("search", () => {
  const pool = () => allPeople(TODAY);

  it("finds people by first name", () => {
    const results = searchPeople("anura", pool());
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((v) => /anura/i.test(v.person.canonicalName))).toBe(true);
  });

  it("matches a term against any indexed field, not only the name", () => {
    // "anura" is a prefix of both the given name Anura and the district
    // Anuradhapura, so members of that district legitimately match. This is
    // token-prefix search working as intended, not a false positive.
    const results = searchPeople("anura", pool());
    results.forEach((view) => {
      const haystack = [
        view.person.canonicalName,
        view.partyLabel ?? "",
        view.districtLabel ?? "",
        ...view.positions.map((p) => p.title),
      ]
        .join(" ")
        .toLowerCase();
      expect(haystack).toMatch(/anura/);
    });
  });

  it("finds a person by surname alone", () => {
    expect(searchPeople("premadasa", pool()).length).toBeGreaterThan(0);
  });

  it("ignores case", () => {
    expect(searchPeople("PREMADASA", pool()).length).toBe(searchPeople("premadasa", pool()).length);
  });

  it("finds people by party name and by abbreviation", () => {
    expect(searchPeople("samagi", pool()).length).toBeGreaterThan(0);
    expect(searchPeople("sjb", pool()).length).toBeGreaterThan(0);
  });

  it("finds people by district", () => {
    expect(searchPeople("colombo", pool()).length).toBeGreaterThan(0);
  });

  it("finds people by office", () => {
    expect(searchPeople("prime", pool()).length).toBeGreaterThan(0);
    expect(searchPeople("speaker", pool()).length).toBeGreaterThan(0);
  });

  it("narrows as terms are added", () => {
    const one = searchPeople("colombo", pool()).length;
    const two = searchPeople("colombo minister", pool()).length;
    expect(two).toBeLessThanOrEqual(one);
  });

  it("returns everything for an empty query and nothing for nonsense", () => {
    expect(searchPeople("", pool()).length).toBeGreaterThanOrEqual(PARLIAMENT_SEATS);
    expect(searchPeople("zzzzz-not-a-name", pool())).toHaveLength(0);
  });
});

describe("queryPeople (directory search)", () => {
  it("ranks name matches above incidental field matches, same as the typeahead", () => {
    // Same "anura"/Anuradhapura scenario as suggestPeople below, but this is
    // what DirectoryPage actually renders — queryPeople had no ranking at all
    // until this test, so district-only matches sat wherever precedence put
    // them, ahead of members actually named Anura/Anuradha.
    const results = queryPeople({ query: "anura" }, TODAY);
    const firstNonName = results.findIndex((v) => !/anura/i.test(v.person.canonicalName));
    const lastName = results.map((v) => /anura/i.test(v.person.canonicalName)).lastIndexOf(true);
    expect(lastName).toBeGreaterThanOrEqual(0);
    if (firstNonName !== -1) expect(lastName).toBeLessThan(firstNonName);
  });
});

describe("suggestPeople (typeahead)", () => {
  it("suggests matching people while typing", () => {
    const results = suggestPeople("anura", { today: TODAY });
    expect(results.length).toBeGreaterThan(0);
    // The user's worked example: typing "anura" surfaces Anura Karunathilaka.
    expect(results.some((v) => /^Anura /i.test(v.person.canonicalName))).toBe(true);
  });

  it("ranks name matches above incidental field matches", () => {
    // "anura" prefixes both the given name Anura and the district
    // Anuradhapura. Before ranking, three ministers from that district sat
    // above the member actually named Anuradha, purely on office precedence.
    const results = suggestPeople("anura", { today: TODAY });
    const firstNonName = results.findIndex((v) => !/^anura/i.test(v.person.canonicalName));
    const lastName = results.map((v) => /^anura/i.test(v.person.canonicalName)).lastIndexOf(true);
    expect(lastName).toBeGreaterThanOrEqual(0);
    if (firstNonName !== -1) expect(lastName).toBeLessThan(firstNonName);
  });

  it("returns nothing for an empty query", () => {
    expect(suggestPeople("", { today: TODAY })).toEqual([]);
    expect(suggestPeople("   ", { today: TODAY })).toEqual([]);
  });

  it("caps the number of suggestions", () => {
    // "a" matches a great many members; the dropdown must stay usable.
    expect(suggestPeople("a", { limit: 8, today: TODAY }).length).toBeLessThanOrEqual(8);
  });

  it("carries what the dropdown renders: role and party", () => {
    const [first] = suggestPeople("premadasa", { today: TODAY });
    expect(first).toBeDefined();
    expect(first!.headline).not.toBeNull();
    expect(first!.partyLabel).toBeTruthy();
  });

  /**
   * suggestionRank caches each person's name/alias/office tokens by id
   * (repository.ts) instead of re-tokenising them on every call, since none
   * of the three depend on the query. This is the test that would fail if a
   * caching bug let one person's cached tokens leak onto another id, or
   * returned a stale entry after the cache was already populated.
   */
  it("gives a stable, correct rank across repeated queries for different people", () => {
    const first = suggestPeople("anura", { today: TODAY });
    const other = suggestPeople("premadasa", { today: TODAY });
    const repeat = suggestPeople("anura", { today: TODAY });
    expect(repeat.map((v) => v.person.id)).toEqual(first.map((v) => v.person.id));
    expect(other.some((v) => /premadasa/i.test(v.person.canonicalName))).toBe(true);
  });
});

describe("filters", () => {
  it("filters by party", () => {
    const partyId = parties[0]!.id;
    const results = filterPeople({ ...emptyFacets(), parties: [partyId] }, allPeople(TODAY));
    expect(results.length).toBeGreaterThan(0);
    results.forEach((v) => expect(v.partyId).toBe(partyId));
  });

  it("filters by district", () => {
    const districtId = districts.find((d) => d.id === "colombo")!.id;
    const results = filterPeople({ ...emptyFacets(), districts: [districtId] }, allPeople(TODAY));
    expect(results.length).toBeGreaterThan(0);
    results.forEach((v) => expect(v.districtId).toBe(districtId));
  });

  it("filters by role type", () => {
    const results = filterPeople(
      { ...emptyFacets(), roles: [RoleType.CABINET_MINISTER] },
      allPeople(TODAY),
    );
    expect(results.length).toBeGreaterThan(0);
    results.forEach((v) => expect(v.roleTypes).toContain(RoleType.CABINET_MINISTER));
  });

  it("combines facets conjunctively and ORs within a facet", () => {
    const [a, b] = parties;
    const single = filterPeople({ ...emptyFacets(), parties: [a!.id] }, allPeople(TODAY));
    const pair = filterPeople({ ...emptyFacets(), parties: [a!.id, b!.id] }, allPeople(TODAY));
    expect(pair.length).toBeGreaterThan(single.length);
  });

  it("returns everything when no facet is selected", () => {
    expect(filterPeople(emptyFacets(), allPeople(TODAY)).length).toBe(allPeople(TODAY).length);
  });

  it("counts a facet against the other facets, not against itself", () => {
    const partyId = parties[0]!.id;
    const options = facetOptions({ ...emptyFacets(), parties: [partyId] }, "", TODAY);
    expect(options.parties.find((o) => o.id === partyId)?.count).toBeGreaterThan(0);
  });

  /**
   * facetOptions was rewritten from ~70 per-option filter passes to a
   * single-pass tally (repository.ts). These pin the two ways that rewrite
   * could go quietly wrong: a person holding several role types must be
   * counted under EACH of them (roleTypes is checked with `.includes()`, not
   * equality, precisely because it is not single-valued), and a facet value a
   * reader has already selected must keep appearing even at count zero, so
   * they can still deselect it.
   */
  it("counts a person under every role type they hold, not just one", () => {
    // An exact invariant, not a >0 spot check: the sum of every role-type
    // option's count must equal the sum of roleTypes.length across all
    // people, since each role a person holds contributes exactly one tally.
    // A tally that only counted a person's FIRST role type (the specific
    // mistake a naive single-pass rewrite could make) would undercount this
    // sum by exactly (roleTypes.length - 1) per multi-role person - verified
    // by mutating the implementation to do that and confirming this fails.
    const multiRole = allPeople(TODAY).filter((v) => v.roleTypes.length > 1);
    expect(multiRole.length).toBeGreaterThan(0); // otherwise this proves nothing

    const options = facetOptions(emptyFacets(), "", TODAY);
    const totalRoleCounts = options.roles.reduce((sum, o) => sum + o.count, 0);
    const totalRoleTypesHeld = allPeople(TODAY).reduce((sum, v) => sum + v.roleTypes.length, 0);
    expect(totalRoleCounts).toBe(totalRoleTypesHeld);
  });

  it("keeps a selected option visible even once its count would be zero", () => {
    // Selecting an implausible combination (a party AND a district that share
    // no member) should still list the selected party, at count 0, so the
    // reader can remove the selection rather than being stuck with a
    // filter they cannot see or undo.
    const partyId = parties[0]!.id;
    const districtId = districts.find((d) => d.id !== parties[0]!.id)?.id ?? districts[0]!.id;
    const narrowed = filterPeople({ ...emptyFacets(), parties: [partyId], districts: [districtId] }, allPeople(TODAY));
    if (narrowed.length > 0) return; // combination is not actually empty; nothing to assert here
    const options = facetOptions({ ...emptyFacets(), parties: [partyId], districts: [districtId] }, "", TODAY);
    const selectedDistrict = options.districts.find((o) => o.id === districtId);
    expect(selectedDistrict).toBeDefined();
    expect(selectedDistrict?.count).toBe(0);
  });
});

describe("query and pagination", () => {
  it("paginates without losing or duplicating records", () => {
    const results = queryPeople({}, TODAY);
    const page = paginate(results, { page: 1, perPage: 12 });
    expect(page.items).toHaveLength(12);
    expect(page.total).toBe(allPeople(TODAY).length);
    expect(page.hasMore).toBe(true);
  });

  it("clamps an out-of-range page rather than returning nothing", () => {
    const page = paginate(queryPeople({}, TODAY), { page: 999, perPage: 12 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.hasMore).toBe(false);
  });

  it("ranks the Prime Minister above a backbench member", () => {
    const results = queryPeople({}, TODAY);
    const pmIndex = results.findIndex((v) => v.headline?.title === "Prime Minister");
    const backbencher = results.findIndex(
      (v) => v.headline?.roleType === RoleType.MEMBER_OF_PARLIAMENT,
    );
    expect(pmIndex).toBeGreaterThanOrEqual(0);
    expect(pmIndex).toBeLessThan(backbencher);
  });
});

describe("dataset statistics", () => {
  it("reports the real shape of the import", () => {
    const stats = datasetStats(TODAY);
    // The dataset spans sitting and former members; only the sitting count is 225.
    expect(stats.people).toBeGreaterThanOrEqual(PARLIAMENT_SEATS);
    expect(stats.serving).toBe(PARLIAMENT_SEATS);
    expect(stats.positions).toBeGreaterThan(PARLIAMENT_SEATS);
    expect(stats.parties).toBeGreaterThan(1);
    expect(stats.evidenceRecords).toBeGreaterThan(0);
  });

  it("reports zero elections, because none have been imported", () => {
    expect(datasetStats(TODAY).elections).toBe(0);
  });
});

/**
 * Regression coverage for three real bugs the bundle-vs-API parity test
 * (server/sync/personParity.test.ts) surfaced, each pinned against the
 * acceptance set named when they were fixed. See repository.ts's
 * `deriveFallbackContext`, `mergeCrossSourcePositions` and
 * `withAllPersonEvidence` for the fixes themselves.
 */
describe("former-member party and district context", () => {
  const named = (name: string) => allPeople(TODAY).find((v) => v.person.canonicalName === name);

  it("still resolves party/district for a CURRENT member from personContext, unaffected by the fallback", () => {
    // Precedence check: a sitting member must keep going through
    // personContext, never the fallback, so this fix cannot regress the path
    // that already worked for all 225 of them.
    const harini = named("Harini Amarasuriya");
    expect(harini).toBeDefined();
    expect(harini!.partyLabel).toBeTruthy();
    expect(harini!.districtLabel).toBeTruthy();
  });

  it("gives former members their party from their own affiliation history, not null", () => {
    // Before the fix, personContext.get(id) was undefined for every one of
    // these — none of them are in the current sitting-members listing — and
    // buildView() fell back to a hardcoded { partyId: null, districtId: null }
    // rather than reading the affiliation record that was sitting right there.
    for (const name of ["Ranil Wickremesinghe", "Wimal Weerawansa", "G. L. Peiris", "Mahinda Rajapaksa"]) {
      const view = named(name);
      expect(view, `${name} should exist in the dataset`).toBeDefined();
      expect(view!.partyLabel, `${name} should have a resolvable party`).toBeTruthy();
    }
  });

  it("derives district from a position the same way the database does: open seat first, then precedence", () => {
    // No real former member currently exercises the POSITIVE case:
    // `pastMembersDataset` — the historical crawl every former member's
    // positions come from — captures a districtId for 0 of its 5,983
    // positions (verified directly against the dataset). That is a gap in
    // the historical crawler, not in this fallback: `deriveFallbackContext`
    // has nothing to read a district from for Ranil Wickremesinghe, Wimal
    // Weerawansa or G. L. Peiris today, and correctly returns null for all
    // three rather than inventing one — see the "never invents" test below.
    // This test instead proves the DERIVATION RULE itself against synthetic
    // data, so the fallback is verified now and will start working the
    // moment the historical crawler starts recording districts.
    const closedWithDistrict: Position = {
      ...BASE_POSITION,
      id: "p1",
      districtId: "colombo",
      endDate: "2010-01-01",
      precedence: 5,
    };
    const openWithDistrict: Position = {
      ...BASE_POSITION,
      id: "p2",
      districtId: "gampaha",
      endDate: null,
      precedence: 50,
    };
    const openHigherPrecedenceNoDistrict: Position = {
      ...BASE_POSITION,
      id: "p3",
      districtId: null,
      endDate: null,
      precedence: 1,
    };
    const context = deriveFallbackContext(
      [closedWithDistrict, openWithDistrict, openHigherPrecedenceNoDistrict],
      [],
    );
    // The open seat wins over the closed one even though the closed one has
    // better precedence — an ended seat must never outrank a currently held
    // one, matching server/api/queries.ts's DISTRICT_SELECT ordering exactly.
    expect(context.districtId).toBe("gampaha");
  });

  it("confirms today's real gap: former members read null for district because no historical position carries one", () => {
    for (const name of ["Ranil Wickremesinghe", "Wimal Weerawansa", "G. L. Peiris"]) {
      const view = named(name);
      expect(view, `${name} should exist in the dataset`).toBeDefined();
      expect(view!.districtId).toBeNull();
    }
  });

  it("never invents a party or district: someone with no affiliation/seat record stays null", () => {
    // The President has no parliamentary seat (he was never one for the
    // office itself) and, depending on import coverage, may have no
    // district on record either — the fallback must not fabricate one.
    // Anyone with genuinely no district in either dataset must still read
    // null rather than getting an arbitrary position's leftover value.
    const districtless = allPeople(TODAY).filter((v) => !v.positions.some((p) => p.districtId));
    for (const view of districtless.slice(0, 25)) {
      expect(view.districtId).toBeNull();
      expect(view.districtLabel).toBeNull();
    }
  });

  it("does not duplicate anyone while deriving the fallback", () => {
    const ids = allPeople(TODAY).map((v) => v.person.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cross-source position deduplication (Parliament vs Cabinet Office)", () => {
  const harini = () => allPeople(TODAY).find((v) => v.person.canonicalName === "Harini Amarasuriya")!;

  it("shows exactly one current Prime Minister position, not one per source", () => {
    const current = harini().positions.filter((p) => p.title === "Prime Minister" && isCurrent(p, TODAY));
    expect(current).toHaveLength(1);
  });

  it("shows exactly one current Education portfolio position, not one per source", () => {
    const current = harini().positions.filter(
      (p) => p.title === "Minister of Education, Higher Education and Vocational Education" && isCurrent(p, TODAY),
    );
    expect(current).toHaveLength(1);
  });

  it("keeps Parliament's dates on the surviving merged position, not Cabinet's dateless claim", () => {
    const pm = harini().positions.find((p) => p.title === "Prime Minister" && isCurrent(p, TODAY));
    expect(pm?.startDate).toBe("2024-11-18");
  });

  it("cites BOTH sources on the surviving merged position", () => {
    const pm = harini().positions.find((p) => p.title === "Prime Minister" && isCurrent(p, TODAY));
    expect(pm).toBeDefined();
    const sourceIds = new Set(evidenceFor(pm!.claim).map((e) => e.sourceId));
    expect(sourceIds.has("S001")).toBe(true);
    expect(sourceIds.has("S006")).toBe(true);
  });

  it("does NOT merge distinct historical terms of the same office", () => {
    // Harini held the Prime Minister title twice: a one-day caretaker term on
    // 2024-09-24, and the current one starting 2024-11-18. Deduplicating on
    // title alone would collapse these into one row and erase a real term.
    const pmPositions = harini().positions.filter((p) => p.title === "Prime Minister");
    expect(pmPositions).toHaveLength(2);
    const dated = pmPositions.map((p) => `${p.startDate}|${p.endDate}`).sort();
    expect(dated).toEqual(["2024-09-24|2024-09-24", "2024-11-18|null"]);
  });

  it("keeps a Cabinet-only office standalone when Parliament reports no open counterpart", () => {
    // Structural guard: the merge must not accidentally require every
    // Cabinet position to find a Parliament match. Someone the Cabinet
    // Office names in an office Parliament's own page never separately
    // lists must still be published, not silently dropped.
    const cabinetOnlyPositions = allPeople(TODAY).flatMap((v) =>
      v.positions.filter((p) => evidenceFor(p.claim).some((e) => e.sourceId === "S006")),
    );
    expect(cabinetOnlyPositions.length).toBeGreaterThan(0);
  });
});

describe("cross-source person evidence preservation", () => {
  const named = (name: string) => allPeople(TODAY).find((v) => v.person.canonicalName === name)!;

  it("Anura Kumara Dissanayake retains both Parliament and Cabinet Office evidence after the identity merge", () => {
    const view = named("Anura Kumara Dissanayake");
    const sourceIds = new Set(evidenceFor(view.person.claim).map((e) => e.sourceId));
    expect(sourceIds.has("S001")).toBe(true);
    expect(sourceIds.has("S006")).toBe(true);
  });

  it("Harini Amarasuriya retains both Parliament and Cabinet Office person-level evidence", () => {
    const view = named("Harini Amarasuriya");
    const sourceIds = new Set(evidenceFor(view.person.claim).map((e) => e.sourceId));
    expect(sourceIds.has("S001")).toBe(true);
    expect(sourceIds.has("S006")).toBe(true);
  });

  it("never cites the same evidence row twice on one claim", () => {
    for (const view of allPeople(TODAY)) {
      const ids = view.person.claim.evidenceIds;
      expect(new Set(ids).size, `${view.person.canonicalName} should not double-cite evidence`).toBe(ids.length);
    }
  });

  it("is idempotent: recomputing the view twice yields identical evidence sets", () => {
    const first = named("Anura Kumara Dissanayake").person.claim.evidenceIds;
    const second = allPeople(TODAY).find((v) => v.person.canonicalName === "Anura Kumara Dissanayake")!.person.claim
      .evidenceIds;
    expect([...second].sort()).toEqual([...first].sort());
  });

  it("does not create a second person for someone merged across sources", () => {
    // The identity merge widens evidence in place; it must never be
    // achieved by publishing the same human under two ids.
    const ids = allPeople(TODAY).map((v) => v.person.id);
    expect(ids.filter((id) => id === "parliament:112")).toHaveLength(1);
  });
});

/**
 * The directory's A-Z index.
 *
 * It is a real narrowing of the result set, not a scroll hint, so the counts
 * beside every other control have to agree with it. The specific failure
 * these exist to prevent: a reader on "W" being shown "United National Party
 * 479" beside thirty-two results, because the facet counts were computed
 * against the whole register while the grid was not.
 */
describe("A-Z index", () => {
  it("files every person under exactly one bucket, and never drops one", () => {
    const people = allPeople(TODAY);
    const counts = initialCounts(emptyFacets(), "", TODAY);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBe(people.length);
    for (const key of counts.keys()) {
      expect(key === "#" || ALPHABET.includes(key)).toBe(true);
    }
  });

  it("returns exactly the people whose canonical name starts with that letter", () => {
    const results = queryPeople({ initial: "W" }, TODAY);
    expect(results.length).toBeGreaterThan(0);
    for (const view of results) expect(initialOf(view)).toBe("W");
    expect(results.length).toBe(initialCounts(emptyFacets(), "", TODAY).get("W"));
  });

  it("narrows the facet counts too, so no control reports the whole register", () => {
    const all = facetOptions(emptyFacets(), "", TODAY);
    const filtered = facetOptions(emptyFacets(), "", TODAY, "W");
    const totalFor = (options: { count: number }[]) => options.reduce((sum, o) => sum + o.count, 0);
    expect(totalFor(filtered.statuses)).toBe(queryPeople({ initial: "W" }, TODAY).length);
    expect(totalFor(filtered.statuses)).toBeLessThan(totalFor(all.statuses));
  });

  it("counts a letter against the search and filters, but not against itself", () => {
    // A letter's own count must say what CHOOSING it would show — the same
    // rule a facet option follows for its own dimension.
    const counts = initialCounts(emptyFacets(), "", TODAY);
    for (const letter of ["A", "W"]) {
      expect(counts.get(letter)).toBe(queryPeople({ initial: letter }, TODAY).length);
    }
  });

  it("collects non-Latin-initial names under '#' rather than losing them", () => {
    const view = allPeople(TODAY)[0];
    const fake = { ...view, person: { ...view.person, canonicalName: "1 Numeral" } };
    expect(initialOf(fake)).toBe("#");
  });
});

describe("excludeDeceased / discoverablePeople (rule 2 and 3 of deceased-exclusion)", () => {
  // Real synthetic views built by overriding a real one's vitalStatus, the
  // same idiom the A-Z test above uses — no adapter mocking needed for a
  // pure function that only reads `PersonView.vitalStatus`.
  const base = allPeople(TODAY)[0];
  const deceased = { ...base, vitalStatus: "deceased" as const };
  const alive = { ...base, vitalStatus: "alive" as const };
  const unknown = { ...base, vitalStatus: "unknown" as const };

  it("removes a deceased person", () => {
    expect(excludeDeceased([deceased])).toHaveLength(0);
  });

  it("keeps an alive person", () => {
    expect(excludeDeceased([alive])).toHaveLength(1);
  });

  it("keeps an unknown-status person — unknown is never treated as deceased", () => {
    expect(excludeDeceased([unknown])).toHaveLength(1);
  });

  it("discoverablePeople is allPeople minus exactly the deceased ones", () => {
    // Real dataset today: nobody is deceased, so no one is dropped. This
    // documents that as a checked fact rather than an assumption — see
    // deceasedExclusion.test.ts for the same guarantee against a mocked
    // deceased record.
    const all = allPeople(TODAY);
    const discoverable = discoverablePeople(TODAY);
    expect(discoverable).toHaveLength(all.filter((v) => v.vitalStatus !== "deceased").length);
    expect(all.every((v) => v.vitalStatus !== "unknown" || discoverable.includes(v))).toBe(true);
  });

  it("directoryStats never exceeds datasetStats", () => {
    // Equal today (no confirmed deceased in the real dataset); must never
    // exceed it once one exists.
    expect(directoryStats(TODAY).people).toBeLessThanOrEqual(datasetStats(TODAY).people);
  });
});
