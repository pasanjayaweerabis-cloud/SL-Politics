import { describe, it, expect } from "vitest";
import { reviewItemFor } from "./identityReview.ts";
import { resolveIdentity, type IdentityCandidate } from "../lib/identity.ts";

const candidates: IdentityCandidate[] = [
  {
    id: "anura-kumara-dissanayake",
    canonicalName: "Anura Kumara Dissanayake",
    aliases: ["AKD"],
    externalIds: { parliament: "MP-1234" },
    dateOfBirth: "1968-11-24",
  },
];

describe("reviewItemFor", () => {
  it("needs no review for an exact, auto-mergeable match", () => {
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "A. K. Dissanayake", externalIds: { parliament: "MP-1234" } },
      candidates,
    );
    expect(reviewItemFor(match, { canonicalName: "A. K. Dissanayake" }, "S001")).toBeNull();
  });

  it("needs no review when there is no candidate at all — that's a new person, not a review", () => {
    const match = resolveIdentity({ id: "incoming", canonicalName: "Someone Else Entirely" }, candidates);
    expect(reviewItemFor(match, { canonicalName: "Someone Else Entirely" }, "S001")).toBeNull();
  });

  it("queues a name-only match for review rather than merging it", () => {
    const match = resolveIdentity({ id: "incoming", canonicalName: "Anura Kumara Dissanayake" }, candidates);
    const item = reviewItemFor(match, { canonicalName: "Anura Kumara Dissanayake" }, "S002");

    expect(item).not.toBeNull();
    expect(item?.candidatePersonId).toBe("anura-kumara-dissanayake");
    expect(item?.confidence).toBe("uncertain");
    expect(item?.sourceId).toBe("S002");
  });

  it("queues a name-plus-birth-date match too, despite the higher confidence — still not automatic", () => {
    const match = resolveIdentity(
      { id: "incoming", canonicalName: "Anura Kumara Dissanayake", dateOfBirth: "1968-11-24" },
      candidates,
    );
    const item = reviewItemFor(match, { canonicalName: "Anura Kumara Dissanayake" }, "S002");

    expect(item?.confidence).toBe("probable");
  });

  it("assigns each review item a distinct id", () => {
    const match = resolveIdentity({ id: "incoming", canonicalName: "Anura Kumara Dissanayake" }, candidates);
    const first = reviewItemFor(match, { canonicalName: "Anura Kumara Dissanayake" }, "S002");
    const second = reviewItemFor(match, { canonicalName: "Anura Kumara Dissanayake" }, "S002");
    expect(first?.id).not.toBe(second?.id);
  });

  it("records a real ISO detection timestamp by default", () => {
    const match = resolveIdentity({ id: "incoming", canonicalName: "Anura Kumara Dissanayake" }, candidates);
    const item = reviewItemFor(match, { canonicalName: "Anura Kumara Dissanayake" }, "S002");
    expect(Number.isNaN(Date.parse(item!.detectedAt))).toBe(false);
  });
});
