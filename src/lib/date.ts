/**
 * Javora — precision-aware date arithmetic.
 *
 * Public records frequently record only a year ("1968") or a month
 * ("2024-09"). The previous implementation widened those to 1 January and then
 * reported a single exact age, which manufactured precision the source never
 * provided: from a year-only birth date, a person is one of *two* ages on any
 * given day, and which one depends on a birthday we do not know.
 *
 * Every duration here therefore returns a `Duration` — exact, a bounded range,
 * or unknown — and the interface renders a range as a range.
 *
 * Nothing time-dependent is stored anywhere in the dataset. `today` is injected
 * so the logic is deterministic under test.
 */

import type {
  DateString,
  DatePrecision,
  Duration,
  ParsedDate,
} from "../types/models.ts";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DATE_RE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

/** Days in a month, accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parse a partial ISO date. Returns null for anything malformed — including
 * calendar-invalid dates like "2023-02-30", which must not be accepted merely
 * because they match the shape.
 */
export function parseDate(value: unknown): ParsedDate | null {
  if (typeof value !== "string") return null;
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;

  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null && month !== null) {
    if (day < 1 || day > daysInMonth(year, month)) return null;
  }

  const precision: DatePrecision = day !== null ? "day" : month !== null ? "month" : "year";
  return { year, month, day, precision };
}

export const isValidDate = (value: unknown): boolean => parseDate(value) !== null;

/** Precision of a stored date, or null when unparseable/absent. */
export function precisionOf(value: unknown): DatePrecision | null {
  return parseDate(value)?.precision ?? null;
}

/* ==========================================================================
   Ordering
   ========================================================================== */

/**
 * Earliest instant a partial date could denote — used only for sorting.
 * Widening is safe here because the result is never shown to a reader.
 */
export function toSortKey(value: unknown): number {
  const parsed = parseDate(value);
  if (!parsed) return Number.NEGATIVE_INFINITY;
  return Date.UTC(parsed.year, (parsed.month ?? 1) - 1, parsed.day ?? 1);
}

/** Latest instant a partial date could denote. */
export function toLatestKey(value: unknown): number {
  const parsed = parseDate(value);
  if (!parsed) return Number.POSITIVE_INFINITY;
  const month = parsed.month ?? 12;
  const day = parsed.day ?? daysInMonth(parsed.year, month);
  return Date.UTC(parsed.year, month - 1, day, 23, 59, 59, 999);
}

/* ==========================================================================
   Formatting
   ========================================================================== */

/**
 * Render a date at exactly the precision recorded.
 * "long" → "24 November 1968" · "short" → "Nov 24, 1968" · "year" → "1968"
 */
export function formatDate(
  value: unknown,
  style: "long" | "short" | "year" = "long",
): string | null {
  const parsed = parseDate(value);
  if (!parsed) return null;

  const { year, month, day, precision } = parsed;
  if (style === "year" || precision === "year") return String(year);

  const name = MONTHS[month! - 1];
  const short = name.slice(0, 3);

  if (precision === "month") return style === "short" ? `${short} ${year}` : `${name} ${year}`;
  return style === "short" ? `${short} ${day}, ${year}` : `${day} ${name} ${year}`;
}

/** Human phrasing of a duration, honest about precision. */
export function formatDuration(duration: Duration, unit = "yr"): string | null {
  const plural = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  switch (duration.kind) {
    case "exact":
      return plural(duration.years);
    case "range":
      return `${duration.min}–${plural(duration.max)}`;
    case "unknown":
      return null;
  }
}

/** Human phrasing of an age, honest about precision. */
export function formatAge(duration: Duration, atDeath = false): string | null {
  const suffix = atDeath ? " at death" : "";
  switch (duration.kind) {
    case "exact":
      return atDeath ? `aged ${duration.years} at death` : `${duration.years} years old`;
    case "range":
      return `approximately ${duration.min}–${duration.max}${suffix}`;
    case "unknown":
      return null;
  }
}

/* ==========================================================================
   Durations
   ========================================================================== */

function todayParts(today: Date): ParsedDate {
  return {
    year: today.getUTCFullYear(),
    month: today.getUTCMonth() + 1,
    day: today.getUTCDate(),
    precision: "day",
  };
}

/**
 * Whole years elapsed between two dates, as a range when precision demands it.
 *
 * The bounds are computed from the widest and narrowest intervals the two
 * partial dates can denote:
 *   min — latest possible start to earliest possible end
 *   max — earliest possible start to latest possible end
 *
 * When both collapse to the same number the result is `exact`. This is what
 * stops "1968" from reporting a single confident age.
 */
export function yearsBetween(
  fromValue: DateString | null | undefined,
  toValue: DateString | null | undefined,
  today: Date = new Date(),
): Duration {
  const from = parseDate(fromValue);
  if (!from) return { kind: "unknown", reason: fromValue ? "invalid-date" : "no-start-date" };

  let to: ParsedDate | null;
  if (toValue === null || toValue === undefined) {
    to = todayParts(today);
  } else {
    to = parseDate(toValue);
    if (!to) return { kind: "unknown", reason: "invalid-date" };
  }

  const earliestFrom = { y: from.year, m: from.month ?? 1, d: from.day ?? 1 };
  const latestFrom = {
    y: from.year,
    m: from.month ?? 12,
    d: from.day ?? daysInMonth(from.year, from.month ?? 12),
  };
  const earliestTo = { y: to.year, m: to.month ?? 1, d: to.day ?? 1 };
  const latestTo = {
    y: to.year,
    m: to.month ?? 12,
    d: to.day ?? daysInMonth(to.year, to.month ?? 12),
  };

  const min = completedYears(latestFrom, earliestTo);
  const max = completedYears(earliestFrom, latestTo);

  if (max < 0) return { kind: "unknown", reason: "negative-duration" };

  const lo = Math.max(0, min);
  if (lo === max) return { kind: "exact", years: max };
  return { kind: "range", min: lo, max };
}

/** Whole years completed between two fully-specified calendar points. */
function completedYears(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): number {
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years -= 1;
  return years;
}

/**
 * Age, derived — never stored.
 * Living: age today. Deceased: age at death, flagged so the UI can say so.
 */
export function deriveAge(
  dateOfBirth: DateString | null | undefined,
  dateOfDeath: DateString | null | undefined = null,
  today: Date = new Date(),
): { duration: Duration; atDeath: boolean } {
  return {
    duration: yearsBetween(dateOfBirth, dateOfDeath ?? null, today),
    atDeath: Boolean(dateOfDeath),
  };
}
