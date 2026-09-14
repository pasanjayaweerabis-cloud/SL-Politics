import { describe, it, expect } from "vitest";
import { extractCredentials } from "./extractCredentials.ts";
import {
  tierFor, isNotVerified, parseChatGptResearch, parseGeminiResearch,
} from "./parseResearchFiles.ts";

/* ==========================================================================
   Credential extraction — the negation cases are the ones that matter
   ========================================================================== */

describe("extractCredentials — polarity", () => {
  /**
   * Each of these is a real sentence from the supplied research files. Every
   * one contains a genuine award token, and in every one the award is being
   * DENIED, hedged, or pointed at elsewhere. A regex that only looks for the
   * token puts a degree on a named person's public record that no source
   * claims they hold.
   */
  it("does not extract an award the sentence explicitly denies", () => {
    expect(extractCredentials(
      "No official confirmation of M.A. or other master's - aside from the Ph.D. claim above.",
    )).toEqual([]);
  });

  it("does not extract an award the sentence hedges as unconfirmed", () => {
    // The award and the disclaimer are in ONE sentence, split by "Ph.D." —
    // an abbreviation-blind sentence splitter separates them and the hedge
    // is lost.
    expect(extractCredentials(
      "Secondary sources report a B.A. (Hons) and a Ph.D. (Philosophy), but official confirmation is lacking.",
    )).toEqual([]);
  });

  it("does not extract from a cross-reference", () => {
    expect(extractCredentials("See above (BSc, two MSc).")).toEqual([]);
  });

  it("does not extract from an absence statement", () => {
    expect(extractCredentials("Not listed. (No official record of degrees.)")).toEqual([]);
  });

  it("still splits genuine sentence boundaries", () => {
    const r = extractCredentials("He studied at Royal College. He later earned an MBA.");
    expect(r.map((c) => c.award)).toEqual(["MBA"]);
  });
});

describe("extractCredentials — affirmative", () => {
  it("extracts awards and attaches an institution only when one is named", () => {
    const r = extractCredentials(
      "According to secondary sources, Athambawa earned a B.Sc. (Eastern University) and two MSc degrees, plus a PG Diploma in Education (Open University).",
    );
    const awards = r.map((c) => c.award);
    expect(awards).toContain("B.Sc (Eastern University)");
    expect(awards).toContain("MSc");
    expect(awards).toContain("PG Diploma");
    // "Diploma" must not appear as a separate record alongside "PG Diploma".
    expect(awards.filter((a) => a === "Diploma")).toEqual([]);
  });

  it("classifies a professional credential as professional, not academic", () => {
    const r = extractCredentials("Attorney-at-Law (qualified lawyer).");
    expect(r[0]!.level).toBe("professional");
  });

  it("keeps the source sentence for review", () => {
    const r = extractCredentials("He holds a Bachelor of Commerce.");
    expect(r[0]!.context).toBe("He holds a Bachelor of Commerce.");
  });
});

/* ==========================================================================
   Source tiering
   ========================================================================== */

describe("tierFor", () => {
  it("treats the official Parliament as Tier 1", () => {
    expect(tierFor("Parliament of Sri Lanka", "https://www.parliament.lk/en/x")).toBe(1);
  });

  it("does not let a news aggregator inherit an authority's tier", () => {
    // The Gemini file attributes vote counts to "Election Commission of Sri
    // Lanka / Ada Derana" while linking only Ada Derana. The strongest thing
    // actually evidenced is the newspaper.
    expect(tierFor("Election Commission of Sri Lanka / Ada Derana",
      "https://election.adaderana.lk/general-election-2024/district_result.php")).toBe(3);
  });

  it("treats an unevidenced Election Commission citation as Tier 2, not Tier 1", () => {
    expect(tierFor("Election Commission of Sri Lanka", null)).toBe(2);
  });

  it("treats Wikipedia and self-declared secondary corroboration as Tier 4", () => {
    expect(tierFor("Wikipedia / Election Commission", null)).toBe(4);
    expect(tierFor("Secondary Corroborated", null)).toBe(4);
  });

  it("defaults to the weakest tier when nothing is cited", () => {
    expect(tierFor(null, null)).toBe(4);
  });
});

