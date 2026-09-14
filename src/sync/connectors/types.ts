/**
 * Javora — source connector contract.
 *
 * Every official source Javora reads is wrapped in a connector implementing
 * the same four stages, so the pipeline treats Parliament, the Cabinet
 * Office and the Election Commission identically:
 *
 *   fetch()     → retrieve raw payload(s) from the official source
 *   parse()     → raw payload → source-shaped rows (still the source's own vocabulary)
 *   normalise() → source rows → Javora's canonical model
 *   validate()  → assert invariants; return problems rather than throwing them away
 *
 * The split matters. `parse` stays in the source's vocabulary ("Jathika Jana
 * balawegaya", "Mahanuwara") so a parsing change is never confused with a
 * vocabulary-mapping change; `normalise` is the only place source vocabulary
 * is translated into Javora ids, and it reports anything it could not map
 * instead of silently dropping it.
 *
 * `fetch` is deliberately the only async, network-touching stage — the other
 * three are pure functions over data, which is what makes them testable
 * without a network or a browser.
 */

import type { DateString } from "../../types/models.ts";

/** One retrieved document, before it becomes a stored snapshot. */
export interface FetchedDocument {
  url: string;
  /** Raw payload exactly as retrieved. */
  body: string;
  retrievedAt: string;
  contentHash: string;
}

export interface ValidationProblem {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Which record the problem concerns, where identifiable. */
  subject: string | null;
}

export interface ValidationResult {
  ok: boolean;
  problems: ValidationProblem[];
}

/**
 * A connector for one official source.
 *
 * `TRow` is the source's own row shape; `TNormalised` is whatever canonical
 * bundle this source produces.
 */
export interface SourceConnector<TRow, TNormalised> {
  /** Matches an `InstitutionalSource.id` in `data/sources.ts`. */
  readonly sourceId: string;
  /** Bumped whenever parsing changes, so snapshots record how they were read. */
  readonly parserVersion: string;

  fetch(): Promise<FetchedDocument[]>;
  parse(documents: FetchedDocument[]): TRow[];
  normalise(rows: TRow[], retrievedAt: DateString): TNormalised;
  validate(rows: TRow[]): ValidationResult;
}
