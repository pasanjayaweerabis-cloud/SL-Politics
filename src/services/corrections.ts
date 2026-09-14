/**
 * Javora — correction reports.
 *
 * The validation and payload shape here are the API contract a future backend
 * must accept. Keeping them in the service layer (rather than inline in the
 * form) means the same rules will run server-side without being rewritten —
 * client-side validation is a convenience for the reporter, never the
 * authority.
 */

import type { CorrectionReport, EntityType } from "../types/models.ts";

/** Fields a reader can meaningfully dispute. */
export const CORRECTION_FIELDS: Array<{ id: string; label: string }> = [
  { id: "canonicalName", label: "Name" },
  { id: "aliases", label: "Aliases or alternate spellings" },
  { id: "dateOfBirth", label: "Date of birth" },
  { id: "dateOfDeath", label: "Date of death" },
  { id: "party", label: "Political party" },
  { id: "district", label: "District" },
  { id: "position.title", label: "Office title" },
  { id: "position.startDate", label: "Office start date" },
  { id: "position.endDate", label: "Office end date" },
  { id: "qualification", label: "Qualification" },
  { id: "timelineEvent", label: "Timeline event" },
  { id: "other", label: "Something else" },
];

const FIELD_IDS = new Set(CORRECTION_FIELDS.map((field) => field.id));

export interface CorrectionInput {
  entityId: string;
  fieldName: string;
  currentValue: string;
  proposedValue: string;
  supportingSourceUrl: string;
  explanation: string;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: Record<string, string> };

/**
 * Reject anything that is not an http(s) URL.
 *
 * Blocks `javascript:`, `data:` and similar schemes: the URL is echoed back
 * into the page, and a later admin interface will render it as a link, so a
 * hostile scheme must never survive validation.
 */
export function isAcceptableSourceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // A bare origin is not evidence for a specific claim.
  return url.pathname.replace(/\/+$/, "").length > 0 || url.search.length > 0;
}

export function validateCorrection(input: CorrectionInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.entityId.trim()) {
    errors.entityId = "Choose the record the correction applies to.";
  }

  if (!input.fieldName.trim()) {
    errors.fieldName = "Choose which field is wrong.";
  } else if (!FIELD_IDS.has(input.fieldName)) {
    errors.fieldName = "That field is not one SL Politics records.";
  }

  if (!input.proposedValue.trim()) {
    errors.proposedValue = "Enter the value the record should show.";
  } else if (input.proposedValue.trim() === input.currentValue.trim()) {
    errors.proposedValue = "The proposed value is identical to the current one.";
  }

  const sourceUrl = input.supportingSourceUrl.trim();
  if (!sourceUrl) {
    errors.supportingSourceUrl = "A correction needs an official source that can be checked.";
  } else if (!isAcceptableSourceUrl(sourceUrl)) {
    errors.supportingSourceUrl =
      "Enter a full http(s) link to the specific page or document — an institution’s homepage is not evidence for a specific claim.";
  }

  return Object.keys(errors).length ? { valid: false, errors } : { valid: true };
}

/**
 * Build the record a reviewer would receive.
 *
 * `submittedAt` is generated at build time and is the only timestamp present.
 * No review timestamps are invented: `reviewedAt` and `reviewer` stay null
 * because no review has happened.
 */
export function buildCorrectionPayload(
  input: CorrectionInput,
  entityType: EntityType = "person",
): Omit<CorrectionReport, "id"> {
  return {
    entityType,
    entityId: input.entityId.trim(),
    fieldName: input.fieldName.trim(),
    currentValue: input.currentValue.trim() || null,
    proposedValue: input.proposedValue.trim(),
    supportingSourceUrl: input.supportingSourceUrl.trim(),
    explanation: input.explanation.trim(),
    submittedAt: new Date().toISOString(),
    reviewStatus: "open",
    reviewedAt: null,
    reviewer: null,
    resolution: null,
  };
}
