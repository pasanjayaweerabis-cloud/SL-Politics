/**
 * Javora — the synchronisation job.
 *
 *   FETCH → SNAPSHOT → CHANGE DETECTION → PARSE → NORMALISE →
 *   IDENTITY RESOLUTION → VALIDATE → RECONCILE → CANONICAL WRITE → HISTORY
 *
 * Two properties this job is built around:
 *
 * IT NEVER DESTROYS DATA ON FAILURE. A fetch that times out, a parse that
 * breaks, a source that returns a 500 — each is recorded as a failed
 * `sync_run` with its error, and the canonical records are left exactly as
 * they were. The site keeps serving the last known good state. The failure
 * mode of a broken government website must not be an empty directory.
 *
 * IT NEVER OVERWRITES HISTORY. When a source reports a different office for
 * someone who already holds one, the existing position is CLOSED (an end date
 * is written) and a NEW position is inserted. Both rows survive. See
 * `applyPositionFacts`.
 */

import { randomUUID } from "node:crypto";
import type { CanonicalStore } from "../db/store.ts";
import { detectChange } from "../../src/sync/pipeline.ts";
import { contentHash } from "../../src/sync/snapshot.ts";
import { positionIdFor, evidenceIdFor } from "../../src/sync/importRun.ts";
import { resolveIdentity, type IdentityCandidate } from "../../src/lib/identity.ts";
import { reviewItemFor } from "../../src/sync/identityReview.ts";
import { reconcileClaims, sameOfficeLikely } from "./reconcile.ts";
import type { ValidationProblem } from "../../src/sync/connectors/types.ts";
import type { FactType } from "../../src/types/models.ts";
import { fetchWithRetry, type RetryOptions } from "./retry.ts";

/* ==========================================================================
   What a connector must hand the job
   ========================================================================== */

/** One person plus the offices a source says they hold, already normalised. */
export interface NormalisedPerson {
  /** The source's own identifier for this person. */
  externalId: string;
  externalIdKey: string;
  canonicalName: string;
  slug: string;
  aliases?: string[];
  /** `undefined` = this run did not look at the field; `null` = the source has no value. */
  dateOfBirth?: string | null | undefined;
  biography?: string | null | undefined;
  portraitUrl?: string | null | undefined;
  /** Profession as the source states it. NOT an employment record. */
  profession?: string | null | undefined;
  /**
   * Whether the portrait may lawfully be displayed. Defaults to unknown, and
   * the UI shows a monogram unless rights are actually established.
   */
  portraitRights?: "public-domain" | "licensed" | "all-rights-reserved" | "unknown";
  portraitRightsNote?: string | null;
  portraitCredit?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  partyAbbreviation?: string | null;
  districtId?: string | null;
  districtName?: string | null;
  searchText?: string;
  /** The exact page this person's facts came from. */
  sourceUrl: string;
  positions: NormalisedPosition[];
}

export interface NormalisedPosition {
  title: string;
  roleType: string;
  institution: string;
  ministry?: string | null;
  districtId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  currentAsOf?: string | null;
  precedence?: number;
  factType: FactType;
  /**
   * Offices whose incumbent can change without the office itself ending —
   * a ministerial portfolio. Reshuffles supersede within this slot.
   * Membership of Parliament is not one: it does not get replaced by a
   * different membership.
   */
  supersedable?: boolean;
}

export interface ConnectorRun {
  sourceId: string;
  connectorVersion: string;
  parserVersion: string;
  url: string;
  fetch(): Promise<{
    retrievedAt: string;
    /** Canonical, order-stable serialisation of the parsed records. */
    canonicalPayload: string;
    /** Hash of the raw bytes, where meaningful for this source. */
    rawContentHash?: string | null;
    rawHashIsStable?: boolean;
    people: NormalisedPerson[];
    problems?: ValidationProblem[];
  }>;
}

export interface SyncOptions {
  trigger?: "scheduled" | "manual" | "backfill" | "retry";
  /** Re-apply even when the source's parsed content is unchanged. */
  force?: boolean;
  /** Decide and report, but write nothing. */
  dryRun?: boolean;
  now?: () => string;
  /**
   * Timeout and retry for the FETCH step only. Defaults chosen for a
   * once-every-few-hours cron-style call, not a latency-sensitive one: a
   * source that is merely slow should still succeed, so the timeout is
   * generous, and three attempts absorb one dropped connection without
   * turning a single blip into a failed run and a change-events-delayed
   * source.
   */
  retry?: Partial<RetryOptions>;
  onFetchAttempt?: (attempt: number, error: unknown | null) => void;
}