describe("isNotVerified", () => {
  it("recognises the files' many ways of saying nothing was found", () => {
    for (const v of [
      "NOT PUBLICLY VERIFIED", "Not documented", "Not found", "Not provided",
      "None listed", "No data found", "N/A", "---",
    ]) expect(isNotVerified(v)).toBe(true);
  });

  it("does not swallow a real value", () => {
    expect(isNotVerified("Bishop's College, Colombo")).toBe(false);
  });
});

/* ==========================================================================
   File parsing
   ========================================================================== */

describe("parseChatGptResearch", () => {
  const FILE = `# Ajantha Gammeddage

**Identity:** Male MP from Matara District.

**Education:** He holds a Bachelor of Commerce. No school or A/L details.

**O/L:** Not documented publicly.

**Sources:** Parliament profile.

# Coverage Summary

- People researched: 10/10
`;

  it("attaches the block's trailing Sources paragraph to its claims", () => {
    const claims = parseChatGptResearch(FILE, "chatgpt.txt");
    const education = claims.find((c) => c.field === "school");
    expect(education!.citedSource).toBe("Parliament profile.");
    expect(education!.subjectName).toBe("Ajantha Gammeddage");
  });

  it("drops fields whose entire body is an absence statement", () => {
    const claims = parseChatGptResearch(FILE, "chatgpt.txt");
    expect(claims.some((c) => c.field === "ol")).toBe(false);
  });

  it("does not treat the coverage summary as a person", () => {
    const claims = parseChatGptResearch(FILE, "chatgpt.txt");
    expect(claims.every((c) => c.subjectName === "Ajantha Gammeddage")).toBe(true);
  });

  it("records file and line so a staged claim can be checked against the original", () => {
    const claims = parseChatGptResearch(FILE, "chatgpt.txt");
    const education = claims.find((c) => c.field === "school")!;
    expect(education.file).toBe("chatgpt.txt");
    expect(education.line).toBeGreaterThan(0);
    expect(education.rawText).toContain("Bachelor of Commerce");
  });
});

describe("parseGeminiResearch", () => {
  const FILE = `PERSON #69NAME
Official Name: Harini Amarasuriya
Tamil Name: NOT PUBLICLY VERIFIEDIDENTITY
Date of Birth: 1970-03-06
Place of Birth: Colombo, Sri LankaEDUCATIONSchool: Bishop's College, Colombo
Source: Secondary CorroboratedO/L:
Year: NOT PUBLICLY VERIFIEDELECTION HISTORYElection: 2024 Parliamentary Election
Date: 2024-11-14
Votes: 655,289 (Preferential Votes)
Source: Election Commission of Sri Lanka / Ada DeranaSOURCES
Institution: Parliament of Sri Lanka
URL: https://www.parliament.lk/en/members-of-parliament/mp-profile/3449
`;

  it("recovers section boundaries the file glues onto values", () => {
    const claims = parseGeminiResearch(FILE, "gemini.txt");
    expect(claims.some((c) => c.field === "school" && /Bishop/.test(c.value))).toBe(true);
    expect(claims.some((c) => c.field === "date-of-birth" && c.value === "1970-03-06")).toBe(true);
  });

  it("drops NOT PUBLICLY VERIFIED values rather than storing the phrase", () => {
    const claims = parseGeminiResearch(FILE, "gemini.txt");
    expect(claims.some((c) => /NOT PUBLICLY VERIFIED/i.test(c.value))).toBe(false);
  });

  it("preserves the file's own confidence label without upgrading it", () => {
    const claims = parseGeminiResearch(FILE, "gemini.txt");
    const school = claims.find((c) => c.field === "school")!;
    expect(school.citedSource).toMatch(/Secondary Corroborated/i);
    expect(school.tier).toBe(4);
  });

  it("tiers an election claim by what it links, not by what it names", () => {
    const claims = parseGeminiResearch(FILE, "gemini.txt");
    const election = claims.find((c) => c.field === "election")!;
    expect(election.tier).toBe(3);
  });
});
