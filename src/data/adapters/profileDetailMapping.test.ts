import { describe, it, expect } from "vitest";
import {
  educationFromAcademicEntry,
  educationFromProfessionalEntry,
  institutionIn,
  topLevelCommaIndex,
  positionsFromTerms,
  positionsFromServices,
  parliamentOrdinal,
} from "./profileDetailMapping.ts";
import { RoleType } from "../../types/models.ts";

describe("educationFromAcademicEntry — awards", () => {
  it("keeps the award verbatim and does not invent an institution", () => {
    const row = educationFromAcademicEntry("BA (Hons) Sociology")!;
    expect(row.qualification).toBe("BA (Hons) Sociology");
    expect(row.institution).toBeNull();
    expect(row.educationType).toBe("university");
  });

  it("splits a field only on a comma outside parentheses", () => {
    // "PHD, Social Anthropology" — unambiguous.
    const phd = educationFromAcademicEntry("PHD, Social Anthropology")!;
    expect(phd.qualification).toBe("PHD");
    expect(phd.field).toBe("Social Anthropology");

    // "MSc Project Management (Cardiff, UK)" — the comma is INSIDE a
    // parenthetical. Splitting there produced the award "MSc Project
    // Management (Cardiff" with a field of "UK)": a mangled degree and an
    // invented subject.
    const msc = educationFromAcademicEntry("MSc Project Management (Cardiff, UK)")!;
    expect(msc.qualification).toBe("MSc Project Management (Cardiff, UK)");
    expect(msc.field).toBeNull();
  });

  it("records MBBS as a bachelor's degree", () => {
    expect(educationFromAcademicEntry("MBBS")!.educationType).toBe("university");
  });

  it("rejects the site's boilerplate notice", () => {
    expect(educationFromAcademicEntry(
      "Please Note Academic and Professional Qualifications of Hon. Members elected to Parliament are included in the website only in the language they provided in Information Forms.",
    )).toBeNull();
  });
});

describe("educationFromAcademicEntry — examinations", () => {
  it("records the qualification, never a grade", () => {
    const row = educationFromAcademicEntry("G.C.E. (A/L)")!;
    expect(row.examLevel).toBe("al");
    expect(row.qualification).toBe("G.C.E. Advanced Level");
    expect(row.educationType).toBe("school");
    // There is no grade field on an education row at all, by design.
    expect(row).not.toHaveProperty("grade");
  });

  it("reads the several ways the source writes each level", () => {
    expect(educationFromAcademicEntry("G.C.E.O/L")!.examLevel).toBe("ol");
    expect(educationFromAcademicEntry("Advanced Level")!.examLevel).toBe("al");
    expect(educationFromAcademicEntry("Passed GCE Advanced Level.")!.examLevel).toBe("al");
    expect(educationFromAcademicEntry("G.C.E. A/L")!.examLevel).toBe("al");
  });

  it("keeps a stream the source stated, and invents none otherwise", () => {
    expect(educationFromAcademicEntry("GCE A/L (Commerce)")!.stream).toBe("Commerce");
    expect(educationFromAcademicEntry("G.C.E. (A/L)")!.stream).toBeNull();
  });

  it("does not classify a degree as an examination", () => {
    // "LLB [Reading] The Open University of Sri Lanka, G.C.E (A/L) 2003 ..."
    // mentions A/L but records a degree.
    const row = educationFromAcademicEntry("LLB [Reading] The Open University of Sri Lanka")!;
    expect(row.examLevel).toBeNull();
  });
});

describe("institutionIn", () => {
  it("takes an institution the source actually names", () => {
    expect(institutionIn("Bachelor of Science (Eastern University of Sri Lanka)"))
      .toBe("Eastern University of Sri Lanka");
  });

  it("does not treat a place name as an institution", () => {
    // "(Cardiff, UK)" is where, not who awarded it.
    expect(institutionIn("MSc Project Management (Cardiff, UK)")).toBeNull();
  });
});

