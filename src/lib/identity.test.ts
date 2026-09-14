import { describe, it, expect } from "vitest";
import {
  normaliseName,
  initialsKey,
  initialsOf,
  nameKeys,
  resolveIdentity,
  buildSearchIndex,
  matchesQuery,
  type IdentityCandidate,
} from "./identity.ts";

describe("normaliseName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normaliseName("  Anura   Kumara  Dissanayake ")).toBe("anura kumara dissanayake");
  });

  it("treats punctuation as a separator so initials forms agree", () => {
    expect(normaliseName("A.K.D. Dissanayake")).toBe("a k d dissanayake");
    expect(normaliseName("A K D Dissanayake")).toBe("a k d dissanayake");
  });

  it("strips leading honorifics", () => {
    expect(normaliseName("Hon. Sajith Premadasa")).toBe("sajith premadasa");
    expect(normaliseName("Dr Harini Amarasuriya")).toBe("harini amarasuriya");
  });

  it("strips Latin diacritics", () => {
    expect(normaliseName("José")).toBe("jose");
  });

  it("preserves Sinhala and Tamil script rather than stripping it", () => {
    expect(normaliseName("අනුර කුමාර")).toBe("අනුර කුමාර");
    expect(normaliseName("அநுர குமார")).toBe("அநுர குமார");
  });

  it("handles empty and missing input", () => {
    expect(normaliseName(null)).toBe("");
    expect(normaliseName("")).toBe("");
  });

  /*
   * L-1 (docs/security-audit-followup-2026-09-04.md): server/api/queries.ts
   * builds a SQL `LIKE` pattern from every normalised term, so `%` and `_`
   * reaching this function unstripped become live LIKE wildcards rather than
   * literal characters — `?q=%` reached SQL as `LIKE '%%'`, matching every
   * row. No real name contains either character, so stripping them here is
   * loss-free for legitimate input.
   */
  it("strips SQL LIKE wildcard characters (%, _) rather than passing them through", () => {
    expect(normaliseName("%")).toBe("");
    expect(normaliseName("_")).toBe("");
    expect(normaliseName("100%")).toBe("100");
    expect(normaliseName("a_b%c")).toBe("a b c");
    expect(normaliseName("%wickremesinghe%")).toBe("wickremesinghe");
  });
});

describe("initials", () => {
  it("builds an initials key", () => {
    expect(initialsKey("Anura Kumara Dissanayake")).toBe("akd");
  });

  it("builds a monogram from first and last name", () => {
    expect(initialsOf("Anura Kumara Dissanayake")).toBe("AD");
    expect(initialsOf("Cher")).toBe("CH");
    expect(initialsOf("")).toBe("—");
  });
});

describe("nameKeys", () => {
  it("indexes canonical name, script variants, aliases and initials", () => {
    const keys = nameKeys({
      canonicalName: "Anura Kumara Dissanayake",
      names: { en: "Anura Kumara Dissanayake", si: "අනුර කුමාර දිසානායක", ta: null },
      aliases: ["AKD"],
    });
    expect(keys).toContain("anura kumara dissanayake");
    expect(keys).toContain("අනුර කුමාර දිසානායක");
    expect(keys).toContain("akd");
  });

  it("does not emit empty keys for absent script variants", () => {
    const keys = nameKeys({ canonicalName: "Test Person", names: { en: "Test Person", si: null, ta: null } });
    expect(keys.every((k) => k.length > 0)).toBe(true);
  });
});