const DEFAULT_RETRY: RetryOptions = {
  timeoutMs: 30_000,
  attempts: 3,
  backoffMs: 2_000,
};

export interface SyncResult {
  runId: string;
  sourceId: string;
  outcome: "unchanged" | "applied" | "dry-run" | "failed";
  startedAt: string;
  finishedAt: string;
  snapshotId: string | null;
  contentHash: string | null;
  changed: boolean;
  changeReason: string;
  counts: { seen: number; created: number; updated: number; unchanged: number };
  changeEventIds: string[];
  positionsClosed: number;
  positionsOpened: number;
  identityReviews: number;
  conflicts: number;
  problems: ValidationProblem[];
  /** Records rejected this run — malformed, or failed to write — and excluded from `counts`. */
  skipped: number;
  error: string | null;
}

/* ==========================================================================
   The job
   ========================================================================== */

export async function syncSource(
  store: CanonicalStore,
  connector: ConnectorRun,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const nowFn = options.now ?? (() => new Date().toISOString());
  const trigger = options.trigger ?? "manual";
  const runId = `RUN-${randomUUID()}`;
  const startedAt = nowFn();

  const result: SyncResult = {
    runId,
    sourceId: connector.sourceId,
    outcome: "failed",
    startedAt,
    finishedAt: startedAt,
    snapshotId: null,
    contentHash: null,
    changed: false,
    changeReason: "",
    counts: { seen: 0, created: 0, updated: 0, unchanged: 0 },
    changeEventIds: [],
    positionsClosed: 0,
    positionsOpened: 0,
    identityReviews: 0,
    conflicts: 0,
    problems: [],
    skipped: 0,
    error: null,
  };

  store.startRun({ id: runId, sourceId: connector.sourceId, trigger, startedAt });

  // ---- 1. FETCH ----------------------------------------------------------
  // Timeout per attempt, retried with backoff — a stuck connection or one
  // dropped request must not cost a whole cycle when the source is actually
  // fine a few seconds later.
  const retryOptions: RetryOptions = { ...DEFAULT_RETRY, ...options.retry };
  let fetched: Awaited<ReturnType<ConnectorRun["fetch"]>>;
  try {
    fetched = await fetchWithRetry(() => connector.fetch(), retryOptions, options.onFetchAttempt);
  } catch (error) {
    // The source is unreachable or broken. Record it and change NOTHING.
    // Canonical data is not touched; the site keeps serving what it has.
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = nowFn();
    const snapshotId = `SNAP-${randomUUID()}`;

    store.insertSnapshot({
      id: snapshotId,
      sourceId: connector.sourceId,
      url: connector.url,
      retrievedAt: finishedAt,
      contentHash: "",
      connectorVersion: connector.connectorVersion,
      parserVersion: connector.parserVersion,
      status: "fetch-failed",
      errorMessage: message,
    });
    store.markSourceChecked(connector.sourceId, finishedAt, false);
    store.finishRun(runId, { outcome: "failed", finishedAt, snapshotId, errorMessage: message });

    return { ...result, outcome: "failed", finishedAt, snapshotId, error: message };
  }

  result.problems = fetched.problems ?? [];

  // ---- 2. SNAPSHOT + 3. CHANGE DETECTION --------------------------------
  // Hashing the PARSED payload, not the raw bytes: see the note in
  // src/sync/pipeline.ts about per-request tokens.
  const hash = contentHash(fetched.canonicalPayload);
  const previous = store.latestSnapshot(connector.sourceId);
  const change = detectChange(previous ? { contentHash: previous.content_hash } as never : null, {
    contentHash: hash,
  });

  result.contentHash = hash;
  result.changed = change.changed;
  result.changeReason = change.reason;

  const snapshotId = `SNAP-${randomUUID()}`;
  const retrievedAt = fetched.retrievedAt;

  if (!options.dryRun) {
    store.insertSnapshot({
      id: snapshotId,
      sourceId: connector.sourceId,
      url: connector.url,
      retrievedAt,
      contentHash: hash,
      rawContentHash: fetched.rawContentHash ?? null,
      rawHashIsStable: fetched.rawHashIsStable ?? false,
      connectorVersion: connector.connectorVersion,
      parserVersion: connector.parserVersion,
      status: "ok",
      recordCount: fetched.people.length,
    });
    store.markSourceChecked(connector.sourceId, retrievedAt, true);
  }
  result.snapshotId = options.dryRun ? null : snapshotId;

  // Unchanged content: the snapshot is still recorded (proof the source was
  // checked and said the same thing), but no parsing or writing happens.
  if (!change.changed && !options.force) {
    const finishedAt = nowFn();
    if (!options.dryRun) {
      store.finishRun(runId, { outcome: "unchanged", finishedAt, snapshotId, seen: fetched.people.length });
    }
    return { ...result, outcome: "unchanged", finishedAt };
  }

  // ---- 4–9. APPLY --------------------------------------------------------
  try {
    const applied = store.transaction(() =>
      applyPeople(store, connector, fetched.people, {
        snapshotId: options.dryRun ? null : snapshotId,
        runId,
        retrievedAt,
        dryRun: Boolean(options.dryRun),
      }),
    );

    // Concatenated, not overwritten: `result.problems` may already carry
    // connector-level problems (e.g. "cabinet-empty") from the fetch step,
    // and `applied.problems` carries the per-record ones found while writing.
    // A plain Object.assign would let the second silently discard the first.
    Object.assign(result, applied, { problems: [...result.problems, ...applied.problems] });
    const finishedAt = nowFn();
    const outcome = options.dryRun ? "dry-run" : "applied";

    if (applied.skipped > 0) {
      // Not a failure — the run still applied everyone it could — but a
      // batch that silently dropped records is exactly what must never
      // happen invisibly. This is the one line an operator watching logs
      // needs to see it.
      console.error(
        `[sync] ${connector.sourceId}: ${applied.skipped} record(s) rejected this run — see result.problems`,
      );
    }

    if (!options.dryRun) {
      store.finishRun(runId, {
        outcome,
        finishedAt,
        snapshotId,
        seen: applied.counts.seen,
        created: applied.counts.created,
        updated: applied.counts.updated,
        unchanged: applied.counts.unchanged,
        errorMessage: applied.skipped > 0 ? `${applied.skipped} record(s) rejected — see problems` : null,
      });
    }
    return { ...result, outcome, finishedAt };
  } catch (error) {
    // A parse/apply failure rolls back the transaction: canonical data is
    // left exactly as it was before this run started.
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = nowFn();
    store.finishRun(runId, { outcome: "failed", finishedAt, snapshotId, errorMessage: message });
    return { ...result, outcome: "failed", finishedAt, error: message };
  }
}

