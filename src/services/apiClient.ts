/**
 * Javora — API client.
 *
 * The seam that lets the React app read canonical records from the server
 * instead of from the bundled dataset, WITHOUT any component changing: the
 * UI already reads everything through `services/repository.ts`, so this
 * plugs in behind that boundary.
 *
 * WHY THIS IS OPT-IN. The app works today against the bundled dataset, which
 * needs no server running — the right default for `npm run dev` and for a
 * static deployment. Setting `VITE_API_URL` switches the data source to the
 * API. Making the API mandatory would mean the frontend could not start
 * without a database, which is a worse developer experience and buys nothing
 * while the dataset still fits in a bundle.
 *
 * Once the historical membership is imported the dataset will not fit, and
 * this becomes the only sensible path — which is why it exists now, already
 * returning the shapes the bundled repository returns.
 */

import type { ApiCurrentGovernment } from "../types/api.ts";
export type { ApiCurrentGovernment };

/** Configured API base, or null when the app should use bundled data. */
export const API_BASE: string | null =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? "").replace(/\/+$/, "") || null;

export const isApiEnabled = (): boolean => API_BASE !== null;


export interface ApiPersonSummary {
  id: string;
  slug: string;
  name: string;
  partyId: string | null;
  partyName: string | null;
  partyAbbreviation: string | null;
  districtId: string | null;
  districtName: string | null;
  headlineTitle: string | null;
  headlineRoleType: string | null;
  serving: boolean;
  verification: string;
  portraitUrl: string | null;
}

export interface ApiPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!API_BASE) throw new Error("VITE_API_URL is not configured; the API client is disabled.");
  const response = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`API ${response.status} ${response.statusText} for ${path}`);
  return (await response.json()) as T;
}

const encode = (params: Record<string, string | number | string[] | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
};

export const api = {
  people(
    options: {
      q?: string;
      party?: string[];
      district?: string[];
      role?: string[];
      status?: string[];
      limit?: number;
      offset?: number;
    } = {},
    signal?: AbortSignal,
  ) {
    return getJson<ApiPage<ApiPersonSummary>>(`/api/people${encode(options)}`, signal);
  },

  /** Typeahead. Server-ranked and capped; never fetches the whole directory. */
  search(query: string, limit = 8, signal?: AbortSignal) {
    return getJson<{ query: string; items: ApiPersonSummary[] }>(
      `/api/search${encode({ q: query, limit })}`,
      signal,
    );
  },

  person(idOrSlug: string, signal?: AbortSignal) {
    return getJson<Record<string, unknown>>(`/api/people/${encodeURIComponent(idOrSlug)}`, signal);
  },

  positions(idOrSlug: string, signal?: AbortSignal) {
    return getJson<{ positions: unknown[] }>(`/api/people/${encodeURIComponent(idOrSlug)}/positions`, signal);
  },

  timeline(idOrSlug: string, signal?: AbortSignal) {
    return getJson<{ timeline: unknown[] }>(`/api/people/${encodeURIComponent(idOrSlug)}/timeline`, signal);
  },

  evidence(idOrSlug: string, signal?: AbortSignal) {
    return getJson<{ evidence: unknown[] }>(`/api/people/${encodeURIComponent(idOrSlug)}/evidence`, signal);
  },

  facets(signal?: AbortSignal) {
    return getJson<Record<string, unknown>>(`/api/facets`, signal);
  },

  /**
   * Database counts and, critically, whether automatic synchronisation is
   * actually running — so the UI can report the truth rather than assume it.
   */
  status(signal?: AbortSignal) {
    return getJson<{
      counts: Record<string, number>;
      sources: Array<Record<string, unknown>>;
      automaticSyncOperational: boolean;
    }>(`/api/status`, signal);
  },
};

/* ==========================================================================
   Corrections — the one write
   ========================================================================== */

export interface CorrectionSubmissionResult {
  id: string;
  reviewStatus: "open";
  /** The server matched an identical open report; this is that report's id. */
  duplicate: boolean;
}

/**
 * A rejection the reporter can act on, as opposed to a transport failure.
 *
 * `retryAfterSeconds` is set only for a 429, from the server's own
 * `retry-after` header (server/api/server.ts sets it on both the per-IP and
 * the site-wide ceiling). "Too many reports" without a number is advice the
 * reporter cannot act on — they either give up or retry immediately into the
 * same wall, and the second is what the limit exists to prevent.
 */
export class CorrectionRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "CorrectionRejected";
  }
}

/** `retry-after` in delta-seconds. Null unless it is a usable positive number. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/**
 * File a correction report.
 *
 * The ONLY function in this client that is not a GET, and the only write the
 * whole frontend performs. It sends the five fields the reporter filled in
 * and nothing else — not the `currentValue` the page displayed, which the
 * server re-derives from the record itself and would discard anyway (see
 * server/api/corrections.ts), and not the payload's server-set fields.
 *
 * Throws `CorrectionRejected` for a 4xx the reporter can do something about
 * (a bad source URL, a rate limit) carrying the server's own safe message,
 * and a plain `Error` for anything else — the caller shows the first and
 * reports the second as a failure to reach the service, because telling
 * someone their report was filed when it was not is the exact failure this
 * whole feature was built to avoid.
 */
export async function submitCorrection(
  input: {
    entityId: string;
    fieldName: string;
    proposedValue: string;
    supportingSourceUrl: string;
    explanation: string;
  },
  signal?: AbortSignal,
): Promise<CorrectionSubmissionResult> {
  if (!API_BASE) throw new Error("VITE_API_URL is not configured; corrections cannot be submitted.");

  const response = await fetch(`${API_BASE}/api/corrections`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });

  if (response.ok) return (await response.json()) as CorrectionSubmissionResult;

  let message = "";
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    message = body.message ?? body.error ?? "";
  } catch {
    // A non-JSON error body (a proxy's own 502 page, say) tells the reporter
    // nothing useful and is not worth showing them raw.
  }

  if (response.status >= 400 && response.status < 500) {
    throw new CorrectionRejected(
      response.status,
      message || "The report was not accepted.",
      response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : null,
    );
  }
  throw new Error(`API ${response.status} for /api/corrections`);
}

/* ==========================================================================
   Current government
   ========================================================================== */

/**
 * The server's current-government view.
 *
 * Shaped identically to what `deriveCurrentGovernment()` produces in the
 * browser, because the API computes it with that same function over database
 * rows. The page can therefore render either without caring which it got.
 */

/**
 * Fetch the current government from the API.
 *
 * Only callable when `VITE_API_URL` is set. The page falls back to the bundled
 * derivation otherwise — a government page that showed nothing because no
 * server was running would be worse than one computed from bundled canonical
 * records, and both are derived from the same positions by the same function.
 */
export function fetchCurrentGovernment(signal?: AbortSignal): Promise<ApiCurrentGovernment> {
  return getJson<ApiCurrentGovernment>("/api/government/current", signal);
}
