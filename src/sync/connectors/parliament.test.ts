import { describe, it, expect } from "vitest";
import {
  splitCompoundRole,
  roleTypeForOffice,
  ministryFromTitle,
  canonicalNameFrom,
  honorificFrom,
  postNominalFrom,
  validateMemberRows,
  type ParliamentMemberRow,
} from "./parliament.ts";
import { RoleType } from "../../types/models.ts";

const row = (over: Partial<ParliamentMemberRow> = {}): ParliamentMemberRow => ({
  parliamentId: "3560",
  name: "Hon. (Prof.) A.H.M.H. Abayarathna, M.P.",
  profileUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/3560",
  portraitUrl: null,
  party: "Jathika Jana balawegaya",
  district: "Puttalam",
  role: null,
  dateOfBirth: "1965-09-19",
  profession: "Academician",
  ...over,
});

/**
 * Every compound case below is a verbatim role string that Parliament of Sri
 * Lanka's member directory actually published at the time of import. These
 * are regression pins: splitting them wrongly would invent public offices
 * that do not exist.
 */
describe("splitCompoundRole — real compound titles from the live directory", () => {
  it("splits a Prime Minister who also holds a portfolio", () => {
    expect(
      splitCompoundRole("Prime Minister and Minister of Education, Higher Education and Vocational Education"),
    ).toEqual(["Prime Minister", "Minister of Education, Higher Education and Vocational Education"]);
  });

  it("splits two separate ministries", () => {
    expect(splitCompoundRole("Minister of Ports and Civil Aviation and Minister of Energy")).toEqual([
      "Minister of Ports and Civil Aviation",
      "Minister of Energy",
    ]);
  });

  it("splits a cabinet post held alongside a deputy ministry", () => {
    expect(splitCompoundRole("Minister of Labour and Deputy Minister of Finance and Planning")).toEqual([
      "Minister of Labour",
      "Deputy Minister of Finance and Planning",
    ]);
  });

  it("splits a ministry held alongside a parliamentary office", () => {
    expect(splitCompoundRole("Minister of Health and Mass Media and Chief Government Whip")).toEqual([
      "Minister of Health and Mass Media",
      "Chief Government Whip",
    ]);
    expect(
      splitCompoundRole("Minister of Transport, Highways and Urban Development and Leader of the House of Parliament"),
    ).toEqual([
      "Minister of Transport, Highways and Urban Development",
      "Leader of the House of Parliament",
    ]);
  });
});

describe("splitCompoundRole — must NOT split", () => {
  it("keeps 'and' that is part of a ministry name", () => {
    expect(splitCompoundRole("Minister of Agriculture, Livestock, Land and Irrigation")).toEqual([
      "Minister of Agriculture, Livestock, Land and Irrigation",
    ]);
    expect(splitCompoundRole("Deputy Minister of Education and Higher Education")).toEqual([
      "Deputy Minister of Education and Higher Education",
    ]);
    expect(splitCompoundRole("Minister of Trade, Commerce, Food Security and Cooperative Development")).toEqual([
      "Minister of Trade, Commerce, Food Security and Cooperative Development",
    ]);
  });

  it("keeps a compound official title that names one office", () => {
    // The Deputy Speaker *is* the Chair of Committees; this is one office.
    expect(splitCompoundRole("Deputy Speaker and the Chair of Committees")).toEqual([
      "Deputy Speaker and the Chair of Committees",
    ]);
  });

  it("returns an empty list for a member holding no additional office", () => {
    expect(splitCompoundRole(null)).toEqual([]);
    expect(splitCompoundRole("")).toEqual([]);
    expect(splitCompoundRole("   ")).toEqual([]);
  });
});

describe("roleTypeForOffice", () => {
  it("distinguishes cabinet, state and deputy ministers", () => {
    expect(roleTypeForOffice("Minister of Energy")).toBe(RoleType.CABINET_MINISTER);
    expect(roleTypeForOffice("State Minister of Finance")).toBe(RoleType.STATE_MINISTER);
    expect(roleTypeForOffice("Deputy Minister of Environment")).toBe(RoleType.DEPUTY_MINISTER);
  });

  it("never reads a deputy ministry as a cabinet post", () => {
    // The ordering bug this pins: "Deputy Minister of X" contains "Minister of X".
    expect(roleTypeForOffice("Deputy Minister of Finance and Planning")).not.toBe(RoleType.CABINET_MINISTER);
  });

  it("classifies the presiding and leadership offices", () => {
    expect(roleTypeForOffice("Speaker")).toBe(RoleType.SPEAKER);
    expect(roleTypeForOffice("Deputy Speaker and the Chair of Committees")).toBe(RoleType.DEPUTY_SPEAKER);
    expect(roleTypeForOffice("Prime Minister")).toBe(RoleType.PRIME_MINISTER);
    expect(roleTypeForOffice("Leader of the Opposition in Parliament")).toBe(RoleType.OPPOSITION_LEADER);
  });

  it("classifies parliamentary offices distinctly rather than as 'other'", () => {
    expect(roleTypeForOffice("Chief Government Whip")).toBe(RoleType.PARLIAMENTARY_OFFICE);
    expect(roleTypeForOffice("Leader of the House of Parliament")).toBe(RoleType.PARLIAMENTARY_OFFICE);
    expect(roleTypeForOffice("Deputy Chairperson of Committees")).toBe(RoleType.PARLIAMENTARY_OFFICE);
  });
});