describe("topLevelCommaIndex", () => {
  it("ignores commas inside parentheses", () => {
    expect(topLevelCommaIndex("MSc Project Management (Cardiff, UK)")).toBe(-1);
    expect(topLevelCommaIndex("PHD, Social Anthropology")).toBe(3);
  });
});

describe("educationFromProfessionalEntry", () => {
  it("keeps a credential", () => {
    expect(educationFromProfessionalEntry("Attorney at Law")!.educationType).toBe("professional");
  });

  it("drops an occupation filed under the same heading", () => {
    // Parliament files both under "Professional Qualifications". Recording the
    // job would show "University Lecturer" where a credential belongs.
    expect(educationFromProfessionalEntry("University Lecturer")).toBeNull();
    expect(educationFromProfessionalEntry("DOCTOR")).toBeNull();
    expect(educationFromProfessionalEntry("Full Time Politics")).toBeNull();
  });
});

describe("positionsFromTerms", () => {
  const TERMS = [
    { parliament: "Tenth Parliament of the D.S.R. of Sri Lanka", startDate: "2024-11-15", endDate: null, ongoing: true },
    { parliament: "Ninth Parliament of the D.S.R. of Sri Lanka", startDate: "2020-08-14", endDate: "2024-09-24", ongoing: false },
  ];

  it("creates one position per term with the source's own dates", () => {
    const rows = positionsFromTerms(TERMS, "colombo", 40);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.startDate).toBe("2024-11-15");
    expect(rows[1]!.endDate).toBe("2024-09-24");
  });

  it("does not set the dated-observation fallback when a real start date exists", () => {
    // Carrying both would give one position two competing accounts of when it
    // began, which is the contradiction the model exists to prevent.
    for (const row of positionsFromTerms(TERMS, "colombo", 40)) {
      expect(row.currentAsOf).toBeNull();
    }
  });

  it("attributes the current district only to the current term", () => {
    // The source does not say which district an earlier term represented.
    const rows = positionsFromTerms(TERMS, "colombo", 40);
    expect(rows[0]!.districtId).toBe("colombo");
    expect(rows[1]!.districtId).toBeNull();
  });
});

describe("positionsFromServices", () => {
  const split = (t: string | null) => (t ? t.split(" and Minister of ").map((x, i) => i ? `Minister of ${x}` : x) : []);
  const roleType = (t: string) => t.startsWith("Minister of") ? RoleType.CABINET_MINISTER : RoleType.PRIME_MINISTER;
  const ministry = (t: string) => t.replace(/^Minister of /, "") || null;
  const precedence = () => 10;

  it("splits a compound office into one position each, sharing the dates", () => {
    const rows = positionsFromServices(
      [{ title: "Prime Minister and Minister of Education", startDate: "2024-11-18", endDate: null, ongoing: true }],
      split, roleType, ministry, precedence,
    );
    expect(rows.map((r) => r.title)).toEqual(["Prime Minister", "Minister of Education"]);
    expect(rows.every((r) => r.startDate === "2024-11-18")).toBe(true);
  });

  it("keeps a closed range closed", () => {
    const rows = positionsFromServices(
      [{ title: "Minister of Housing", startDate: "2015-09-04", endDate: "2018-10-26", ongoing: false }],
      split, roleType, ministry, precedence,
    );
    expect(rows[0]!.endDate).toBe("2018-10-26");
  });
});

describe("parliamentOrdinal", () => {
  it("reads the ordinal Parliament names its terms by", () => {
    expect(parliamentOrdinal("Tenth Parliament of the D.S.R. of Sri Lanka")).toBe(10);
    expect(parliamentOrdinal("Ninth Parliament of the D.S.R. of Sri Lanka")).toBe(9);
  });

  it("returns null rather than guessing at an unknown name", () => {
    expect(parliamentOrdinal("Constituent Assembly")).toBeNull();
  });
});
