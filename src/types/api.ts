/**
 * Javora — types for the API client (src/services/apiClient.ts).
 *
 * SCOPED TO WHAT IS ACTUALLY CONSUMED. `apiClient.ts`'s `api.person`,
 * `api.positions`, `api.timeline`, `api.evidence`, `api.facets` and
 * `api.status` methods have zero callers anywhere in the frontend today —
 * verified by search. Their underlying server functions
 * (server/api/queries.ts's `getPerson` and friends) return object literals
 * built from nine independent, loosely-typed SQL query results with no
 * existing hand-written interface to mirror. Inventing a precise type for an
 * unconsumed method, by reverse-engineering those queries, risks producing
 * an interface that LOOKS authoritative but silently drifts from the real
 * row shapes the first time a column changes — worse than the honest
 * `unknown` it would replace. Those six methods keep their existing types.
 *
 * `fetchCurrentGovernment()` is different: GovernmentPage.jsx genuinely
 * consumes `ApiCurrentGovernment`'s fields, and an exact, already-correct
 * type already exists for them — `CurrentGovernment` in
 * src/lib/currentGovernment.ts, which this API response is "shaped
 * identically" to by construction (the API computes it by calling the same
 * `deriveCurrentGovernment()` the browser calls, over database rows instead
 * of bundled ones). So this file is that type, not an invented one.
 */

import type { CurrentGovernment } from "../lib/currentGovernment.ts";

export interface ApiGovernmentSource {
  sourceId: string;
  name: string;
  lastSuccessfulSyncAt: string | null;
  lastCheckedAt: string | null;
  state: string;
  lastError: string | null;
}

export interface ApiCurrentGovernment extends CurrentGovernment {
  updatedAt: string | null;
  sources: ApiGovernmentSource[];
  allSourcesHealthy: boolean;
  totalPeople: number;
}
