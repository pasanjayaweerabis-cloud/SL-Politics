import { describe, it, expect } from "vitest";
import {
  matchPerson, sameAward, disposeClaim, parseStructuredEntity, normaliseForMatch,
} from "./reconcileResearch.ts";
import type { ResearchClaim } from "./parseResearchFiles.ts";

const PEOPLE = [
  { id: "parliament:3449", canonicalName: "Harini Amarasuriya", aliases: ["Hon. Dr. Harini Amarasuriya, M.P."] },
  { id: "parliament:3535", canonicalName: "Ramanathan Archchuna", aliases: [] },
  { id: "parliament:3562", canonicalName: "Amila Prasad", aliases: [] },
];

const claim = (over: Partial<ResearchClaim> = {}): ResearchClaim => ({
  subjectName: "Someone", field: "university", value: "", citedSource: null,
  sourceUrl: null, tier: 3, selfReportedStatus: null,
  file: "f.txt", line: 1, rawText: "", ...over,
});

describe("matchPerson", () => {
  it("matches on the canonical name", () => {
    const m = matchPerson("Harini Amarasuriya", PEOPLE);
    expect(m).toMatchObject({ personId: "parliament:3449", confidence: "exact" });
  });

  it("matches through an honorific the file did not strip", () => {
    expect(matchPerson("Hon. Dr. Harini Amarasuriya, M.P.", PEOPLE).personId).toBe("parliament:3449");
  });

  it("matches a reordered name", () => {
    // The Gemini file lists "Archchuna Ramanathan" as a common name.
    const m = matchPerson("Archchuna Ramanathan", PEOPLE);
    expect(m.personId).toBe("parliament:3535");
    expect(m.confidence).toBe("strong");
  });

  it("treats a research name with EXTRA tokens as weak, not strong", () => {
    // "Amila Prasad Siriwardana" vs canonical "Amila Prasad". Usually the same
    // person under a fuller name — but it is also what a confusion between two
    // members of one family looks like, so it goes to review.
    const m = matchPerson("Amila Prasad Siriwardana", PEOPLE);
    expect(m.personId).toBe("parliament:3562");
    expect(m.confidence).toBe("weak");
  });

  it("never invents a person for an unknown name", () => {
    const m = matchPerson("Someone Not In Parliament", PEOPLE);
    expect(m.personId).toBeNull();
    expect(m.confidence).toBe("none");
  });

  it("normalises honorifics and punctuation", () => {
    expect(normaliseForMatch("Hon. (Dr.) Ramanathan Archchuna, M.P.")).toBe("ramanathan archchuna");
  });
});

describe("sameAward", () => {
  it("recognises a spelled-out award as the same one", () => {
    expect(sameAward("Bachelor of Science", "BSc")).toBe(true);
    expect(sameAward("Doctor of Philosophy", "PhD")).toBe(true);
    // Missing this pairing duplicated a doctor's medical degree: the research
    // file spells out what Parliament abbreviates.
    expect(sameAward("Bachelor of Medicine", "MBBS")).toBe(true);
  });

  it("ignores a parenthetical when comparing", () => {
    expect(sameAward("B.Sc (Eastern University)", "Bachelor of Science")).toBe(true);
  });

  it("does not conflate different awards", () => {
    expect(sameAward("MBBS", "MBA")).toBe(false);
    expect(sameAward("BA", "PhD")).toBe(false);
  });
});

describe("disposeClaim", () => {
  const canonical = [{ qualification: "MBBS", institution: null, sourceText: "MBBS" }];

  it("corroborates rather than duplicates when Parliament already says it", () => {
    const r = disposeClaim(
      claim({ field: "university", value: "He holds a Bachelor of Medicine." }),
      canonical,
    );
    expect(r.disposition).toBe("corroborates");
    expect(r.credentials).toEqual([]);
  });

  it("promotes a credential Parliament does not carry, capped at secondary", () => {
    const r = disposeClaim(
      claim({ field: "university", value: "He holds a Bachelor of Commerce.", tier: 3 }),
      canonical,
    );
    expect(r.disposition).toBe("promoted");
    expect(r.credentials.map((c) => c.award)).toContain("Bachelor of Commerce");
    expect(r.note).toMatch(/secondary-corroborated/);
  });

  it("rejects a claim with no affirmative content", () => {
    const r = disposeClaim(
      claim({ field: "university", value: "Not listed. (No official record of degrees.)" }),
      canonical,
    );
    expect(r.disposition).toBe("rejected");
  });

  it("does not promote political or electoral claims over an authoritative source", () => {
    for (const field of ["current-position", "election", "party-history", "timeline"] as const) {
      expect(disposeClaim(claim({ field, value: "Elected with 655,289 votes" }), []).disposition)
        .toBe("rejected");
    }
  });

  it("promotes a structured service record, which Parliament's panes do not carry", () => {
    const r = disposeClaim(claim({
      field: "public-service",
      value: "Organization: Women Parliamentarians' Caucus; Position: Chairperson; Start: 2024-12-03; End: CURRENT",
      tier: 1,
    }), []);
    expect(r.disposition).toBe("promoted");
    expect(r.entity).toMatchObject({ organisation: "Women Parliamentarians' Caucus", role: "Chairperson" });
  });

  it("refuses an employment claim that names no employer", () => {
    // Prose like "listed as a Teacher" names no employer, post or dates.
    const r = disposeClaim(claim({
      field: "employment",
      value: "Position: Teacher; Description: Broadly cited as a teaching professional.",
    }), []);
    expect(r.disposition).toBe("rejected");
  });
});

describe("parseStructuredEntity", () => {
  it("reads an entity row", () => {
    const e = parseStructuredEntity(
      "Organization: Open University of Sri Lanka; Position: Senior Lecturer; Start: 2011; End: 2020")!;
    expect(e).toMatchObject({
      organisation: "Open University of Sri Lanka",
      role: "Senior Lecturer", startDate: "2011", endDate: "2020",
    });
  });

  it("treats 'CURRENT' as no end date rather than a date", () => {
    const e = parseStructuredEntity("Organization: X; Position: Member; Start: 2020-01-03; End: CURRENT")!;
    expect(e.endDate).toBeNull();
  });

  it("returns null when no organisation is named", () => {
    expect(parseStructuredEntity("Position: Teacher; Description: Broadly cited.")).toBeNull();
  });
});
