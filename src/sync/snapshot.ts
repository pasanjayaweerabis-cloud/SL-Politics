/**
 * Javora — source snapshots and content hashing.
 *
 * Every retrieval from an official source produces a snapshot: the URL, the
 * moment it was retrieved, a hash of exactly what came back, and the parser
 * version that read it. Snapshots are append-only — a new retrieval never
 * replaces the previous snapshot, because the previous one is the only
 * evidence of what the source used to say.
 */

import type { SourceSnapshot } from "../types/models.ts";

/**
 * FNV-1a, 32-bit, hex-encoded.
 *
 * Deliberately NOT cryptographic. Its only job is change detection: did this
 * source return different bytes than last time? For that, a fast
 * dependency-free hash over official government pages is adequate, and the
 * failure mode of a collision is a missed update that the next run catches,
 * not a security breach.
 *
 * A production worker reading sources over a network it does not control
 * should upgrade this to SHA-256 via `crypto.subtle.digest` — the pipeline
 * only ever compares hashes for equality, so swapping the algorithm is a
 * change to this function alone.
 */
export function contentHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    // FNV prime 16777619, via shifts to stay in 32-bit integer range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

let snapshotCounter = 0;

export function makeSnapshot(input: {
  sourceId: string;
  url: string;
  content: string;
  retrievedAt: string;
  parserVersion: string;
  storageReference?: string;
}): SourceSnapshot {
  return {
    id: `SNAP-${String(++snapshotCounter).padStart(5, "0")}`,
    sourceId: input.sourceId,
    retrievedAt: input.retrievedAt,
    url: input.url,
    contentHash: contentHash(input.content),
    // Where the raw payload itself is kept. Snapshots record a pointer, not
    // the bytes — a blob store is the right home for hundreds of MB of
    // retrieved HTML, not a row in a table or a JSON file in a git repo.
    storageReference: input.storageReference ?? `unstored:${input.url}`,
    parserVersion: input.parserVersion,
  };
}

/**
 * The snapshot history for a source, newest first.
 *
 * An in-memory implementation of the contract a real snapshot table will
 * satisfy. Append-only by construction: there is no update or delete.
 */
export class SnapshotLog {
  private readonly snapshots: SourceSnapshot[] = [];

  append(snapshot: SourceSnapshot): SourceSnapshot {
    this.snapshots.push(snapshot);
    return snapshot;
  }

  /** The most recent snapshot for a source, or null if never retrieved. */
  latestFor(sourceId: string): SourceSnapshot | null {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i]!.sourceId === sourceId) return this.snapshots[i]!;
    }
    return null;
  }

  /** Full history for a source, oldest first. Never pruned. */
  historyFor(sourceId: string): SourceSnapshot[] {
    return this.snapshots.filter((s) => s.sourceId === sourceId);
  }

  get size(): number {
    return this.snapshots.length;
  }

  all(): readonly SourceSnapshot[] {
    return this.snapshots;
  }
}
