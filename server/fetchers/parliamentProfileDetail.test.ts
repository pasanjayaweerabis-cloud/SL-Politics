import { describe, it, expect } from "vitest";
import {
  extractPane,
  splitTrailingDates,
  parseQualifications,
  parseLegislativeHistory,
  parsePortfoliosHeld,
  parseMinisterialServices,
  classifyEducationLevel,
  looksLikeCredential,
  isAbsentMarker,
  splitEntries,
  repairMojibake,
} from "./parliamentProfileDetail.ts";

/**
 * Fixtures are trimmed copies of real parliament.lk markup, single quotes and
 * all. The single-quoting is not incidental: a double-quote-only pattern
 * matches nothing on this source and the failure is indistinguishable from
 * "the source publishes nothing", which is how the education data went
 * unnoticed in the first place.
 */

const QUALIFICATIONS_PANE = `
<div id='v-pills-qualifications' class='tab-pane fade' role='tabpanel'>
  <div class='mb-3 scroll_div'>
    <ul class='custom_ul'>
      <li><b>Academic Qualifications</b></li>
      <ul class='custom_ul'>
        <li>BA (Hons) Sociology;</li>
        <li>MA App. Anthropology &amp; Development Studies;</li>
        <li>PHD, Social Anthropology</li>
      </ul>
    </ul>
    <ul class='custom_ul'>
      <li><b>Professional Qualifications</b></li>
      <ul class='custom_ul'>
        <li>University Lecturer</li>
      </ul>
    </ul>
  </div>
</div>
<div id='v-pills-legislative_history' class='tab-pane fade' role='tabpanel'>
  <div class='mb-3 scroll_div'>
    <ul class='custom_ul'>
      <li>Tenth Parliament  of the D.S.R. of Sri Lanka (2024-11-15 - to date)</li>
      <li>Ninth Parliament  of the D.S.R. of Sri Lanka (2020-08-14 - 2024-09-24)</li>
    </ul>
  </div>
</div>`;

// The nav button carries the same id prefix and appears BEFORE the pane.
const WITH_NAV_BUTTON = `
<a class='nav-link' id='v-pills-qualifications-tab' href='#v-pills-qualifications'>Qualifications</a>
${QUALIFICATIONS_PANE}`;

describe("extractPane", () => {
  it("finds the pane, not the nav button with the same id prefix", () => {
    const pane = extractPane(WITH_NAV_BUTTON, "v-pills-qualifications");
    expect(pane).toContain("Academic Qualifications");
    expect(pane).not.toContain("nav-link");
  });

  it("stops at the next pane rather than swallowing it", () => {
    const pane = extractPane(QUALIFICATIONS_PANE, "v-pills-qualifications")!;
    expect(pane).toContain("BA (Hons) Sociology");
    expect(pane).not.toContain("Tenth Parliament");
  });

  it("returns null for a pane the member does not have", () => {
    expect(extractPane(QUALIFICATIONS_PANE, "v-pills-services")).toBeNull();
  });
});

describe("splitTrailingDates", () => {
  it("reads an open-ended range as ongoing with no end date", () => {
    expect(splitTrailingDates("Minister of Justice (2024-11-18 - to date)")).toEqual({
      title: "Minister of Justice", startDate: "2024-11-18", endDate: null, ongoing: true,
    });
  });

  it("reads a closed range", () => {
    expect(splitTrailingDates("Deputy Minister of Health (2001-12-12 - 2004-02-11)")).toEqual({
      title: "Deputy Minister of Health", startDate: "2001-12-12", endDate: "2004-02-11", ongoing: false,
    });
  });

  it("reads a start-only date without inventing an end", () => {
    const r = splitTrailingDates("Prime Minister (2024-11-18)");
    expect(r.startDate).toBe("2024-11-18");
    expect(r.endDate).toBeNull();
    expect(r.ongoing).toBe(false);
  });

  it("leaves a non-date parenthetical attached to the title", () => {
    // "(UOC)" names an institution; stripping it would lose part of the title.
    const r = splitTrailingDates("MSc Medical Administration (UOC)");
    expect(r.title).toBe("MSc Medical Administration (UOC)");
    expect(r.startDate).toBeNull();
  });
});

