import { describe, it, expect } from "vitest";
import {
  normaliseClaim,
  emptyClaim,
  hasPreciseEvidence,
  presentVerification,
  isTrustworthy,
  VERIFICATION_PRESENTATION,
} from "./verification.ts";
import { VerificationState, type Claim, type SourceEvidence } from "../types/models.ts";

const evidence = (over: Partial<SourceEvidence> = {}): SourceEvidence => ({
  id: "E0001",
  sourceId: "S001",
  entityType: "position",
  entityId: "p-1",
  fieldName: null,
  sourceUrl: null,
  documentTitle: null,
  publishedAt: null,
  retrievedAt: null,
  locator: null,
  sourceRecordId: null,
  contentHash: null,
  notes: null,
  ...over,
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  verification: VerificationState.UNVERIFIED,
  evidenceIds: [],
  verifiedAt: null,
  ...over,
});

describe("demonstration mode guarantee", () => {
  it("forces every state down to DEMONSTRATION", () => {
    for (const state of Object.values(VerificationState)) {
      const result = normaliseClaim(claim({ verification: state }), "demonstration");
      expect(result.verification).toBe(VerificationState.DEMONSTRATION);
    }
  });

  it("strips any verification timestamp in demonstration mode", () => {
    const result = normaliseClaim(
      claim({ verification: VerificationState.VERIFIED, verifiedAt: "2026-01-01", evidenceIds: ["E1"] }),
      "demonstration",
    );
    expect(result.verifiedAt).toBeNull();
  });

  it("keeps evidence references so provenance is still visible", () => {
    const result = normaliseClaim(claim({ evidenceIds: ["E1", "E2"] }), "demonstration");
    expect(result.evidenceIds).toEqual(["E1", "E2"]);
  });
});

describe("verified requires evidence AND a date", () => {
  it("accepts a claim with both", () => {
    const result = normaliseClaim(
      claim({ verification: VerificationState.VERIFIED, evidenceIds: ["E1"], verifiedAt: "2026-01-01" }),
      "live",
    );
    expect(result.verification).toBe(VerificationState.VERIFIED);
  });

  it("downgrades a verified claim with no evidence", () => {
    const result = normaliseClaim(
      claim({ verification: VerificationState.VERIFIED, evidenceIds: [], verifiedAt: "2026-01-01" }),
      "live",
    );
    expect(result.verification).toBe(VerificationState.PENDING_REVIEW);
  });

  it("downgrades a verified claim with no check date", () => {
    const result = normaliseClaim(
      claim({ verification: VerificationState.VERIFIED, evidenceIds: ["E1"], verifiedAt: null }),
      "live",
    );
    expect(result.verification).toBe(VerificationState.PENDING_REVIEW);
  });
});

describe("source-linked requires precise evidence", () => {
  const index = (records: SourceEvidence[]) => new Map(records.map((r) => [r.id, r]));

  it("accepts evidence with a document URL", () => {
    const record = evidence({ id: "E1", sourceUrl: "https://www.parliament.lk/members/1234" });
    const result = normaliseClaim(
      claim({ verification: VerificationState.SOURCE_LINKED, evidenceIds: ["E1"] }),
      "live",
      index([record]),
    );
    expect(result.verification).toBe(VerificationState.SOURCE_LINKED);
  });

  it("accepts evidence with a page locator", () => {
    const record = evidence({ id: "E1", locator: "Page 12, paragraph 4" });
    const result = normaliseClaim(
      claim({ verification: VerificationState.SOURCE_LINKED, evidenceIds: ["E1"] }),
      "live",
      index([record]),
    );
    expect(result.verification).toBe(VerificationState.SOURCE_LINKED);
  });

  it("REJECTS evidence that names only an institution", () => {
    // A bare sourceId is what the legacy dataset had. Citing an organisation
    // is not citing a document, so this must not qualify as source-linked.
    const record = evidence({ id: "E1" });
    const result = normaliseClaim(
      claim({ verification: VerificationState.SOURCE_LINKED, evidenceIds: ["E1"] }),
      "live",
      index([record]),
    );
    expect(result.verification).toBe(VerificationState.UNVERIFIED);
  });

  it("rejects a claim whose evidence id resolves to nothing", () => {
    const result = normaliseClaim(
      claim({ verification: VerificationState.SOURCE_LINKED, evidenceIds: ["missing"] }),
      "live",
      index([]),
    );
    expect(result.verification).toBe(VerificationState.UNVERIFIED);
  });
});

describe("hasPreciseEvidence", () => {
  it("is true when a URL, record id or locator is present", () => {
    expect(hasPreciseEvidence(evidence({ sourceUrl: "https://x.lk/doc" }))).toBe(true);
    expect(hasPreciseEvidence(evidence({ sourceRecordId: "MP-1234" }))).toBe(true);
    expect(hasPreciseEvidence(evidence({ locator: "Page 3" }))).toBe(true);
  });

  it("is false for an institution-only reference or nothing at all", () => {
    expect(hasPreciseEvidence(evidence())).toBe(false);
    expect(hasPreciseEvidence(null)).toBe(false);
    expect(hasPreciseEvidence(undefined)).toBe(false);
  });
});

describe("presentation", () => {
  it("has presentation metadata for every state", () => {
    for (const state of Object.values(VerificationState)) {
      const presentation = VERIFICATION_PRESENTATION[state];
      expect(presentation).toBeDefined();
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.description.length).toBeGreaterThan(0);
    }
  });

  it("describes UNAVAILABLE as 'not located', not 'does not exist'", () => {
    const description = VERIFICATION_PRESENTATION[VerificationState.UNAVAILABLE].description;
    expect(description).toMatch(/located/i);
    expect(description).toMatch(/not a claim that none exists/i);
  });

  it("treats only VERIFIED as trustworthy", () => {
    expect(isTrustworthy(VerificationState.VERIFIED)).toBe(true);
    for (const state of Object.values(VerificationState)) {
      if (state !== VerificationState.VERIFIED) expect(isTrustworthy(state)).toBe(false);
    }
  });

  it("falls back to unverified presentation for an unknown state", () => {
    expect(presentVerification("nonsense" as never).label).toBe("Unverified");
  });
});

describe("defaults", () => {
  it("treats a missing claim as unverified, never as verified", () => {
    expect(normaliseClaim(null, "live").verification).toBe(VerificationState.UNVERIFIED);
    expect(normaliseClaim(undefined, "live").verification).toBe(VerificationState.UNVERIFIED);
  });

  it("rejects an unrecognised state rather than trusting it", () => {
    const result = normaliseClaim(claim({ verification: "totally-made-up" as never }), "live");
    expect(result.verification).toBe(VerificationState.UNVERIFIED);
  });

  it("builds an empty claim with no evidence and no timestamp", () => {
    expect(emptyClaim()).toEqual({
      verification: VerificationState.UNVERIFIED,
      evidenceIds: [],
      verifiedAt: null,
    });
  });
});
