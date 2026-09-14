/**
 * Javora — idempotent import.
 *
 * The requirement this module exists to satisfy: running the importer twice
 * against an unchanged source must leave the dataset byte-identical. Not
 * "nearly identical", not "no visible duplicates" — no new people, no new
 * positions, no new evidence rows, no spurious change events.
 *
 * How that is achieved: every record the importer can create has a
 * DETERMINISTIC id derived from stable source facts, not from a counter or a
 * timestamp. Import twice and you compute the same ids twice, so the second
 * run recognises every record as one it already has. Identity for people is
 * anchored on the source's own member id — never on a name — which is what
 * makes it safe to re-run without merging two politicians who happen to
 * share a name.
 */

import type { ChangeEvent, EntityType } from "../types/models.ts";

/* ==========================================================================
   Deterministic identifiers
   ========================================================================== */

/**
 * A person's stable Javora id, derived from the source that identified them.
 *
 * `parliament:3560` rather than a sequence number: re-importing produces the
 * same id, and the id itself records which source's identifier space it came
 * from, so two sources' id `3560` can never collide.
 */
export const personIdFor = (sourceKey: string, externalId: string): string =>
  `${sourceKey}:${externalId}`;

/**
 * A position's stable id.
 *
 * Derived from the person plus a slug of the office title, so the same
 * person's same office computes the same id on every run. A person genuinely
 * holding two offices produces two different slugs, so both survive; the
 * same office re-imported collapses onto itself.
 */
export function positionIdFor(
  personId: string,
  title: string,
  /**
   * Distinguishes repeats of the SAME office by the same person.
   *
   * A member sits as "Member of Parliament" in the Ninth Parliament and again
   * in the Tenth. Those are two terms with two sets of dates, not one record —
   * without a discriminator the second collapses onto the first and a career
   * spanning eight parliaments renders as a single undated row.
   *
   * Omitted, the id is byte-identical to what it was before this parameter
   * existed, so no established id changes.
   */
  discriminator?: string | null,
): string {
  const base = `${personId}#${slug(title)}`;
  return discriminator ? `${base}#${slug(discriminator)}` : base;
}

/**
 * Stable ids for the education/career records.
 *
 * Keyed on the source's own verbatim text rather than on a classification of
 * it. Re-running the import after a classifier change must not renumber a
 * person's degrees — the degree did not change, only Javora's reading of it.
 */
export const educationIdFor = (personId: string, sourceText: string): string =>
  `${personId}~edu~${slug(sourceText)}`;

export const employmentIdFor = (personId: string, organisation: string, role: string | null): string =>
  `${personId}~emp~${slug(`${organisation} ${role ?? ""}`)}`;

export const publicServiceIdFor = (personId: string, organisation: string, role: string | null): string =>
  `${personId}~svc~${slug(`${organisation} ${role ?? ""}`)}`;

export const legalChallengeIdFor = (personId: string, reference: string): string =>
  `${personId}~law~${slug(reference)}`;

export const affiliationIdFor = (personId: string, partyId: string): string =>
  `${personId}@${partyId}`;

/**
 * An evidence record's stable id.
 *
 * Keyed on what the evidence actually asserts — which source, which entity,
 * which field, which document — so re-importing the same citation does not
 * accumulate duplicate evidence rows pointing at the same page.
 */
export function evidenceIdFor(input: {
  sourceId: string;
  entityType: EntityType;
  entityId: string;
  fieldName: string | null;
  sourceUrl: string | null;
}): string {
  return [
    "EV",
    input.sourceId,
    input.entityType,
    slug(input.entityId),
    input.fieldName ? slug(input.fieldName) : "-",
    input.sourceUrl ? String(fnv(input.sourceUrl)) : "-",
  ].join(":");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fnv(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/* ==========================================================================
   Diffing an incoming record against what is already stored
   ========================================================================== */

export interface FieldChange {
  fieldName: string;
  previousValue: string | null;
  newValue: string | null;
}

/**
 * Which watched fields differ between the stored record and the incoming one.
 *
 * Only the fields named in `fields` are compared, so adding an internal
 * bookkeeping column to a record never registers as an official-source
 * change. Absent and null are treated alike: a source that stops publishing a
 * value has not changed it to the string "null".
 */
export function diffFields<T extends Record<string, unknown>>(
  stored: T | null,
  incoming: T,
  fields: Array<keyof T & string>,
): FieldChange[] {
  if (!stored) return [];
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const before = normaliseValue(stored[field]);
    const after = normaliseValue(incoming[field]);
    if (before !== after) {
      changes.push({ fieldName: field, previousValue: before, newValue: after });
    }
  }
  return changes;
}

function normaliseValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

let changeCounter = 0;

/** Record a field change as an auditable event. Insert-only. */
export function makeChangeEvent(input: {
  entityType: EntityType;
  entityId: string;
  change: FieldChange;
  sourceId: string | null;
  sourceSnapshotId: string | null;
  detectedAt: string;
  actor: string;
}): ChangeEvent {
  return {
    id: `CHG-${String(++changeCounter).padStart(6, "0")}`,
    entityType: input.entityType,
    entityId: input.entityId,
    fieldName: input.change.fieldName,
    previousValue: input.change.previousValue,
    newValue: input.change.newValue,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceId: input.sourceId,
    detectedAt: input.detectedAt,
    // Null: detecting a change is not verifying it. A reviewer sets this.
    verifiedAt: null,
    actor: input.actor,
  };
}

/* ==========================================================================
   Import outcome
   ========================================================================== */

export interface ImportSummary {
  /** Records seen in the incoming payload. */
  seen: number;
  /** Records that did not exist before this run. */
  created: number;
  /** Records that existed and had at least one watched field change. */
  updated: number;
  /** Records that existed and were byte-identical — the idempotent path. */
  unchanged: number;
  changeEvents: ChangeEvent[];
}

export const emptySummary = (): ImportSummary => ({
  seen: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  changeEvents: [],
});

/**
 * Reconcile one incoming record against the store.
 *
 * Returns what happened rather than performing writes, so the decision is
 * testable in isolation and a caller can batch or review the writes.
 */
export function reconcile<T extends Record<string, unknown>>(input: {
  stored: T | null;
  incoming: T;
  entityType: EntityType;
  entityId: string;
  watchedFields: Array<keyof T & string>;
  sourceId: string | null;
  sourceSnapshotId: string | null;
  detectedAt: string;
  actor: string;
}): { outcome: "created" | "updated" | "unchanged"; changeEvents: ChangeEvent[] } {
  if (!input.stored) return { outcome: "created", changeEvents: [] };

  const changes = diffFields(input.stored, input.incoming, input.watchedFields);
  if (!changes.length) return { outcome: "unchanged", changeEvents: [] };

  return {
    outcome: "updated",
    changeEvents: changes.map((change) =>
      makeChangeEvent({
        entityType: input.entityType,
        entityId: input.entityId,
        change,
        sourceId: input.sourceId,
        sourceSnapshotId: input.sourceSnapshotId,
        detectedAt: input.detectedAt,
        actor: input.actor,
      }),
    ),
  };
}
