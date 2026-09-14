/**
 * Javora — the corrections write path.
 *
 * This module is the whole of what an anonymous HTTP request is allowed to
 * write. It implements `docs/corrections-security-design.md` (L-9), which
 * should be read first: everything below is that document's decisions turned
 * into code, and a change here that contradicts it is a change to the
 * security posture, not a refactor.
 *
 * THE ONE WRITE. A correction adds a row to `correction_report` with
 * `review_status = 'open'` and nothing else, ever. It never touches `person`,
 * `position`, `political_affiliation` or any other canonical table — turning
 * an approved report into an actual record change is a second, human
 * triggered action through `CanonicalStore`, the same write surface the sync
 * worker uses. That separation is the feature's entire safety argument, so
 * the handle this module holds is deliberately shaped so it *cannot* do
 * anything else: `openCorrectionIntake()` wraps a writable connection in an
 * object exposing exactly one insert, the same narrowing `toQueryable()`
 * already applies to the read path.
 *
 * NOTHING FROM THE CLIENT IS TRUSTED. `src/services/corrections.ts` runs the
 * identical rules in the browser, and that is UX, not authorization
 * (SECURITY--SL Politics.md §1.1). Everything is re-checked here against the
 * raw body:
 *
 *   - `entityId` must resolve to a real person. An unresolvable id is a 400,
 *     not a silently-stored report about nothing.
 *   - `fieldName` must be on `CORRECTION_FIELDS`' allowlist, imported from
 *     the same module the form uses so the two cannot drift apart.
 *   - `currentValue` is RE-DERIVED from the record where the field maps to a
 *     stored person column, and the client's claim is discarded. A reporter
 *     who invents a "current value" to make an unrelated edit look like a
 *     correction of what is displayed must not be able to assert their way
 *     past review.
 *   - `id`, `submittedAt`, `reviewStatus`, `reviewedAt`, `reviewer` and
 *     `resolution` are server-set, whatever the body contained.
 *
 * The reporter's source URL is stored, never fetched. Per the design
 * document's "What this document deliberately does not decide", a human
 * reviewer opens the link in their own browser; automatically fetching a
 * user-supplied URL would invent SSRF surface this feature does not need.
 */

import { randomUUID, createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Database } from "../db/database.ts";
import type { Queryable } from "./queries.ts";
import { ValidationError } from "./validation.ts";
import { CORRECTION_FIELDS, isAcceptableSourceUrl } from "../../src/services/corrections.ts";

/**
 * The largest body this endpoint will read, in bytes.
 *
 * Enforced while reading, before `JSON.parse` ever sees the bytes — a cap
 * applied after buffering the whole body is not a cap. Mirrors
 * `deploy/nginx-api.conf`'s `client_max_body_size 8k` for the existing API;
 * a correction report has no legitimate reason to be large.
 */
export const MAX_BODY_BYTES = Number(process.env.API_CORRECTION_MAX_BODY_BYTES ?? 8_192);

/**
 * Per-field length caps. Rejected, never silently truncated — the same
 * discipline `validation.ts` applies to query parameters, and for the same
 * reason: a caller who sent 40 KB of `proposedValue` should be told it was
 * refused rather than left believing a truncated version was filed.
 */
const MAX_LENGTHS: Record<string, number> = {
  entityId: 200,
  fieldName: 64,
  currentValue: 500,
  proposedValue: 500,
  supportingSourceUrl: 2_000,
  explanation: 4_000,
};

const FIELD_IDS = new Set(CORRECTION_FIELDS.map((field) => field.id));

/**
 * Which `person` column a correction field names, where it names one at all.
 *
 * Only these can have their "current value" re-derived server-side. The
 * others (`position.*`, `qualification`, `timelineEvent`, `aliases`, `other`)
 * describe a row in another table that the submission does not identify, so
 * there is no single current value to look up — see `deriveCurrentValue`.
 */
const DERIVABLE_FIELDS: Record<string, string> = {
  canonicalName: "canonical_name",
  dateOfBirth: "date_of_birth",
  dateOfDeath: "date_of_death",
};

export interface CorrectionSubmission {
  entityId: string;
  fieldName: string;
  proposedValue: string;
  supportingSourceUrl: string;
  explanation: string;
}

export interface StoredCorrection {
  id: string;
  submittedAt: string;
  reviewStatus: "open";
  /** True when this submission matched an already-open, identical report. */
  duplicate: boolean;
}

/* ==========================================================================
   Reading the body
   ========================================================================== */

