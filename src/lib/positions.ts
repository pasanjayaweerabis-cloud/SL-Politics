/**
 * Javora — position logic, all derived.
 *
 * There is deliberately no stored `current` flag anywhere in the model. Whether
 * an office is held right now is a function of its dates and today's date, so a
 * record written in 2024 still reads correctly in 2031 with nobody editing it —
 * and a stored flag can never drift out of agreement with the dates.
 */

import { toSortKey, toLatestKey, yearsBetween, parseDate } from "./date.ts";
import { precedenceFor } from "../data/roles.ts";
import type { DateString, Duration, Position } from "../types/models.ts";

/** The minimal shape the position helpers need; keeps them testable. */
export interface PositionLike {
  title: string;
  startDate: DateString | null;
  endDate: DateString | null;
  /** See `Position.currentAsOf` — a source's dated assertion that the office is held. */
  currentAsOf?: DateString | null;
  /** See `Position.endStatus`. Absent is treated as "not stated either way". */
  endStatus?: "ongoing" | "dated" | "not-recorded";
  roleType?: Position["roleType"];
  precedence?: number;
}

/**
 * A position is current when it has no recorded end date AND either
 * (a) it has a start date that has already arrived, or
 * (b) a source asserted it was held on a date that has already arrived.
 *
 * A recorded `endDate` always wins: a source's "currently held" assertion
 * can never override an explicit end, so the two cannot contradict.
 *
 * Without either signal we cannot assert the office has begun, so it is not
 * current. A future date is likewise not current — announced-but-not-yet
 * -assumed offices exist in the record and must not be shown as held.
 */
export function isCurrent(position: PositionLike, today: Date = new Date()): boolean {
  if (position.endDate) return false;
  // A source that gave a start date and said nothing about the end has NOT
  // asserted the office is still held. Treating that silence as "current"
  // is how a minister who left decades ago ends up displayed as sitting.
  if (position.endStatus === "not-recorded") return false;
  const asserted = position.startDate ?? position.currentAsOf ?? null;
  if (!asserted) return false;
  return !isFuture(asserted, today);
}

/**
 * True when the office ended but the source never said when.
 *
 * Distinct from `hasEnded()`, which requires a date. The interface renders
 * this as "end date not recorded" rather than leaving the reader to infer
 * either a date or a continuation.
 */
export function endedWithoutRecordedDate(position: PositionLike): boolean {
  return !position.endDate && position.endStatus === "not-recorded";
}

/** True when the earliest instant the date could denote is still ahead of us. */
export function isFuture(date: DateString | null, today: Date = new Date()): boolean {
  if (!date) return false;
  const key = toSortKey(date);
  if (!Number.isFinite(key)) return false;
  return key > today.getTime();
}

/** True when the office has a recorded end date that has already passed. */
export function hasEnded(position: PositionLike, today: Date = new Date()): boolean {
  if (!position.endDate) return false;
  return toLatestKey(position.endDate) <= today.getTime();
}

/** Tenure length as a precision-honest duration. */
export function tenureOf(position: PositionLike, today: Date = new Date()): Duration {
  return yearsBetween(position.startDate, position.endDate ?? null, today);
}

/**
 * "2024 – Present", "2000 – 2024", "1995".
 * Renders only the precision recorded; never invents a start or end.
 */
export function formatTenure(
  position: PositionLike,
  today: Date = new Date(),
): string | null {
  const start = parseDate(position.startDate);
  if (!start) return null;
  const startText = String(start.year);

  if (isCurrent(position, today)) return `${startText} – Present`;
  if (!position.endDate) return startText;

  const end = parseDate(position.endDate);
  if (!end) return startText;
  return end.year === start.year ? startText : `${startText} – ${end.year}`;
}

/**
 * Detect dates that cannot both be true. Surfaced by the data quality report
 * rather than silently rendered.
 */
export function hasInvalidDateRange(position: PositionLike): boolean {
  if (!position.startDate || !position.endDate) return false;
  const start = parseDate(position.startDate);
  const end = parseDate(position.endDate);
  if (!start || !end) return false;
  // Compare the earliest the end could be against the latest the start could be.
  return toLatestKey(position.endDate) < toSortKey(position.startDate);
}

/** Positions newest-first; currently-held offices always lead. */
export function sortPositions<T extends PositionLike>(
  positions: readonly T[],
  today: Date = new Date(),
): T[] {
  return [...positions].sort((a, b) => {
    const currentDelta = Number(isCurrent(b, today)) - Number(isCurrent(a, today));
    if (currentDelta !== 0) return currentDelta;
    return toSortKey(b.startDate) - toSortKey(a.startDate);
  });
}

/**
 * The office a profile leads with: the highest-precedence office currently
 * held, or failing that the most recent one held.
 *
 * Precedence comes from the role type, so the UI never ranks offices itself.
 */
export function primaryPosition<T extends PositionLike>(
  positions: readonly T[],
  today: Date = new Date(),
): T | null {
  if (!positions.length) return null;
  const sorted = sortPositions(positions, today);
  const current = sorted.filter((p) => isCurrent(p, today));
  const pool = current.length ? current : sorted;

  const rank = (p: T) =>
    p.precedence ?? (p.roleType ? precedenceFor(p.roleType) : 99);

  return [...pool].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** True when the person holds any office right now. */
export const isServing = (
  positions: readonly PositionLike[],
  today: Date = new Date(),
): boolean => positions.some((p) => isCurrent(p, today));

/**
 * Offices whose date ranges overlap. Overlap is legitimate in Sri Lankan
 * practice (an MP who is also a minister), so this reports rather than warns.
 */
export function overlappingPositions<T extends PositionLike>(
  positions: readonly T[],
): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]!;
      const b = positions[j]!;
      if (!a.startDate || !b.startDate) continue;
      const aStart = toSortKey(a.startDate);
      const aEnd = a.endDate ? toLatestKey(a.endDate) : Number.POSITIVE_INFINITY;
      const bStart = toSortKey(b.startDate);
      const bEnd = b.endDate ? toLatestKey(b.endDate) : Number.POSITIVE_INFINITY;
      if (aStart <= bEnd && bStart <= aEnd) pairs.push([a, b]);
    }
  }
  return pairs;
}
