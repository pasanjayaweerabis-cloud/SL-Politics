import { describe, it, expect } from "vitest";
import {
  validateCorrection,
  buildCorrectionPayload,
  isAcceptableSourceUrl,
  CORRECTION_FIELDS,
  type CorrectionInput,
} from "./corrections.ts";

const input = (over: Partial<CorrectionInput> = {}): CorrectionInput => ({
  entityId: "anura-kumara-dissanayake",
  fieldName: "dateOfBirth",
  currentValue: "1968-11-24",
  proposedValue: "1968-11-25",
  supportingSourceUrl: "https://www.parliament.lk/en/members/1234",
  explanation: "",
  ...over,
});

describe("isAcceptableSourceUrl", () => {
  it("accepts an http(s) URL pointing at a document", () => {
    expect(isAcceptableSourceUrl("https://www.parliament.lk/en/members/1234")).toBe(true);
    expect(isAcceptableSourceUrl("http://elections.gov.lk/results/2024")).toBe(true);
  });

  it("accepts an origin carrying a query string", () => {
    expect(isAcceptableSourceUrl("https://documents.gov.lk/?gazette=2404")).toBe(true);
  });

  it("rejects a bare homepage, which is not evidence for a specific claim", () => {
    expect(isAcceptableSourceUrl("https://www.parliament.lk")).toBe(false);
    expect(isAcceptableSourceUrl("https://www.parliament.lk/")).toBe(false);
  });

  it("rejects dangerous schemes", () => {
    expect(isAcceptableSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isAcceptableSourceUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isAcceptableSourceUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isAcceptableSourceUrl("not a url")).toBe(false);
    expect(isAcceptableSourceUrl("")).toBe(false);
  });
});

describe("validateCorrection", () => {
  it("accepts a complete, well-formed report", () => {
    expect(validateCorrection(input())).toEqual({ valid: true });
  });

  it("requires a record", () => {
    const result = validateCorrection(input({ entityId: "  " }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.entityId).toBeDefined();
  });

  it("requires a known field", () => {
    const missing = validateCorrection(input({ fieldName: "" }));
    expect(missing.valid).toBe(false);

    const unknown = validateCorrection(input({ fieldName: "favourite-colour" }));
    expect(unknown.valid).toBe(false);
    if (!unknown.valid) expect(unknown.errors.fieldName).toMatch(/not one SL Politics records/i);
  });

  it("accepts every field the form offers", () => {
    for (const field of CORRECTION_FIELDS) {
      expect(validateCorrection(input({ fieldName: field.id }))).toEqual({ valid: true });
    }
  });

  it("requires a proposed value", () => {
    const result = validateCorrection(input({ proposedValue: "   " }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.proposedValue).toBeDefined();
  });

  it("rejects a proposal identical to the current value", () => {
    const result = validateCorrection(input({ currentValue: "X", proposedValue: "X" }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.proposedValue).toMatch(/identical/i);
  });

  it("requires a checkable source", () => {
    const missing = validateCorrection(input({ supportingSourceUrl: "" }));
    expect(missing.valid).toBe(false);
    if (!missing.valid) expect(missing.errors.supportingSourceUrl).toMatch(/official source/i);

    const homepage = validateCorrection(input({ supportingSourceUrl: "https://www.parliament.lk" }));
    expect(homepage.valid).toBe(false);
  });

  it("allows an empty explanation", () => {
    expect(validateCorrection(input({ explanation: "" }))).toEqual({ valid: true });
  });

  it("reports every problem at once rather than one at a time", () => {
    const result = validateCorrection(input({ entityId: "", fieldName: "", proposedValue: "", supportingSourceUrl: "" }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(Object.keys(result.errors)).toHaveLength(4);
  });
});

describe("buildCorrectionPayload", () => {
  it("produces a report in the open state", () => {
    const payload = buildCorrectionPayload(input());
    expect(payload.reviewStatus).toBe("open");
    expect(payload.entityType).toBe("person");
    expect(payload.entityId).toBe("anura-kumara-dissanayake");
  });

  it("invents no review metadata", () => {
    const payload = buildCorrectionPayload(input());
    expect(payload.reviewedAt).toBeNull();
    expect(payload.reviewer).toBeNull();
    expect(payload.resolution).toBeNull();
  });

  it("records a real submission timestamp", () => {
    const payload = buildCorrectionPayload(input());
    expect(Number.isNaN(Date.parse(payload.submittedAt))).toBe(false);
  });

  it("normalises an empty current value to null rather than an empty string", () => {
    expect(buildCorrectionPayload(input({ currentValue: "   " })).currentValue).toBeNull();
  });

  it("trims whitespace from submitted values", () => {
    const payload = buildCorrectionPayload(input({ proposedValue: "  1968-11-25  " }));
    expect(payload.proposedValue).toBe("1968-11-25");
  });
});