/**
 * Read a request body, refusing anything over `MAX_BODY_BYTES`.
 *
 * The size check runs per chunk and destroys the request as soon as the cap
 * is passed, so an attacker streaming an endless body is disconnected rather
 * than buffered. `content-length`, when present, is checked first — no reason
 * to read a single byte of a body that has already announced it is too big —
 * but it is not relied on alone, since a chunked request need not send one
 * and a lying one is trivially constructed.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLarge(`request body must not exceed ${maxBytes} bytes`);
  }

  const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    throw new ValidationError('content-type must be "application/json"');
  }

  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new PayloadTooLarge(`request body must not exceed ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", resolve);
    req.on("error", reject);
  });

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new ValidationError("request body is empty");

  try {
    return JSON.parse(raw);
  } catch {
    // Never echo the parse error: it quotes the offending input back, which
    // is attacker-controlled text in a response body.
    throw new ValidationError("request body is not valid JSON");
  }
}

/** Body over the cap. Distinct from ValidationError so the route can answer 413. */
export class PayloadTooLarge extends Error {
  readonly status = 413;
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLarge";
  }
}

/* ==========================================================================
   Revalidation
   ========================================================================== */

function requireString(body: Record<string, unknown>, key: string, required: boolean): string {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`"${key}" is required`);
    return "";
  }
  if (typeof value !== "string") throw new ValidationError(`"${key}" must be a string`);
  if (value.length > MAX_LENGTHS[key]!) {
    throw new ValidationError(`"${key}" must not exceed ${MAX_LENGTHS[key]} characters`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`"${key}" is required`);
  return trimmed;
}

/**
 * Shape-check the parsed body into the five fields a submission may carry.
 *
 * Every other property is dropped rather than rejected — a client sending
 * `reviewStatus: "published"` is not told it was noticed, it simply has no
 * effect, because the insert below never reads it. Fields are enumerated
 * here explicitly rather than spread from the body for exactly that reason.
 */