describe("ministryFromTitle", () => {
  it("extracts the portfolio from ministerial titles", () => {
    expect(ministryFromTitle("Minister of Energy")).toBe("Energy");
    expect(ministryFromTitle("Deputy Minister of Education and Higher Education")).toBe("Education and Higher Education");
  });

  it("is null for offices that are not ministries", () => {
    expect(ministryFromTitle("Speaker")).toBeNull();
    expect(ministryFromTitle("Chief Government Whip")).toBeNull();
    expect(ministryFromTitle("Member of Parliament")).toBeNull();
  });
});

describe("canonicalNameFrom", () => {
  it("strips the honorific prefix and the M.P. suffix Parliament adds to every row", () => {
    expect(canonicalNameFrom("Hon. (Prof.) A.H.M.H. Abayarathna, M.P.")).toBe("A.H.M.H. Abayarathna");
    expect(canonicalNameFrom("Hon. Aboobucker Athambawa, M.P.")).toBe("Aboobucker Athambawa");
    expect(canonicalNameFrom("Hon. (Mrs.) A.M.M.M. Rathwaththe, M.P.")).toBe("A.M.M.M. Rathwaththe");
  });

  it("leaves an already-clean name untouched", () => {
    expect(canonicalNameFrom("Anura Kumara Dissanayake")).toBe("Anura Kumara Dissanayake");
  });

  it("captures the honorific separately rather than discarding it", () => {
    expect(honorificFrom("Hon. (Prof.) A.H.M.H. Abayarathna, M.P.")).toBe("Prof.");
    expect(honorificFrom("Hon. Aboobucker Athambawa, M.P.")).toBeNull();
  });

  it("strips professional post-nominals, which 26 live rows carry", () => {
    expect(canonicalNameFrom("Hon. Rauff Hakeem, Attorney at Law, M.P.")).toBe("Rauff Hakeem");
    expect(canonicalNameFrom("Hon. Faiszer Musthapha, PC, M.P.")).toBe("Faiszer Musthapha");
    expect(canonicalNameFrom("Hon. (Mrs.) Hiruni Wijesinghe, Attorney at Law, M.P.")).toBe("Hiruni Wijesinghe");
  });

  it("captures the post-nominal separately", () => {
    expect(postNominalFrom("Hon. Rauff Hakeem, Attorney at Law, M.P.")).toBe("Attorney at Law");
    expect(postNominalFrom("Hon. Faiszer Musthapha, PC, M.P.")).toBe("PC");
    expect(postNominalFrom("Hon. Aboobucker Athambawa, M.P.")).toBeNull();
  });

  it("strips STACKED honorifics", () => {
    // Verbatim from the live directory — two honorifics, no separator.
    expect(canonicalNameFrom("Hon. (Dr.)(Ms.) Kaushalya Ariyarathne, M.P.")).toBe("Kaushalya Ariyarathne");
  });

  it("strips honorifics the source writes WITHOUT parentheses", () => {
    // All three forms appear in the live directory. Missing the bare form
    // put "Dr." inside the canonical name and the URL slug.
    expect(canonicalNameFrom("Hon. Dr. Harini Amarasuriya, M.P.")).toBe("Harini Amarasuriya");
    expect(canonicalNameFrom("Hon. Major General (Rtd.) Aruna Jayasekera, M.P.")).toBe("Aruna Jayasekera");
    expect(canonicalNameFrom("Hon. Major General (Rtd.) G.D. Sooriyabandara, M.P.")).toBe("G.D. Sooriyabandara");
  });

  it("normalises the irregular whitespace present in the live data", () => {
    // Both of these appear verbatim in the directory.
    expect(canonicalNameFrom("Hon. Priyantha Wijerathna , Attorney at Law, M.P.")).toBe("Priyantha Wijerathna");
    expect(canonicalNameFrom("Hon. (Mrs.) Sagarika Athauda,  Attorney at Law, M.P.")).toBe("Sagarika Athauda");
  });
});

describe("validateMemberRows", () => {
  it("accepts a well-formed row", () => {
    expect(validateMemberRows([row()])).toEqual({ ok: true, problems: [] });
  });

  it("rejects a row with no Parliament member id — identity cannot be resolved safely", () => {
    const result = validateMemberRows([row({ parliamentId: "" })]);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.code === "missing-external-id")).toBe(true);
  });

  it("rejects a duplicate member id", () => {
    const result = validateMemberRows([row(), row({ name: "Someone Else" })]);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.code === "duplicate-external-id")).toBe(true);
  });

  it("flags a party disagreement between the listing and the profile page", () => {
    const result = validateMemberRows([row({ partyOnProfile: "Samagi Jana Balawegaya (SJB)" })]);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.code === "party-conflict")).toBe(true);
  });

  it("treats a missing party as a warning, not a hard failure", () => {
    const result = validateMemberRows([row({ party: null })]);
    expect(result.ok).toBe(true);
    expect(result.problems.some((p) => p.code === "missing-party")).toBe(true);
  });

  it("flags a date of birth that is not day-precision ISO", () => {
    const result = validateMemberRows([row({ dateOfBirth: "19-09-1965" })]);
    expect(result.problems.some((p) => p.code === "unparsable-dob")).toBe(true);
  });
});