describe("parseQualifications", () => {
  it("separates academic from professional entries", () => {
    const q = parseQualifications(WITH_NAV_BUTTON);
    expect(q.academic).toEqual([
      "BA (Hons) Sociology",
      "MA App. Anthropology & Development Studies",
      "PHD, Social Anthropology",
    ]);
    expect(q.professional).toEqual(["University Lecturer"]);
  });

  it("splits several credentials packed into one list item", () => {
    // Real markup for Dr. Ramanathan Archchuna.
    const html = `<div id='v-pills-qualifications' class='tab-pane'>
      <ul class='custom_ul'><li><b>Academic Qualifications</b></li>
      <ul class='custom_ul'><li>MBBS; MSc Project Management (Cardiff, UK); MSc Medical Administration (UOC); CHRM</li></ul>
      </ul></div>`;
    expect(parseQualifications(html).academic).toEqual([
      "MBBS", "MSc Project Management (Cardiff, UK)", "MSc Medical Administration (UOC)", "CHRM",
    ]);
  });

  it("drops the source's own absent-markers instead of storing them as data", () => {
    const html = `<div id='v-pills-qualifications' class='tab-pane'>
      <ul class='custom_ul'><li><b>Professional Qualifications</b></li>
      <ul class='custom_ul'><li>Not Provided</li></ul></ul></div>`;
    expect(parseQualifications(html).professional).toEqual([]);
  });

  it("returns empty lists, not null, when the pane is absent", () => {
    expect(parseQualifications("<div></div>")).toEqual({ academic: [], professional: [] });
  });
});

describe("parseLegislativeHistory", () => {
  it("reads each parliament with that member's own service dates", () => {
    const terms = parseLegislativeHistory(QUALIFICATIONS_PANE);
    expect(terms).toHaveLength(2);
    expect(terms[0]).toEqual({
      parliament: "Tenth Parliament of the D.S.R. of Sri Lanka",
      startDate: "2024-11-15", endDate: null, ongoing: true,
    });
    expect(terms[1]!.endDate).toBe("2024-09-24");
  });
});

describe("parsePortfoliosHeld", () => {
  const PANE = `<div id='v-pills-roles' class='tab-pane'>
    <ul class='custom_ul'>
      <li><b>Tenth Parliament of the D.S.R. of Sri Lanka</b></li>
      <ul class='custom_ul'><li>Leader of the Opposition in Parliament (2024-11-21)</li></ul>
    </ul>
    <ul class='custom_ul'>
      <li><b>Ninth Parliament of the D.S.R. of Sri Lanka</b></li>
      <ul class='custom_ul'><li>Leader of the Opposition in Parliament (2020-08-20)</li></ul>
    </ul>
  </div>`;

  it("keeps each office tied to the parliament it was held in", () => {
    const rows = parsePortfoliosHeld(PANE);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.parliament).toContain("Tenth");
    expect(rows[0]!.startDate).toBe("2024-11-21");
    expect(rows[1]!.parliament).toContain("Ninth");
    expect(rows[1]!.startDate).toBe("2020-08-20");
  });
});

describe("parseMinisterialServices", () => {
  it("reads start and end dates, marking open ranges ongoing", () => {
    const pane = `<div id='v-pills-services' class='tab-pane'><ul class='custom_ul'>
      <li>Minister of Housing and Construction (2015-09-04 - 2018-10-26)</li>
      <li>Leader of the Opposition in Parliament (2024-11-21 - to date)</li>
    </ul></div>`;
    const rows = parseMinisterialServices(pane);
    expect(rows[0]).toEqual({
      title: "Minister of Housing and Construction",
      startDate: "2015-09-04", endDate: "2018-10-26", ongoing: false,
    });
    expect(rows[1]!.ongoing).toBe(true);
    expect(rows[1]!.endDate).toBeNull();
  });
});