export function parseCorrectionSubmission(raw: unknown): CorrectionSubmission {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError("request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;

  const fieldName = requireString(body, "fieldName", true);
  if (!FIELD_IDS.has(fieldName)) {
    // Names the constraint, not the value: the value is attacker-controlled
    // and does not need repeating back into a response.
    throw new ValidationError('"fieldName" is not a field SL Politics records');
  }

  const supportingSourceUrl = requireString(body, "supportingSourceUrl", true);
  if (!isAcceptableSourceUrl(supportingSourceUrl)) {
    throw new ValidationError(
      '"supportingSourceUrl" must be a full http(s) link to a specific page or document, not an institution\'s homepage',
    );
  }

  return {
    entityId: requireString(body, "entityId", true),
    fieldName,
    proposedValue: requireString(body, "proposedValue", true),
    supportingSourceUrl,
    explanation: requireString(body, "explanation", false),
  };
}

/**
 * The value the record actually holds for this field, or `undefined` when
 * the field does not name one stored value.
 *
 * `undefined` and `null` mean different things here, in the same way
 * `Unavailable`/`Unrecorded` do in the frontend: `null` is "the record holds
 * no value for this field", `undefined` is "this field does not identify a
 * single stored value to compare against" (a position's start date, when the
 * submission never says which position). Only the first can support the
 * "proposed value must differ from the current one" check.
 */
function deriveCurrentValue(person: Record<string, unknown>, fieldName: string): string | null | undefined {
  const column = DERIVABLE_FIELDS[fieldName];
  if (!column) return undefined;
  const value = person[column];
  return value === null || value === undefined ? null : String(value);
}

/* ==========================================================================
   The store
   ========================================================================== */

/**
 * The only writable surface the API process holds.
 *
 * Deliberately not a `Database`: a route handler that reaches this object
 * can insert a correction report and can do nothing else, so a bug or a
 * careless later refactor in the corrections handler cannot reach `.run()`
 * against `person` through a handle that happens to still expose it.
 */
export interface CorrectionIntake {
  /** Insert one report. Returns the server-generated id and timestamp. */
  insert(row: {
    id: string;
    submission: CorrectionSubmission;
    currentValue: string | null;
    submittedAt: string;
    reporterHash: string;
  }): void;
  /** An already-open, identical report's id, if one exists. */
  findOpenDuplicate(submission: CorrectionSubmission): string | null;
  close(): void;
}

/**
 * Wrap a writable connection as an insert-only correction store.
 *
 * `db` must be a connection opened SEPARATELY from the API's canonical
 * read-only one (see `startApi`), because this one genuinely needs to write
 * and the canonical one must stay unable to. The narrowing is what keeps
 * that separation from depending on every future caller's good behaviour.
 */
export function openCorrectionIntake(db: Database): CorrectionIntake {
  return {
    insert({ id, submission, currentValue, submittedAt, reporterHash }) {
      db.run(
        `INSERT INTO correction_report (
           id, entity_type, entity_id, field_name, current_value, proposed_value,
           supporting_source_url, explanation, submitted_at, submitter_ip_hash, review_status
         ) VALUES (?, 'person', ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          id,
          submission.entityId,
          submission.fieldName,
          currentValue,
          submission.proposedValue,
          submission.supportingSourceUrl,
          submission.explanation || null,
          submittedAt,
          // The abuse signal the design document asks for — see migration
          // 004's header for why it is a salted hash and why it does not
          // reuse `submitter_contact`, which stays NULL (this endpoint
          // collects no contact address).
          reporterHash,
        ],
      );
    },

    findOpenDuplicate(submission) {
      const row = db.get<{ id: string }>(
        `SELECT id FROM correction_report
          WHERE review_status = 'open'
            AND entity_type = 'person'
            AND entity_id = ?
            AND field_name = ?
            AND proposed_value = ?
            AND supporting_source_url = ?
          LIMIT 1`,
        [submission.entityId, submission.fieldName, submission.proposedValue, submission.supportingSourceUrl],
      );
      return row?.id ?? null;
    },

    close() {
      db.close();
    },
  };
}

/**
 * Salt for `reporterHash`. Without one the column is an unsalted hash of a
 * 32-bit address space — recoverable by brute force in seconds, which would
 * make the "the raw IP is not part of the record" claim above false.
 * Generated per process when unset, which is the safe default (the signal is
 * then only comparable within one process's lifetime, rather than being
 * quietly reversible).
 */
const REPORTER_HASH_SALT = process.env.JAVORA_CORRECTION_HASH_SALT ?? randomUUID();

export const hashReporter = (ip: string): string =>
  createHash("sha256").update(`${REPORTER_HASH_SALT}:${ip}`).digest("hex").slice(0, 32);

/* ==========================================================================
   The handler
   ========================================================================== */

/**
 * Validate and file one correction report.
 *
 * Throws `ValidationError` (400) for anything the body gets wrong, including
 * an `entityId` that names no record. Returns the filed report's id — the
 * only thing a reporter is told, since nothing else about the queue is
 * public.
 */
export async function fileCorrection(
  queryDb: Queryable,
  intake: CorrectionIntake,
  raw: unknown,
  reporterIp: string,
): Promise<StoredCorrection> {
  const submission = parseCorrectionSubmission(raw);

  // Resolved server-side by slug then id, matching how every read endpoint
  // resolves a person, so a correction can be filed against whichever
  // identifier the reporter had in front of them.
  const person =
    (await queryDb.get<Record<string, unknown>>(
      `SELECT id, slug, canonical_name, date_of_birth, date_of_death FROM person WHERE slug=?`,
      [submission.entityId],
    )) ??
    (await queryDb.get<Record<string, unknown>>(
      `SELECT id, slug, canonical_name, date_of_birth, date_of_death FROM person WHERE id=?`,
      [submission.entityId],
    ));

  if (!person) {
    throw new ValidationError('"entityId" does not name a record on SL Politics');
  }

  // Store the canonical id, never the slug the reporter happened to use:
  // slugs are permanent public URLs but a merged record can retire one
  // (CLAUDE.md, "A merged record may change its published slug"), and a
  // report that outlives its slug should still point at the right person.
  const entityId = String(person.id);
  const currentValue = deriveCurrentValue(person, submission.fieldName);

  // The design document's adversarial test 1: the comparison is against what
  // the record REALLY holds, not the `currentValue` the client claimed — that
  // claim is not read at all.
  if (currentValue !== undefined && submission.proposedValue === (currentValue ?? "")) {
    throw new ValidationError("the proposed value is what the record already shows");
  }

  const resolved: CorrectionSubmission = { ...submission, entityId };

  const existing = intake.findOpenDuplicate(resolved);
  if (existing) {
    // Answering with the original id rather than filing a second row: a
    // double-submitted form should not become two things a reviewer has to
    // read, and telling the reporter their report is on file is true.
    return { id: existing, submittedAt: "", reviewStatus: "open", duplicate: true };
  }

  const id = `correction-${randomUUID()}`;
  const submittedAt = new Date().toISOString();

  intake.insert({
    id,
    submission: resolved,
    currentValue: currentValue ?? null,
    submittedAt,
    reporterHash: hashReporter(reporterIp),
  });

  return { id, submittedAt, reviewStatus: "open", duplicate: false };
}