/* ==========================================================================
   Per-record validation
   ========================================================================== */

/**
 * Reject a record that is not fit to write, without rejecting the batch it
 * arrived in.
 *
 * "Do not accept malformed source data silently" does not mean "throw and
 * abort" — a parser that occasionally emits one bad row (a name field the
 * markup fragmented, a position with no title) must not cost every OTHER
 * person in that day's fetch. Every problem returned here is recorded on the
 * run and is visible in `SyncResult.problems`; nothing is dropped invisibly.
 */
function validatePerson(person: NormalisedPerson): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const subject = person.canonicalName?.trim() || person.externalId || "(unidentified record)";

  if (!person.externalId?.trim()) {
    problems.push({ severity: "error", code: "missing-external-id", message: "record has no external id", subject });
  }
  if (!person.externalIdKey?.trim()) {
    problems.push({ severity: "error", code: "missing-external-id-key", message: "record has no external id namespace", subject });
  }
  if (!person.canonicalName?.trim()) {
    problems.push({ severity: "error", code: "missing-name", message: "record has no canonical name", subject });
  }
  if (!person.slug?.trim()) {
    problems.push({ severity: "error", code: "missing-slug", message: "record has no slug", subject });
  }
  if (!person.sourceUrl?.trim() || !/^https?:\/\//i.test(person.sourceUrl)) {
    problems.push({ severity: "error", code: "invalid-source-url", message: `not an absolute URL: ${JSON.stringify(person.sourceUrl)}`, subject });
  }

  person.positions.forEach((position, index) => {
    if (!position.title?.trim()) {
      problems.push({ severity: "error", code: "missing-position-title", message: `position ${index} has no title`, subject });
    }
    if (!position.roleType?.trim()) {
      problems.push({ severity: "error", code: "missing-position-role-type", message: `position ${index} ("${position.title}") has no role type`, subject });
    }
    if (!position.institution?.trim()) {
      problems.push({ severity: "error", code: "missing-position-institution", message: `position ${index} ("${position.title}") has no institution`, subject });
    }
    if (position.startDate && position.endDate && position.endDate < position.startDate) {
      problems.push({ severity: "error", code: "end-before-start", message: `position ${index} ("${position.title}") ends before it starts`, subject });
    }
  });

  return problems;
}