describe("resolveIdentity", () => {
  const candidates: IdentityCandidate[] = [
    {
      id: "anura-kumara-dissanayake",
      canonicalName: "Anura Kumara Dissanayake",
      aliases: ["AKD"],
      externalIds: { parliament: "MP-1234" },
      dateOfBirth: "1968-11-24",
    },
    {
      id: "sajith-premadasa",
      canonicalName: "Sajith Premadasa",
      externalIds: { parliament: "MP-5678" },
      dateOfBirth: "1967-01-12",
    },
  ];

  it("merges automatically on an exact external ID match", () => {
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "A. K. Dissanayake", externalIds: { parliament: "MP-1234" } },
      candidates,
    );
    expect(match).toMatchObject({
      personId: "anura-kumara-dissanayake",
      confidence: "exact",
      autoMergeable: true,
    });
  });

  it("does NOT auto-merge on a name match alone", () => {
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "Anura Kumara Dissanayake" },
      candidates,
    );
    expect(match.personId).toBe("anura-kumara-dissanayake");
    expect(match.confidence).toBe("uncertain");
    expect(match.autoMergeable).toBe(false);
  });

  it("raises confidence to probable when the birth date corroborates", () => {
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "Anura Kumara Dissanayake", dateOfBirth: "1968-11-24" },
      candidates,
    );
    expect(match.confidence).toBe("probable");
    expect(match.autoMergeable).toBe(false);
  });

  it("flags a conflict when the same name carries a different birth date", () => {
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "Anura Kumara Dissanayake", dateOfBirth: "1975-01-01" },
      candidates,
    );
    expect(match.confidence).toBe("uncertain");
    expect(match.signals).toContain("dateOfBirth:conflict");
    expect(match.autoMergeable).toBe(false);
  });

  it("matches an alias but still requires review", () => {
    const match = resolveIdentity({ id: "incoming", canonicalName: "AKD" }, candidates);
    expect(match.personId).toBe("anura-kumara-dissanayake");
    expect(match.autoMergeable).toBe(false);
  });

  it("returns no match for an unknown person", () => {
    const match = resolveIdentity({ id: "incoming", canonicalName: "Someone Entirely Else" }, candidates);
    expect(match).toEqual({ personId: null, confidence: "none", signals: [], autoMergeable: false });
  });

  it("never auto-merges different people who share an external-ID key from different sources", () => {
    // Same ID string, but recorded under a different source key.
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "Unrelated", externalIds: { electionCommission: "MP-1234" } },
      candidates,
    );
    expect(match.autoMergeable).toBe(false);
  });
});

describe("search", () => {
  const index = buildSearchIndex([
    "Anura Kumara Dissanayake",
    "AKD",
    "අනුර කුමාර දිසානායක",
    "National People's Power",
    "President of Sri Lanka",
  ]);

  it("matches an exact name", () => {
    expect(matchesQuery(index, "Anura Kumara Dissanayake")).toBe(true);
  });

  it("matches regardless of case and punctuation", () => {
    expect(matchesQuery(index, "ANURA")).toBe(true);
    expect(matchesQuery(index, "a.k.d.")).toBe(true);
  });

  it("matches a partial name", () => {
    expect(matchesQuery(index, "dissanayake")).toBe(true);
  });

  it("matches an alias", () => {
    expect(matchesQuery(index, "AKD")).toBe(true);
  });

  it("matches Sinhala script", () => {
    expect(matchesQuery(index, "අනුර")).toBe(true);
  });

  it("matches on party and office text", () => {
    expect(matchesQuery(index, "president")).toBe(true);
    expect(matchesQuery(index, "national people")).toBe(true);
  });

  it("narrows rather than widens as terms are added", () => {
    expect(matchesQuery(index, "anura president")).toBe(true);
    expect(matchesQuery(index, "anura chef")).toBe(false);
  });

  it("matches a name prefix", () => {
    expect(matchesQuery(index, "wick")).toBe(false);
    expect(matchesQuery(index, "dissan")).toBe(true);
  });

  it("REGRESSION: single-letter terms must not match every record", () => {
    // "A.K.D." normalises to the terms a/k/d. Under substring matching those
    // appeared in almost every index and the search returned the whole
    // dataset. Token-prefix matching requires a token starting with each.
    const unrelated = buildSearchIndex(["Sajith Premadasa", "Samagi Jana Balawegaya"]);
    expect(matchesQuery(unrelated, "a.k.d.")).toBe(false);
    expect(matchesQuery(index, "a.k.d.")).toBe(true);
  });

  it("does not match a term that only appears mid-token", () => {
    // "resident" is inside "President" but is not how anyone searches.
    expect(matchesQuery(index, "resident")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesQuery(index, "")).toBe(true);
    expect(matchesQuery(index, "   ")).toBe(true);
  });
});
