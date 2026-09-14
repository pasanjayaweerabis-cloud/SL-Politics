/**
 * Javora — the current-government API query.
 *
 * Reads canonical rows and hands them to the shared derivation in
 * `src/lib/currentGovernment.ts`. There is no separate government table and no
 * curated list: membership is computed from positions that have not ended, so
 * a minister removed from the Cabinet Office roster leaves this response on
 * the next sync without anyone editing anything.
 *
 * The response deliberately carries person IDS and slugs rather than whole
 * person records. The Current Government page is an entry point, not a second
 * profile system — every card links to `/person/<slug>`, which is the one
 * canonical profile.
 *
 * SOURCE HEALTH IS REPORTED, NOT ASSUMED
 *
 * `updatedAt` is the most recent SUCCESSFUL check across the sources this view
 * depends on, and `sources[]` carries each one's own state. If the Cabinet
 * Office is unreachable the canonical data is untouched and still served — the
 * response says a source is stale rather than pretending everything is fresh
 * or blanking the Cabinet.
 */

import type { CanonicalStore } from "../db/store.ts";
import {
  deriveCurrentGovernment, governmentSize,
  type CurrentGovernment, type GovPerson, type GovPosition,
} from "../../src/lib/currentGovernment.ts";

/** Sources this view actually depends on. */
export const GOVERNMENT_SOURCE_IDS = ["S006", "S001"] as const;

export interface SourceHealth {
  sourceId: string;
  name: string;
  /** Last check that succeeded. Null when the source has never been read. */
  lastSuccessfulSyncAt: string | null;
  /** Last check of any kind, successful or not. */
  lastCheckedAt: string | null;
  /** "ok" | "stale" | "failing" | "never-synced" */
  state: string;
  lastError: string | null;
}

export interface CurrentGovernmentResponse extends CurrentGovernment {
  /**
   * The most recent successful check across the sources this view depends on.
   * Null when none has ever succeeded — never a fabricated timestamp.
   */
  updatedAt: string | null;
  sources: SourceHealth[];
  /** True only when every dependency's last check succeeded. */
  allSourcesHealthy: boolean;
  totalPeople: number;
}

/**
 * How stale a source may be before the page says so.
 *
 * Generous on purpose: a Cabinet roster that has not changed in a week is
 * normal, and crying "stale" at every quiet period would train readers to
 * ignore the indicator.
 */
const STALE_AFTER_HOURS = 48;

function healthFor(store: CanonicalStore, todayIso: string): SourceHealth[] {
  const rows = store.database.all<{
    id: string;
    name: string;
    last_checked_at: string | null;
    last_successful_sync_at: string | null;
  }>(
    `SELECT id, name, last_checked_at, last_successful_sync_at
       FROM source WHERE id IN (${GOVERNMENT_SOURCE_IDS.map(() => "?").join(",")})`,
    [...GOVERNMENT_SOURCE_IDS],
  );

  return rows.map((row) => {
    const lastError = store.database.all<{ error_message: string | null }>(
      `SELECT error_message FROM sync_run
        WHERE source_id = ? AND outcome = 'failed'
        ORDER BY started_at DESC LIMIT 1`,
      [row.id],
    )[0]?.error_message ?? null;

    let state: string;
    if (!row.last_successful_sync_at) {
      state = "never-synced";
    } else if (row.last_checked_at && row.last_checked_at > row.last_successful_sync_at) {
      // A check happened after the last success: the most recent attempt failed.
      state = "failing";
    } else {
      const ageHours =
        (Date.parse(todayIso) - Date.parse(row.last_successful_sync_at)) / 3_600_000;
      state = Number.isFinite(ageHours) && ageHours > STALE_AFTER_HOURS ? "stale" : "ok";
    }

    return {
      sourceId: row.id,
      name: row.name,
      lastCheckedAt: row.last_checked_at,
      lastSuccessfulSyncAt: row.last_successful_sync_at,
      state,
      lastError: state === "failing" ? lastError : null,
    };
  });
}

export function getCurrentGovernment(
  store: CanonicalStore,
  today?: string,
): CurrentGovernmentResponse {
  const todayIso = today ?? new Date().toISOString();

  /*
   * Only OPEN positions are loaded. Closing a position during sync is what
   * removes someone from this page, so a query that ignored `end_date` would
   * quietly defeat the whole mechanism.
   */
  const positions = store.database.all<{
    id: string;
    person_id: string;
    title: string;
    role_type: string;
    institution: string;
    ministry: string | null;
    start_date: string | null;
    end_date: string | null;
    current_as_of: string | null;
    precedence: number;
    canonical_source_id: string | null;
  }>(
    `SELECT id, person_id, title, role_type, institution, ministry,
            start_date, end_date, current_as_of, precedence, canonical_source_id
       FROM position
      WHERE end_date IS NULL`,
  );

  const personIds = [...new Set(positions.map((p) => p.person_id))];
  const people: GovPerson[] = personIds.length
    ? store.database
        .all<{
          id: string;
          slug: string;
          canonical_name: string;
          portrait_url: string | null;
          portrait_credit: string | null;
        }>(
          `SELECT id, slug, canonical_name, portrait_url, portrait_credit
             FROM person WHERE id IN (${personIds.map(() => "?").join(",")})`,
          personIds,
        )
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          canonicalName: r.canonical_name,
          portraitUrl: r.portrait_url,
          portraitCredit: r.portrait_credit,
        }))
    : [];

  const government = deriveCurrentGovernment(
    people,
    positions.map<GovPosition>((p) => ({
      id: p.id,
      personId: p.person_id,
      title: p.title,
      roleType: p.role_type,
      institution: p.institution,
      ministry: p.ministry,
      startDate: p.start_date,
      endDate: p.end_date,
      currentAsOf: p.current_as_of,
      precedence: p.precedence,
      sourceId: p.canonical_source_id,
    })),
    todayIso,
  );

  const sources = healthFor(store, todayIso);
  const successes = sources
    .map((s) => s.lastSuccessfulSyncAt)
    .filter((v): v is string => Boolean(v))
    .sort();

  return {
    ...government,
    // The newest successful check, or null. Never invented.
    updatedAt: successes.length ? successes[successes.length - 1]! : null,
    sources,
    allSourcesHealthy: sources.every((s) => s.state === "ok"),
    totalPeople: governmentSize(government),
  };
}
