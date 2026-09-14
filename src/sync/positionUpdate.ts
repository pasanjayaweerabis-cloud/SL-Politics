/**
 * Javora — history-preserving position updates.
 *
 * This is the concrete answer to the product brief's central worked example:
 *
 *   OLD: Minister of X   2024 → 2026
 *   NEW: Minister of Y   2026 → Present
 *
 * A naive importer overwrites the position row when a source reports a new
 * portfolio. This module never does that. `planPositionUpdate` looks at a
 * person's currently open position (if any) for one office "slot" and an
 * incoming fact from a source, and returns a plan that either leaves the
 * record alone, opens a new position, or CLOSES the old one (writing its
 * `endDate`) and opens the new one alongside it — never in place of it.
 *
 * The plan is data, not a side effect: `planPositionUpdate` doesn't touch a
 * database or call `normaliseClaim`. Applying a plan (writing the closed
 * `endDate`, inserting the new `Position` row, and recording a `ChangeEvent`
 * for each) is the caller's job once a real backend exists — kept separate so
 * the decision logic itself is trivially unit-testable.
 */

import type { AppointmentType, DateString, RoleTypeValue } from "../types/models.ts";

/** One office fact as reported by a source, prior to being written as a `Position`. */
export interface PositionFact {
  title: string;
  roleType: RoleTypeValue;
  institution: string;
  ministry: string | null;
  startDate: DateString | null;
  /** Set only when the source explicitly states the office already ended. */
  endDate: DateString | null;
  appointmentType: AppointmentType;
  /**
   * When a source states exactly when the *previous* office-holder's term
   * ended (distinct from this appointment's own start date — a handover is
   * not always same-day), pass it here so the closed position gets that date
   * rather than being closed on this appointment's start date by default.
   */
  previousEndDate?: DateString | null;
}

/** The minimal shape of an existing position this module needs to reason about. */
export interface OpenPosition {
  id: string;
  title: string;
  institution: string;
  startDate: DateString | null;
  endDate: null;
}

export type PositionUpdatePlan =
  | { action: "no-op"; reason: "unchanged" }
  | { action: "open-new"; position: PositionFact }
  | {
      action: "close-and-open";
      closed: { positionId: string; endDate: DateString };
      opened: PositionFact;
    }
  | { action: "flag-conflict"; reason: string };

const sameOffice = (a: { title: string; institution: string }, b: { title: string; institution: string }) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  a.institution.trim().toLowerCase() === b.institution.trim().toLowerCase();

/**
 * Decide what should happen to a person's record for one office "slot" given
 * a new fact from a source.
 *
 * `currentOpenPosition` is the person's existing position for this slot with
 * no recorded `endDate` (there should be at most one at a time; the caller
 * picks which "slot" — e.g. by `roleType`, or by a specific ministry — before
 * calling this, since that grouping is a domain decision this pure function
 * shouldn't make on its own).
 */
export function planPositionUpdate(
  currentOpenPosition: OpenPosition | null,
  incoming: PositionFact,
): PositionUpdatePlan {
  if (!currentOpenPosition) {
    return { action: "open-new", position: incoming };
  }

  if (sameOffice(currentOpenPosition, incoming)) {
    // Two sources (or a re-check of the same source) confirming the same
    // office. Agreement on the start date is expected; disagreement is a
    // genuine conflict between sources about when this same term began.
    if (
      currentOpenPosition.startDate &&
      incoming.startDate &&
      currentOpenPosition.startDate !== incoming.startDate
    ) {
      return {
        action: "flag-conflict",
        reason:
          `Sources disagree on the start date of "${incoming.title}": ` +
          `existing record says ${currentOpenPosition.startDate}, incoming source says ${incoming.startDate}.`,
      };
    }
    return { action: "no-op", reason: "unchanged" };
  }

  // A different office is being reported while the old one is still open.
  // Closing it needs an end date, and one must be establishable — either the
  // source states it directly, or the new appointment's own start date
  // stands in for it (the common case: a reshuffle takes effect the day the
  // new appointment does).
  const endDate = incoming.previousEndDate ?? incoming.startDate;
  if (!endDate) {
    return {
      action: "flag-conflict",
      reason:
        `A new office ("${incoming.title}") was reported for a person who still has an open ` +
        `"${currentOpenPosition.title}" record, but no date was given to close the old one — ` +
        `closing it would require guessing an end date, which this pipeline will not do.`,
    };
  }

  return {
    action: "close-and-open",
    closed: { positionId: currentOpenPosition.id, endDate },
    opened: incoming,
  };
}