/* ==========================================================================
   Applying normalised people
   ========================================================================== */

function applyPeople(
  store: CanonicalStore,
  connector: ConnectorRun,
  people: NormalisedPerson[],
  ctx: { snapshotId: string | null; runId: string; retrievedAt: string; dryRun: boolean },
) {
  const counts = { seen: 0, created: 0, updated: 0, unchanged: 0 };
  const changeEventIds: string[] = [];
  const problems: ValidationProblem[] = [];
  let positionsClosed = 0;
  let positionsOpened = 0;
  let identityReviews = 0;
  let conflicts = 0;
  let skipped = 0;

  const actor = `pipeline:${connector.sourceId}`;
  /** Canonical ids this run actually saw, for the supersession pass below. */
  const seenPersonIds = new Set<string>();

  for (const incoming of people) {
    counts.seen++;

    // ---- VALIDATE ---------------------------------------------------------
    // Rejected here, before anything is written, and — critically — before
    // this person is looked up: a record with no external id cannot be
    // matched to anyone, so there is nothing further to protect.
    const recordProblems = validatePerson(incoming);
    if (recordProblems.some((p) => p.severity === "error")) {
      problems.push(...recordProblems);
      skipped++;
      // If we can still identify WHO this bad record was about, mark them
      // seen anyway. Otherwise the "no longer reported" pass below would read
      // a parser failure as "this person left office" and close their real,
      // still-current position over a malformed row — exactly the incorrect
      // overwrite this pipeline exists to prevent.
      if (incoming.externalIdKey && incoming.externalId) {
        const known = store.findPersonByExternalId(incoming.externalIdKey, incoming.externalId);
        if (known) seenPersonIds.add(known);
      }
      continue;
    }

    // ---- APPLY (guarded) ---------------------------------------------------
    // A record that passed validation can still fail to write — a database
    // constraint, an unexpected value shape. That failure must cost only this
    // one person, not the run: the try/catch boundary is per-record, not
    // per-batch, which is what lets 99 good records commit alongside one
    // record that throws instead of rolling all 100 back.
    try {
      applyOnePerson(store, connector, incoming, ctx, actor, counts, changeEventIds, seenPersonIds, {
        onIdentityReview: () => identityReviews++,
        onPositionsChanged: (opened, closed, conflictCount) => {
          positionsOpened += opened;
          positionsClosed += closed;
          conflicts += conflictCount;
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push({
        severity: "error",
        code: "apply-failed",
        message: `failed to apply record: ${message}`,
        subject: incoming.canonicalName || incoming.externalId,
      });
      skipped++;
      // Same reasoning as the validation-failure branch: preserve the
      // person's existing positions rather than reading a write failure as
      // "the source no longer reports this office".
      seenPersonIds.add(`${incoming.externalIdKey}:${incoming.externalId}`);
      const resolved = store.findPersonByExternalId(incoming.externalIdKey, incoming.externalId);
      if (resolved) seenPersonIds.add(resolved);
    }
  }

  // ---- PEOPLE THE SOURCE NO LONGER REPORTS AT ALL ------------------------
  //
  // `applyOnePerson` only ever runs for people PRESENT in this payload,
  // so it can close an office someone lost in a reshuffle — but not one they
  // lost by leaving the roster entirely. Without this pass a minister dropped
  // from the Cabinet keeps their portfolio open for ever, and the Current
  // Government page keeps showing them.
  //
  // Two cases, one rule:
  //   · a minister replaced by someone else — the old holder vanishes
  //   · a minister who simply leaves government
  //
  // Both mean the office ENDED for them. Neither means the person or their
  // history stops existing: `closePosition` writes an end date and nothing
  // else, so the record moves from current to historical and stays on their
  // profile and in the Directory.
  //
  // Restricted to positions this source is canonical for, and to supersedable
  // offices. A Cabinet Office run must never close a parliamentary seat: it
  // has no authority over parliamentary membership and does not report it.
  const closures = closeUnreportedPositions(store, connector, seenPersonIds, ctx, actor);
  positionsClosed += closures.closed;
  changeEventIds.push(...closures.changeEventIds);

  return { counts, changeEventIds, positionsClosed, positionsOpened, identityReviews, conflicts, problems, skipped };
}

/**
 * The per-person write path, split out of `applyPeople` so the surrounding
 * loop can wrap exactly one person's work in a try/catch without the
 * indentation of the whole function shifting a level.
 */
function applyOnePerson(
  store: CanonicalStore,
  connector: ConnectorRun,
  incoming: NormalisedPerson,
  ctx: { snapshotId: string | null; runId: string; retrievedAt: string; dryRun: boolean },
  actor: string,
  counts: { seen: number; created: number; updated: number; unchanged: number },
  changeEventIds: string[],
  seenPersonIds: Set<string>,
  callbacks: {
    onIdentityReview: () => void;
    onPositionsChanged: (opened: number, closed: number, conflicts: number) => void;
  },
): void {
  {
    // ---- IDENTITY RESOLUTION --------------------------------------------
    // The safe path first: an exact external-id match inside this source's
    // own id-space. Only that is allowed to merge automatically.
    let personId = store.findPersonByExternalId(incoming.externalIdKey, incoming.externalId);

    if (!personId) {
      // No id match. Before creating a new person, check whether an existing
      // record looks like the same human — and if it might be, park it for
      // review rather than either merging or silently duplicating.
      const candidates = store.database.all<{ id: string; canonical_name: string; date_of_birth: string | null }>(
        `SELECT id, canonical_name, date_of_birth FROM person WHERE canonical_name = ?`,
        [incoming.canonicalName],
      );

      if (candidates.length) {
        const match = resolveIdentity(
          {
            id: incoming.externalId,
            canonicalName: incoming.canonicalName,
            dateOfBirth: incoming.dateOfBirth ?? null,
          },
          candidates.map<IdentityCandidate>((c) => ({
            id: c.id,
            canonicalName: c.canonical_name,
            dateOfBirth: c.date_of_birth,
          })),
        );

        const review = reviewItemFor(match, { canonicalName: incoming.canonicalName }, connector.sourceId, ctx.retrievedAt);
        if (review && !ctx.dryRun) {
          store.insertIdentityReview({
            id: `IDR-${connector.sourceId}-${incoming.externalId}`,
            incomingName: review.incomingName,
            incomingPayload: JSON.stringify({
              externalId: incoming.externalId,
              party: incoming.partyName,
              district: incoming.districtName,
            }),
            candidatePersonId: review.candidatePersonId,
            confidence: review.confidence,
            signals: review.signals,
            sourceId: connector.sourceId,
            detectedAt: ctx.retrievedAt,
          });
          callbacks.onIdentityReview();
        }
      }

      personId = `${incoming.externalIdKey}:${incoming.externalId}`;
    }

    if (ctx.dryRun) return;

    // ---- PARTY / DISTRICT ------------------------------------------------
    if (incoming.partyId && incoming.partyName) {
      store.upsertParty({
        id: incoming.partyId,
        name: incoming.partyName,
        abbreviation: incoming.partyAbbreviation ?? "",
      });
    }
    if (incoming.districtId && incoming.districtName) {
      store.upsertDistrict({ id: incoming.districtId, name: incoming.districtName, province: null });
    }

    // ---- PERSON ----------------------------------------------------------
    const personResult = store.upsertPerson({
      id: personId,
      slug: incoming.slug,
      canonicalName: incoming.canonicalName,
      dateOfBirth: incoming.dateOfBirth,
      biography: incoming.biography,
      portraitUrl: incoming.portraitUrl,
      portraitSourceId: connector.sourceId,
      verification: "source-linked",
      aliases: incoming.aliases ?? [],
      externalIds: { [incoming.externalIdKey]: incoming.externalId },
      searchText: incoming.searchText,
    });

    counts[personResult.outcome]++;

    for (const change of personResult.changes) {
      const id = changeEventId("person", personId, change.fieldName, change.newValue);
      store.insertChangeEvent({
        id,
        entityType: "person",
        entityId: personId,
        fieldName: change.fieldName,
        previousValue: change.previousValue,
        newValue: change.newValue,
        sourceId: connector.sourceId,
        snapshotId: ctx.snapshotId,
        syncRunId: ctx.runId,
        detectedAt: ctx.retrievedAt,
        actor,
      });
      changeEventIds.push(id);
    }

    // Biographical scalars the source states directly.
    store.setPersonBiographical(personId, { profession: incoming.profession });

    // Portrait provenance. Stored regardless of rights; the UI decides
    // whether it may be shown.
    if (incoming.portraitUrl !== undefined) {
      store.setPortrait(personId, {
        url: incoming.portraitUrl ?? null,
        sourceId: connector.sourceId,
        sourceUrl: incoming.sourceUrl,
        credit: incoming.portraitCredit ?? null,
        rights: incoming.portraitRights ?? "unknown",
        rightsNote: incoming.portraitRightsNote ?? null,
        retrievedAt: ctx.retrievedAt,
      });
    }

    // Evidence for the person record itself.
    store.upsertEvidence({
      id: evidenceIdFor({
        sourceId: connector.sourceId,
        entityType: "person",
        entityId: personId,
        fieldName: null,
        sourceUrl: incoming.sourceUrl,
      }),
      sourceId: connector.sourceId,
      entityType: "person",
      entityId: personId,
      sourceUrl: incoming.sourceUrl,
      documentTitle: `${incoming.canonicalName} — official profile`,
      retrievedAt: ctx.retrievedAt,
      sourceRecordId: incoming.externalId,
      snapshotId: ctx.snapshotId,
    });

    // ---- AFFILIATION -----------------------------------------------------
    if (incoming.partyId) {
      const affiliationId = `${personId}@${incoming.partyId}`;
      store.upsertAffiliation({
        id: affiliationId,
        personId,
        partyId: incoming.partyId,
        currentAsOf: ctx.retrievedAt.slice(0, 10),
        verification: "source-linked",
      });
      store.upsertEvidence({
        id: evidenceIdFor({
          sourceId: connector.sourceId,
          entityType: "affiliation",
          entityId: affiliationId,
          fieldName: "partyId",
          sourceUrl: incoming.sourceUrl,
        }),
        sourceId: connector.sourceId,
        entityType: "affiliation",
        entityId: affiliationId,
        fieldName: "partyId",
        sourceUrl: incoming.sourceUrl,
        retrievedAt: ctx.retrievedAt,
        sourceRecordId: incoming.externalId,
        snapshotId: ctx.snapshotId,
      });
    }

    // ---- POSITIONS + HISTORY --------------------------------------------
    seenPersonIds.add(personId);
    const positionOutcome = applyPositionFacts(store, connector, personId, incoming, ctx, actor);
    callbacks.onPositionsChanged(positionOutcome.opened, positionOutcome.closed, positionOutcome.conflicts);
    changeEventIds.push(...positionOutcome.changeEventIds);
  }
}

/**
 * End offices held by people this source has stopped reporting.
 *
 * Deliberately narrow. It only touches positions whose `canonical_source_id`
 * is this connector's source, and only those the source itself marked
 * supersedable when it last reported them — which for the Cabinet Office
 * means portfolios and nothing else.
 */
function closeUnreportedPositions(
  store: CanonicalStore,
  connector: ConnectorRun,
  seenPersonIds: ReadonlySet<string>,
  ctx: { snapshotId: string | null; runId: string; retrievedAt: string; dryRun: boolean },
  actor: string,
): { closed: number; changeEventIds: string[] } {
  const changeEventIds: string[] = [];
  let closed = 0;
  const asOf = ctx.retrievedAt.slice(0, 10);

  const orphaned = store.database.all<{ id: string; person_id: string; title: string; role_type: string }>(
    `SELECT id, person_id, title, role_type
       FROM position
      WHERE end_date IS NULL
        AND canonical_source_id = ?
        AND role_type IN ('president','prime-minister','cabinet-minister',
                          'non-cabinet-minister','state-minister','deputy-minister')`,
    [connector.sourceId],
  );

  for (const row of orphaned) {
    if (seenPersonIds.has(row.person_id)) continue;

    store.closePosition(row.id, asOf, null);
    closed++;

    const evId = changeEventId("position", row.id, "left-government", asOf);
    store.insertChangeEvent({
      id: evId,
      entityType: "position",
      entityId: row.id,
      fieldName: "end_date",
      previousValue: null,
      newValue: asOf,
      changeKind: "office-ended",
      sourceId: connector.sourceId,
      snapshotId: ctx.snapshotId,
      syncRunId: ctx.runId,
      detectedAt: ctx.retrievedAt,
      actor,
    });
    changeEventIds.push(evId);
  }

  return { closed, changeEventIds };
}

/**
 * Write a person's offices, preserving whatever they held before.
 *
 * The supersession rule: for each supersedable slot (a ministerial
 * portfolio), any office currently open under this source's authority that
 * the source NO LONGER reports is closed — not deleted — and the newly
 * reported office is inserted as a separate row. That is the whole of
 * "Minister of X 2024→2026, Minister of Y 2026→present".
 */
function applyPositionFacts(
  store: CanonicalStore,
  connector: ConnectorRun,
  personId: string,
  incoming: NormalisedPerson,
  ctx: { snapshotId: string | null; runId: string; retrievedAt: string; dryRun: boolean },
  actor: string,
) {
  const changeEventIds: string[] = [];
  let closed = 0;
  let opened = 0;
  let conflicts = 0;

  const asOf = ctx.retrievedAt.slice(0, 10);
  const incomingIds = new Set<string>();
  /**
   * Offices newly opened in THIS run, by role type. Used to pair a closing
   * office with the one that replaced it: within a supersedable slot, an
   * office ending in the same run that another opens is a transition, not a
   * coincidence. Pairing on slot rather than on title similarity is what
   * makes "Minister of X → Minister of Y" link correctly — those are two
   * genuinely different portfolios, so no amount of title comparison should
   * call them the same office, yet one plainly replaced the other.
   */
  const openedByRoleType = new Map<string, string[]>();

  for (const position of incoming.positions) {
    const id = positionIdFor(personId, position.title);
    incomingIds.add(id);

    const before = store.getPosition(id);

    const outcome = store.upsertPosition({
      id,
      personId,
      title: position.title,
      roleType: position.roleType,
      institution: position.institution,
      // Passed through UNFLATTENED. `?? null` here would destroy the
      // undefined/null distinction before `upsertPosition` could act on it,
      // making its preservation logic unreachable — a run that simply did
      // not carry a ministry would erase the one already recorded.
      ministry: position.ministry,
      districtId: position.districtId,
      startDate: position.startDate,
      endDate: position.endDate,
      currentAsOf: position.currentAsOf ?? asOf,
      precedence: position.precedence ?? 99,
      verification: "source-linked",
      canonicalSourceId: connector.sourceId,
    });

    if (outcome.outcome === "created") {
      opened++;
      if (position.supersedable) {
        const bucket = openedByRoleType.get(position.roleType);
        if (bucket) bucket.push(id);
        else openedByRoleType.set(position.roleType, [id]);
      }
    }

    // A position that had been closed and is reported again is a
    // reappointment: reopen it rather than leaving a stale end date.
    if (before?.end_date && !position.endDate) {
      store.database.run(
        `UPDATE position SET end_date=NULL, end_date_precision=NULL, superseded_by=NULL WHERE id=?`,
        [id],
      );
      const evId = changeEventId("position", id, "reappointed", asOf);
      store.insertChangeEvent({
        id: evId,
        entityType: "position",
        entityId: id,
        fieldName: "end_date",
        previousValue: before.end_date,
        newValue: null,
        changeKind: "reappointed",
        sourceId: connector.sourceId,
        snapshotId: ctx.snapshotId,
        syncRunId: ctx.runId,
        detectedAt: ctx.retrievedAt,
        actor,
      });
      changeEventIds.push(evId);
    }

    for (const change of outcome.changes) {
      const evId = changeEventId("position", id, change.fieldName, change.newValue);
      store.insertChangeEvent({
        id: evId,
        entityType: "position",
        entityId: id,
        fieldName: change.fieldName,
        previousValue: change.previousValue,
        newValue: change.newValue,
        sourceId: connector.sourceId,
        snapshotId: ctx.snapshotId,
        syncRunId: ctx.runId,
        detectedAt: ctx.retrievedAt,
        actor,
      });
      changeEventIds.push(evId);
    }

    store.upsertEvidence({
      id: evidenceIdFor({
        sourceId: connector.sourceId,
        entityType: "position",
        entityId: id,
        fieldName: "title",
        sourceUrl: incoming.sourceUrl,
      }),
      sourceId: connector.sourceId,
      entityType: "position",
      entityId: id,
      fieldName: "title",
      sourceUrl: incoming.sourceUrl,
      retrievedAt: ctx.retrievedAt,
      sourceRecordId: incoming.externalId,
      snapshotId: ctx.snapshotId,
    });
  }

  // ---- SUPERSESSION ------------------------------------------------------
  // Offices this source previously reported as held, which it no longer
  // reports. They ENDED; they did not stop existing.
  const supersedableRoleTypes = new Set(
    incoming.positions.filter((p) => p.supersedable).map((p) => p.roleType),
  );

  const stillOpen = store.openPositions(personId).filter(
    (row) =>
      row.canonical_source_id === connector.sourceId &&
      !incomingIds.has(row.id) &&
      supersedableRoleTypes.has(row.role_type),
  );

  for (const outgoing of stillOpen) {
    // Which office replaced it. Prefer a same-office rename (a portfolio
    // merely relabelled), otherwise take the single office opened in the same
    // slot during this run. Only ever used to LINK the two rows — the
    // outgoing row's own fields are never rewritten.
    const opening = openedByRoleType.get(outgoing.role_type) ?? [];
    const renamed = incoming.positions.find(
      (p) => p.roleType === outgoing.role_type && sameOfficeLikely(p.title, outgoing.title),
    );
    const replacementId = renamed
      ? positionIdFor(personId, renamed.title)
      : opening.length === 1
        ? opening[0]!
        : null;

    store.closePosition(outgoing.id, asOf, replacementId);
    closed++;

    const evId = changeEventId("position", outgoing.id, "superseded", asOf);
    store.insertChangeEvent({
      id: evId,
      entityType: "position",
      entityId: outgoing.id,
      fieldName: "end_date",
      previousValue: null,
      newValue: asOf,
      // "portfolio-changed" when something took its place; "office-ended"
      // when the person simply stopped holding it.
      changeKind: replacementId ? "portfolio-changed" : "office-ended",
      sourceId: connector.sourceId,
      snapshotId: ctx.snapshotId,
      syncRunId: ctx.runId,
      detectedAt: ctx.retrievedAt,
      actor,
    });
    changeEventIds.push(evId);

    // A relabelled portfolio is a disagreement between what the source said
    // before and what it says now, worth recording when the rules cannot
    // decide the two labels describe one office.
    if (renamed) {
      const decision = reconcileClaims(
        renamed.factType,
        [
          { sourceId: connector.sourceId, value: outgoing.title },
          { sourceId: connector.sourceId, value: renamed.title },
        ],
        { treatSimilarOfficesAsSame: true },
      );
      if (decision.kind === "unresolved") conflicts++;
    }
  }

  return { closed, opened, conflicts, changeEventIds };
}

/**
 * Deterministic change-event id.
 *
 * Keyed on what changed and what it changed to, so replaying the same
 * transition cannot log it twice — the `ON CONFLICT DO NOTHING` in
 * `insertChangeEvent` then makes re-running genuinely idempotent.
 */
function changeEventId(
  entityType: string,
  entityId: string,
  fieldName: string,
  newValue: string | null,
): string {
  return `CHG:${entityType}:${entityId}:${fieldName}:${contentHash(String(newValue ?? ""))}`;
}
