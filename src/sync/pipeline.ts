/**
 * Javora — synchronisation pipeline: contracts for stages 1–3.
 *
 *   OFFICIAL SOURCE → FETCH → SNAPSHOT → CHANGE DETECTION → ...
 *
 * This module, `positionUpdate.ts` and `identityReview.ts` together are the
 * foundation the product brief asks for: the shape a real ingestion pipeline
 * will fill in, with the parts that don't need a network connection (change
 * detection, duplicate-import prevention, history-preserving updates,
 * identity review) implemented and tested now.
 *
 * WHAT IS **NOT** HERE, AND WHY: no `SourceConnector` for any real
 * institution ships in this repository, and nothing calls `fetch()` against
 * an official website. Reading Parliament of Sri Lanka, the Election
 * Commission, or the Government Gazette correctly — respecting robots.txt and
 * rate limits, handling each site's actual markup, and having a human verify
 * the very first import before it writes anything — is a project in its own
 * right, done once per source, not something to fake with a stub that
 * happens to return demonstration data. Building one is the natural next
 * step after this foundation; see the README's "What remains" section.
 *
 * Because no connector runs, `InstitutionalSource.syncState` stays
 * `"not-connected"` for every source in `data/sources.ts`, and no
 * `lastCheckedAt`/`lastSuccessfulSyncAt` timestamp is ever set. The interface
 * must not claim a sync that isn't happening.
 */

import type { SourceSnapshot } from "../types/models.ts";

/** The result of stage 1 (FETCH), before it becomes a stored `SourceSnapshot`. */
export interface RawFetch {
  sourceId: string;
  url: string;
  fetchedAt: string;
  statusCode: number;
  body: string;
}

/**
 * What a connector for one official source must implement to plug into this
 * pipeline. See the module comment: no concrete implementation exists yet.
 */
export interface SourceConnector {
  sourceId: string;
  fetch(): Promise<RawFetch>;
}

export type ChangeReason = "first-fetch" | "content-changed" | "unchanged";

/**
 * Stage 3: has this fetch actually changed since the last snapshot for the
 * source?
 *
 * Compares content hashes rather than re-parsing — computing the hash is the
 * caller's job; this just compares two already-computed values.
 *
 * HASH THE PARSED DATA, NOT THE RAW BYTES. This is not a style preference,
 * it is a correctness requirement learned from the live source: every page
 * of the Parliament of Sri Lanka directory embeds a freshly generated CSRF
 * token, so byte-identical content produces a different hash on every
 * request. A raw-bytes hash there reports "changed" on every check forever,
 * which would fire an endless stream of spurious change events and make the
 * whole audit trail worthless. `scripts/import-parliament.mjs` therefore
 * hashes the canonically ordered parsed rows, and any future connector
 * should do the same — dynamic tokens, timestamps, view counters and
 * rotating banners are the norm on public sites, not the exception.
 */
export function detectChange(
  previous: SourceSnapshot | null,
  next: Pick<SourceSnapshot, "contentHash">,
): { changed: boolean; reason: ChangeReason } {
  if (!previous) return { changed: true, reason: "first-fetch" };
  if (previous.contentHash !== next.contentHash) return { changed: true, reason: "content-changed" };
  return { changed: false, reason: "unchanged" };
}

/**
 * Stage 3b: has this exact snapshot already been imported?
 *
 * A scheduled re-check that finds nothing new must not re-run
 * normalisation/validation/update — that would write duplicate `ChangeEvent`
 * rows for a change that never happened. Import history is keyed on
 * (sourceId, contentHash): the same bytes from the same source, however many
 * times they're re-fetched, are one import.
 */
export function isDuplicateImport(
  imported: readonly Pick<SourceSnapshot, "sourceId" | "contentHash">[],
  candidate: Pick<SourceSnapshot, "sourceId" | "contentHash">,
): boolean {
  return imported.some(
    (s) => s.sourceId === candidate.sourceId && s.contentHash === candidate.contentHash,
  );
}

/**
 * Whether two or more sourced values for the same fact actually disagree.
 *
 * Deliberately generic and deliberately simple (structural equality via
 * JSON, which is exact for the primitive and plain-object values every field
 * in this domain model actually holds). A single value, or several sources
 * agreeing, is not a conflict; two or more distinct values is — and the
 * caller is expected to raise the claim to `CONFLICTING` rather than picking
 * one silently, per the verification model in `lib/verification.ts`.
 */
export interface SourcedValue<T> {
  value: T;
  sourceId: string;
}

export function detectFieldConflict<T>(values: readonly SourcedValue<T>[]): boolean {
  if (values.length < 2) return false;
  const distinct = new Set(values.map((v) => JSON.stringify(v.value)));
  return distinct.size > 1;
}
