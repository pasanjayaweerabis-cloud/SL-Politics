/**
 * Javora — API input validation.
 *
 * Every value here comes from a public, unauthenticated URL. The rule is:
 * reject clearly-wrong input with a 400 and a safe, specific message, rather
 * than silently clamping it into something plausible. Silent clamping is how
 * `?limit=abc` becomes `NaN`, reaches a SQL `LIMIT` clause as `NaN`, and
 * produces a confusing empty or malformed result with no indication why —
 * that failure mode is what this module exists to remove.
 *
 * The numeric caps below (`MAX_LIST_ITEMS`, `MAX_ITEM_LENGTH`, …) are not
 * arbitrary tidiness: an unbounded `?role=a,a,a,…` repeated thousands of times
 * turns into a SQL `IN (...)` clause with thousands of placeholders, which is
 * a resource-exhaustion vector on a public endpoint with no authentication
 * gating who can send it.
 */

/** Thrown for malformed client input. Callers map this to HTTP 400. */
export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;
const MAX_OFFSET = 1_000_000; // beyond this, paginate by a narrower filter instead.
const MAX_QUERY_LENGTH = 200;
const MAX_LIST_ITEMS = 50;
const MAX_ITEM_LENGTH = 100;
const MAX_ID_LENGTH = 200;

function parseNonNegativeInt(raw: string, field: string): number {
  if (!/^\d+$/.test(raw)) throw new ValidationError(`"${field}" must be a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ValidationError(`"${field}" is out of range`);
  return value;
}

/**
 * `limit`/`offset` query parameters, validated and bounded.
 *
 * A limit above `MAX_LIMIT` is not silently truncated to it — it is rejected.
 * Truncating would let a caller believe they set `limit=100000` when the
 * server quietly served 200; rejecting tells them so directly.
 */
export function parsePagination(params: URLSearchParams): { limit: number; offset: number } {
  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");

  const limit = limitRaw === null ? DEFAULT_LIMIT : parseNonNegativeInt(limitRaw, "limit");
  const offset = offsetRaw === null ? 0 : parseNonNegativeInt(offsetRaw, "offset");

  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`"limit" must be between 1 and ${MAX_LIMIT}`);
  }
  if (offset > MAX_OFFSET) {
    throw new ValidationError(`"offset" must not exceed ${MAX_OFFSET}`);
  }

  return { limit, offset };
}

/** A free-text search term. Trimmed; length-capped to bound LIKE-scan cost. */
export function parseSearchTerm(raw: string | null): string {
  const value = (raw ?? "").trim();
  if (value.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(`"q" must not exceed ${MAX_QUERY_LENGTH} characters`);
  }
  return value;
}

/**
 * A comma-or-repeated multi-value filter parameter (`?role=a&role=b` or
 * `?role=a,b`), capped in count and per-item length.
 */
export function parseListParam(params: URLSearchParams, key: string): string[] {
  const values = params
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);

  if (values.length > MAX_LIST_ITEMS) {
    throw new ValidationError(`"${key}" accepts at most ${MAX_LIST_ITEMS} values`);
  }
  for (const value of values) {
    if (value.length > MAX_ITEM_LENGTH) {
      throw new ValidationError(`a value for "${key}" exceeds ${MAX_ITEM_LENGTH} characters`);
    }
  }
  return values;
}

/**
 * Percent-decode one URL path segment, treating malformed encoding as the
 * CLIENT error it is.
 *
 * `decodeURIComponent` throws a bare `URIError` on input like `%%%%`, which
 * reached the API's generic catch-all and was reported as HTTP 500 with a
 * stack trace written to the server log. Nothing leaked — the client only
 * ever saw `{"error":"internal-error"}` — but the status was still wrong in
 * ways that matter operationally: a 5xx invites clients and CDNs to retry,
 * and it puts routine malformed input into the same error budget and alerting
 * channel as a real server fault. A malformed URL is a 400.
 */
export function decodePathSegment(raw: string, field = "identifier"): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ValidationError(`"${field}" is not valid percent-encoded text`);
  }
}

/** A person id or slug from the URL path. */
export function parseIdOrSlug(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ValidationError("a person identifier is required");
  if (value.length > MAX_ID_LENGTH) throw new ValidationError("person identifier is too long");
  return value;
}