describe("classifyEducationLevel", () => {
  it("classifies MBBS as a bachelor's degree, not a postgraduate one", () => {
    // The trap: MBBS starts with M. A substring rule would promote every
    // doctor's basic medical degree to a master's on their public record.
    expect(classifyEducationLevel("MBBS")).toBe("university");
  });

  it("classifies common awards", () => {
    expect(classifyEducationLevel("BA (Hons) Sociology")).toBe("university");
    expect(classifyEducationLevel("PHD, Social Anthropology")).toBe("postgraduate");
    expect(classifyEducationLevel("MSc Project Management (Cardiff, UK)")).toBe("postgraduate");
    expect(classifyEducationLevel("LLB")).toBe("university");
    expect(classifyEducationLevel("Attorney-at-Law")).toBe("professional");
  });

  it("returns 'other' for an unrecognised award rather than guessing", () => {
    expect(classifyEducationLevel("CHRM")).toBe("other");
  });
});

describe("looksLikeCredential", () => {
  it("treats a job title as an occupation, not a qualification", () => {
    // Parliament files both under one "Professional Qualifications" heading.
    expect(looksLikeCredential("University Lecturer")).toBe(false);
    expect(looksLikeCredential("DOCTOR")).toBe(false);
    expect(looksLikeCredential("Businessman")).toBe(false);
  });

  it("recognises real credentials", () => {
    expect(looksLikeCredential("Attorney-at-Law")).toBe(true);
    expect(looksLikeCredential("Chartered Accountant")).toBe(true);
    expect(looksLikeCredential("Postgraduate Diploma in Education")).toBe(true);
  });
});

describe("isAbsentMarker", () => {
  it("recognises the source's ways of writing nothing", () => {
    for (const v of ["Not Provided", "N/A", "None", "---", "—"]) {
      expect(isAbsentMarker(v)).toBe(true);
    }
    expect(isAbsentMarker("MBBS")).toBe(false);
  });
});

describe("splitEntries", () => {
  it("splits on semicolons between entries", () => {
    expect(splitEntries("MBBS; MSc Medical Administration").map((s) => s.trim()))
      .toEqual(["MBBS", "MSc Medical Administration"]);
  });

  it("does not split on a semicolon inside parentheses", () => {
    // "Fellow Chartered Accountant (the Institute of ...; ...)" — splitting
    // here tears a credential's parenthetical away and fuses the fragments
    // with the next credential.
    const parts = splitEntries("Fellow CA (Institute of X; Y); Fellow CMA (Institute of Z)");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("Institute of X; Y");
  });

  it("splits on the Wingdings bullet the source pastes in", () => {
    // One member's five degrees arrive as a single list item separated by
    // U+F0A7, which also shows up double-encoded as "ï‚§".
    const parts = splitEntries("\uF0A7 Doctoral degree \uF0A7 MBA (Finance) \uF0A7 Bachelor of Commerce")
      .map((s) => s.trim()).filter(Boolean);
    expect(parts).toEqual(["Doctoral degree", "MBA (Finance)", "Bachelor of Commerce"]);
  });

  it("splits on the double-encoded form of that bullet too", () => {
    const parts = splitEntries("ï‚§ Doctoral degree ï‚§ Bachelor of Commerce")
      .map((s) => s.trim()).filter(Boolean);
    expect(parts).toEqual(["Doctoral degree", "Bachelor of Commerce"]);
  });
});

describe("repairMojibake", () => {
  it("repairs double-encoded Sinhala", () => {
    const sinhala = "රී ලංකා";
    const broken = Buffer.from(sinhala, "utf8").toString("latin1");
    expect(repairMojibake(broken)).toBe(sinhala);
  });

  it("leaves legitimately accented Latin text alone", () => {
    // A blanket reinterpretation would mangle this; the repair is applied
    // only when it actually yields an Indic script.
    expect(repairMojibake("Université de Paris")).toBe("Université de Paris");
  });
});
