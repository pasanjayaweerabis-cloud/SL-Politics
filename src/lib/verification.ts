/**
 * Javora — verification states and their enforcement.
 *
 * The guarantees in this file are the reason a reader can trust the badges in
 * the interface. They are enforced here, in code, rather than left to the
 * discipline of whoever edits a dataset:
 *
 *   1. While the dataset is in demonstration mode, NOTHING may present itself
 *      as verified. Every claim is forced to DEMONSTRATION.
 *
 *   2. A claim may only call itself VERIFIED if it names supporting evidence
 *      AND carries a verification timestamp. Missing either downgrades it to
 *      PENDING_REVIEW — a verification claim with no date is not a verification.
 *
 *   3. A claim that points only at an institution (no specific document) is
 *      UNVERIFIED, not SOURCE_LINKED. Citing a homepage is not citing a source.
 *
 *   4. UNAVAILABLE means "no authoritative record located". It never means
 *      "no such record exists", and the presentation copy says so.
 */

import {
  VerificationState,
  type Claim,
  type DatasetMode,
  type SourceEvidence,
  type VerificationPresentation,
  type VerificationStateValue,
} from "../types/models.ts";

export { VerificationState };

export const VERIFICATION_PRESENTATION: Record<
  VerificationStateValue,
  VerificationPresentation
> = {
  [VerificationState.DEMONSTRATION]: {
    label: "Demonstration",
    icon: "document",
    modifier: "sample",
    description: "Hand-entered sample. Not checked against any source.",
  },
  [VerificationState.UNVERIFIED]: {
    label: "Unverified",
    icon: "document",
    modifier: "sample",
    description: "Recorded without a specific supporting document.",
  },
  [VerificationState.SOURCE_LINKED]: {
    label: "Source-linked",
    icon: "link",
    modifier: "linked",
    description: "Points to a specific source document, not yet checked.",
  },
  [VerificationState.VERIFIED]: {
    label: "Verified",
    icon: "shieldCheck",
    modifier: "verified",
    description: "Matched against an authoritative source on a recorded date.",
  },
  [VerificationState.SECONDARY_CORROBORATED]: {
    label: "Secondary source",
    icon: "document",
    modifier: "secondary",
    description:
      "Reported by a non-authoritative source such as a news outlet, biography aggregator or research compilation. No official record confirms it.",
  },
  [VerificationState.CONFLICTING]: {
    label: "Sources conflict",
    icon: "alert",
    modifier: "review",
    description: "Two or more sources disagree. Shown rather than resolved.",
  },
  [VerificationState.PENDING_REVIEW]: {
    label: "Pending review",
    icon: "clock",
    modifier: "review",
    description: "Awaiting human confirmation before it can be called verified.",
  },
  [VerificationState.UNAVAILABLE]: {
    label: "Unavailable",
    icon: "slash",
    modifier: "unavailable",
    description: "No authoritative record located. Not a claim that none exists.",
  },
};

/** States that may legitimately be described to a reader as established fact. */
const TRUSTWORTHY: ReadonlySet<VerificationStateValue> = new Set([
  VerificationState.VERIFIED,
]);

export const isTrustworthy = (state: VerificationStateValue): boolean =>
  TRUSTWORTHY.has(state);

/** A claim with no evidence and no verification — the honest default. */
export function emptyClaim(
  state: VerificationStateValue = VerificationState.UNVERIFIED,
): Claim {
  return { verification: state, evidenceIds: [], verifiedAt: null };
}

/**
 * Apply every verification guarantee to a stored claim.
 *
 * `datasetMode` is passed in rather than imported so the rules can be tested
 * in both modes without mutating global state.
 */
export function normaliseClaim(
  claim: Claim | null | undefined,
  datasetMode: DatasetMode,
  evidenceById?: ReadonlyMap<string, SourceEvidence>,
): Claim {
  const input: Claim = claim ?? emptyClaim();
  const evidenceIds = input.evidenceIds ?? [];
  const verifiedAt = input.verifiedAt ?? null;

  // Guarantee 1 — demonstration data can never claim more than demonstration.
  if (datasetMode === "demonstration") {
    return {
      verification: VerificationState.DEMONSTRATION,
      evidenceIds,
      verifiedAt: null,
    };
  }

  // Unknown state → treat as unverified rather than trusting it.
  if (!VERIFICATION_PRESENTATION[input.verification]) {
    return { verification: VerificationState.UNVERIFIED, evidenceIds, verifiedAt };
  }

  // Guarantee 2 — "verified" requires both evidence and a check date.
  if (input.verification === VerificationState.VERIFIED) {
    if (evidenceIds.length === 0 || !verifiedAt) {
      return { verification: VerificationState.PENDING_REVIEW, evidenceIds, verifiedAt };
    }
  }

  // Guarantee 3 — "source-linked" requires evidence precise enough to check.
  if (input.verification === VerificationState.SOURCE_LINKED && evidenceById) {
    const precise = evidenceIds
      .map((id) => evidenceById.get(id))
      .some((e) => e !== undefined && hasPreciseEvidence(e));
    if (!precise) {
      return { verification: VerificationState.UNVERIFIED, evidenceIds, verifiedAt };
    }
  }

  return { verification: input.verification, evidenceIds, verifiedAt };
}

/**
 * Whether evidence identifies a specific retrievable document, as opposed to
 * merely naming an institution. A bare `sourceId` is not evidence for a claim.
 */
export function hasPreciseEvidence(evidence: SourceEvidence | null | undefined): boolean {
  if (!evidence) return false;
  return Boolean(evidence.sourceUrl || evidence.sourceRecordId || evidence.locator);
}

export const presentVerification = (
  state: VerificationStateValue,
): VerificationPresentation =>
  VERIFICATION_PRESENTATION[state] ??
  VERIFICATION_PRESENTATION[VerificationState.UNVERIFIED];
