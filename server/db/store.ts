/**
 * Javora — canonical store.
 *
 * The only module that writes canonical records. Everything above it (the
 * sync job, the API) goes through this surface, which is what keeps the two
 * guarantees the product depends on in one auditable place:
 *
 *   IDEMPOTENCE — every write is an upsert keyed on a deterministic id
 *   (see `src/sync/importRun.ts`). Running the same import twice produces the
 *   same ids twice, so the second run recognises every record as one it
 *   already has. No duplicate people, parties, positions, evidence or change
 *   events.
 *
 *   HISTORY IS APPEND-ONLY — `supersedePosition` writes an `end_date` onto
 *   the outgoing row and inserts a NEW row for the incoming office. There is
 *   deliberately no method that rewrites a position's title in place, because
 *   that is precisely how a portfolio change would destroy the record of what
 *   came before it.
 */

import type { Database } from "./database.ts";
import { precisionOf } from "../../src/lib/date.ts";
import { normaliseName } from "../../src/lib/identity.ts";
import { evidenceIdFor } from "../../src/sync/importRun.ts";

const now = () => new Date().toISOString();

/** Date + its recorded precision, so a year-only date stays year-only. */
function dateParts(value: string | null | undefined): [string | null, string | null] {
  if (!value) return [null, null];
  return [value, precisionOf(value)];
}

/* ==========================================================================
   Row shapes
   ========================================================================== */

export interface PersonRow {
  id: string;
  slug: string;
  canonical_name: string;
  name_en: string;
  name_si: string | null;
  name_ta: string | null;
  date_of_birth: string | null;
  date_of_birth_precision: string | null;
  date_of_death: string | null;
  biography: string | null;
  portrait_url: string | null;
  portrait_rights: string;
  portrait_rights_note: string | null;
  portrait_source_url: string | null;
  portrait_credit: string | null;
  /** Occupation as the source states it. Never an employment record. */
  profession: string | null;
  place_of_birth: string | null;
  nationality: string | null;
  verification: string;
  verified_at: string | null;
  is_demonstration: number;
  created_at: string;
  updated_at: string;
}

export interface PositionRow {
  id: string;
  person_id: string;
  title: string;
  role_type: string;
  institution: string;
  ministry: string | null;
  district_id: string | null;
  start_date: string | null;
  end_date: string | null;
  current_as_of: string | null;
  appointment_type: string;
  precedence: number;
  verification: string;
  canonical_source_id: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertResult {
  outcome: "created" | "updated" | "unchanged";
  changes: Array<{ fieldName: string; previousValue: string | null; newValue: string | null }>;
}

/**
 * The stable, normalised form of a value, for CHANGE DETECTION only.
 *
 * Comparing raw strings makes change detection a function of how the source
 * happened to lay out its HTML: a scrape that yields "Minister of  Energy"
 * one week and "Minister of Energy " the next reports a portfolio change
 * that never happened, writes a change event, and puts a false transition in
 * front of a reader. Collapsing runs of whitespace and trimming the ends
 * compares the FACT rather than its formatting.
 *
 * Deliberately NOT case-folded. A change of capitalisation in an official
 * title is rare and, when it happens, is a real editorial change by the
 * source worth recording — unlike stray whitespace, which is an artefact of
 * markup and never meaningful.
 *
 * Absent, null and empty-string all normalise to null: a source omitting a
 * field and a source publishing an empty one assert the same thing.
 */
const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const text = (typeof v === "string" ? v : String(v)).trim().replace(/\s+/g, " ");
  return text === "" ? null : text;
};

/** Which watched fields differ, compared on their normalised forms. */
function diff(
  stored: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
  fields: string[],
): UpsertResult["changes"] {
  if (!stored) return [];
  const out: UpsertResult["changes"] = [];
  for (const field of fields) {
    const before = norm(stored[field]);
    const after = norm(incoming[field]);
    if (before !== after) out.push({ fieldName: field, previousValue: before, newValue: after });
  }
  return out;
}

/* ==========================================================================
   Store
   ========================================================================== */

export class CanonicalStore {
  // An explicit field rather than a constructor parameter property: Node runs
  // this TypeScript in strip-only mode, which cannot emit the assignment a
  // parameter property implies.
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get database(): Database {
    return this.db;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  /* ---------------------------------------------------------------- sources */

  upsertSource(source: {
    id: string;
    name: string;
    institution: string;
    sourceType: string;
    category: string;
    url: string;
    description?: string;
    syncState?: string;
    authoritativeFor?: Array<{ factType: string; rank?: number }>;
  }): void {
    const stamp = now();
    this.db.run(
      `INSERT INTO source (id,name,institution,source_type,category,url,description,sync_state,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, institution=excluded.institution, source_type=excluded.source_type,
         category=excluded.category, url=excluded.url, description=excluded.description,
         updated_at=excluded.updated_at`,
      [
        source.id, source.name, source.institution, source.sourceType, source.category,
        source.url, source.description ?? "", source.syncState ?? "not-connected", stamp, stamp,
      ],
    );

    for (const entry of source.authoritativeFor ?? []) {
      this.db.run(
        `INSERT INTO source_authority (source_id, fact_type, rank) VALUES (?,?,?)
         ON CONFLICT(source_id, fact_type) DO UPDATE SET rank=excluded.rank`,
        [source.id, entry.factType, entry.rank ?? 1],
      );
    }
  }

  /** Record a real retrieval. Never back-filled to make a source look active. */
  markSourceChecked(sourceId: string, at: string, successful: boolean): void {
    this.db.run(
      `UPDATE source SET last_checked_at=?, last_successful_sync_at=COALESCE(?, last_successful_sync_at),
       sync_state=?, updated_at=? WHERE id=?`,
      [at, successful ? at : null, successful ? "manual-import" : "failing", at, sourceId],
    );
  }

  getSource(id: string) {
    return this.db.get(`SELECT * FROM source WHERE id=?`, [id]);
  }

  listSources() {
    return this.db.all(`SELECT * FROM source ORDER BY id`);
  }

  /* -------------------------------------------------------------- snapshots */

  insertSnapshot(snapshot: {
    id: string;
    sourceId: string;
    url: string;
    retrievedAt: string;
    contentHash: string;
    rawContentHash?: string | null;
    rawHashIsStable?: boolean;
    storageReference?: string | null;
    connectorVersion: string;
    parserVersion: string;
    status: "ok" | "fetch-failed" | "parse-failed";
    errorMessage?: string | null;
    recordCount?: number | null;
  }): void {
    this.db.run(
      `INSERT INTO source_snapshot
       (id,source_id,url,retrieved_at,content_hash,raw_content_hash,raw_hash_is_stable,
        storage_reference,connector_version,parser_version,status,error_message,record_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
      [
        snapshot.id, snapshot.sourceId, snapshot.url, snapshot.retrievedAt, snapshot.contentHash,
        snapshot.rawContentHash ?? null, snapshot.rawHashIsStable ? 1 : 0,
        snapshot.storageReference ?? null, snapshot.connectorVersion, snapshot.parserVersion,
        snapshot.status, snapshot.errorMessage ?? null, snapshot.recordCount ?? null,
      ],
    );
  }

  /** Most recent SUCCESSFUL snapshot — a failed fetch must not become the baseline. */
  latestSnapshot(sourceId: string) {
    return this.db.get<{ id: string; content_hash: string; retrieved_at: string }>(
      `SELECT * FROM source_snapshot WHERE source_id=? AND status='ok'
       ORDER BY retrieved_at DESC LIMIT 1`,
      [sourceId],
    );
  }

  countSnapshots(sourceId?: string): number {
    const row = sourceId
      ? this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM source_snapshot WHERE source_id=?`, [sourceId])
      : this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM source_snapshot`);
    return row?.n ?? 0;
  }

  /* -------------------------------------------------------------- sync runs */

  startRun(run: { id: string; sourceId: string; trigger: string; startedAt: string }): void {
    this.db.run(
      `INSERT INTO sync_run (id,source_id,trigger,started_at,outcome) VALUES (?,?,?,?,'blocked')`,
      [run.id, run.sourceId, run.trigger, run.startedAt],
    );
  }

  finishRun(id: string, patch: {
    outcome: string;
    finishedAt: string;
    snapshotId?: string | null;
    seen?: number; created?: number; updated?: number; unchanged?: number;
    errorMessage?: string | null;
  }): void {
    this.db.run(
      `UPDATE sync_run SET outcome=?, finished_at=?, snapshot_id=?,
        seen_count=?, created_count=?, updated_count=?, unchanged_count=?, error_message=?
       WHERE id=?`,
      [
        patch.outcome, patch.finishedAt, patch.snapshotId ?? null,
        patch.seen ?? 0, patch.created ?? 0, patch.updated ?? 0, patch.unchanged ?? 0,
        patch.errorMessage ?? null, id,
      ],
    );
  }

  listRuns(sourceId?: string, limit = 20) {
    return sourceId
      ? this.db.all(`SELECT * FROM sync_run WHERE source_id=? ORDER BY started_at DESC LIMIT ?`, [sourceId, limit])
      : this.db.all(`SELECT * FROM sync_run ORDER BY started_at DESC LIMIT ?`, [limit]);
  }

  /* ------------------------------------------------------ parties/districts */

  upsertParty(party: { id: string; name: string; abbreviation: string; aliases?: string[] }): void {
    const stamp = now();
    this.db.run(
      `INSERT INTO party (id,name,abbreviation,created_at,updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, abbreviation=excluded.abbreviation, updated_at=excluded.updated_at`,
      [party.id, party.name, party.abbreviation, stamp, stamp],
    );
    for (const alias of party.aliases ?? []) {
      this.db.run(
        `INSERT INTO party_alias (party_id, alias, alias_key) VALUES (?,?,?) ON CONFLICT DO NOTHING`,
        [party.id, alias, normaliseName(alias)],
      );
    }
  }

  upsertDistrict(district: { id: string; name: string; province: string | null }): void {
    this.db.run(
      `INSERT INTO district (id,name,province) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, province=excluded.province`,
      [district.id, district.name, district.province],
    );
  }

  listParties() {
    return this.db.all(`SELECT * FROM party ORDER BY name`);
  }

  listDistricts() {
    return this.db.all(`SELECT * FROM district ORDER BY name`);
  }

  /* ---------------------------------------------------------------- people */

  /**
   * The safe identity lookup: an external id within one source's id-space.
   * Name matching never happens here — it goes to `identity_review`.
   */
  findPersonByExternalId(sourceKey: string, externalId: string): string | null {
    const row = this.db.get<{ person_id: string }>(
      `SELECT person_id FROM person_external_id WHERE source_key=? AND external_id=?`,
      [sourceKey, externalId],
    );
    return row?.person_id ?? null;
  }

  getPersonBySlug(slug: string) {
    return this.db.get<PersonRow>(`SELECT * FROM person WHERE slug=?`, [slug]);
  }

  getPerson(id: string) {
    return this.db.get<PersonRow>(`SELECT * FROM person WHERE id=?`, [id]);
  }

  private static readonly PERSON_WATCHED = [
    "canonical_name", "name_si", "name_ta", "date_of_birth", "date_of_death",
    "biography", "portrait_url", "verification",
  ];

  upsertPerson(person: {
    id: string;
    slug: string;
    canonicalName: string;
    nameSi?: string | null;
    nameTa?: string | null;
    dateOfBirth?: string | null;
    dateOfDeath?: string | null;
    biography?: string | null;
    portraitUrl?: string | null;
    portraitSourceId?: string | null;
    portraitCredit?: string | null;
    verification?: string;
    verifiedAt?: string | null;
    isDemonstration?: boolean;
    aliases?: string[];
    externalIds?: Record<string, string>;
    searchText?: string;
  }): UpsertResult {
    const stamp = now();
    const existing = this.db.get<Record<string, unknown>>(`SELECT * FROM person WHERE id=?`, [person.id]);

    /**
     * `undefined` means "this run did not look at that field"; `null` means
     * "the source looked and there is no value". They must not be conflated.
     *
     * The bug this prevents: a listing-only sync does not fetch profile
     * pages, so it carries no date of birth. Treating that as null wiped the
     * date of birth off 219 people and logged 365 change events for facts
     * that had not changed at all. A run that reads less must never delete
     * what a fuller run established.
     */
    const keep = <T>(incoming: T | undefined, current: unknown): T | null =>
      incoming === undefined ? ((current ?? null) as T | null) : incoming;

    const [dob, dobP] = dateParts(keep(person.dateOfBirth, existing?.date_of_birth));
    const [dod, dodP] = dateParts(keep(person.dateOfDeath, existing?.date_of_death));
    const biography = keep(person.biography, existing?.biography);
    const portraitUrl = keep(person.portraitUrl, existing?.portrait_url);
    const nameSi = keep(person.nameSi, existing?.name_si);
    const nameTa = keep(person.nameTa, existing?.name_ta);

    const incoming = {
      canonical_name: person.canonicalName,
      name_si: nameSi,
      name_ta: nameTa,
      date_of_birth: dob,
      date_of_death: dod,
      biography,
      portrait_url: portraitUrl,
      verification: person.verification ?? "unverified",
    };

    const changes = diff(existing, incoming, CanonicalStore.PERSON_WATCHED);

    this.db.run(
      `INSERT INTO person
       (id,slug,canonical_name,name_en,name_si,name_ta,date_of_birth,date_of_birth_precision,
        date_of_death,date_of_death_precision,biography,portrait_url,portrait_source_id,
        portrait_credit,portrait_retrieved_at,verification,verified_at,is_demonstration,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         slug=excluded.slug, canonical_name=excluded.canonical_name, name_en=excluded.name_en,
         name_si=excluded.name_si, name_ta=excluded.name_ta,
         date_of_birth=excluded.date_of_birth, date_of_birth_precision=excluded.date_of_birth_precision,
         date_of_death=excluded.date_of_death, date_of_death_precision=excluded.date_of_death_precision,
         biography=excluded.biography, portrait_url=excluded.portrait_url,
         verification=excluded.verification, verified_at=excluded.verified_at,
         updated_at=excluded.updated_at`,
      [
        person.id, person.slug, person.canonicalName, person.canonicalName,
        nameSi, nameTa,
        dob, dobP, dod, dodP,
        biography, portraitUrl, person.portraitSourceId ?? null,
        person.portraitCredit ?? null, portraitUrl ? stamp : null,
        person.verification ?? "unverified", person.verifiedAt ?? null,
        person.isDemonstration ? 1 : 0,
        existing?.created_at ?? stamp, stamp,
      ],
    );

    for (const alias of person.aliases ?? []) {
      const key = normaliseName(alias);
      if (!key) continue;
      this.db.run(
        `INSERT INTO person_alias (person_id, alias, alias_key) VALUES (?,?,?)
         ON CONFLICT(person_id, alias_key) DO UPDATE SET alias=excluded.alias`,
        [person.id, alias, key],
      );
    }

    for (const [sourceKey, externalId] of Object.entries(person.externalIds ?? {})) {
      if (!externalId) continue;
      this.db.run(
        `INSERT INTO person_external_id (person_id, source_key, external_id) VALUES (?,?,?)
         ON CONFLICT(person_id, source_key) DO UPDATE SET external_id=excluded.external_id`,
        [person.id, sourceKey, externalId],
      );
    }

    if (person.searchText !== undefined) {
      this.db.run(
        `INSERT INTO person_search (person_id, search_text) VALUES (?,?)
         ON CONFLICT(person_id) DO UPDATE SET search_text=excluded.search_text`,
        [person.id, person.searchText],
      );
    }

    return {
      outcome: !existing ? "created" : changes.length ? "updated" : "unchanged",
      changes,
    };
  }

  /* ------------------------------------------------------------- positions */

  getPosition(id: string) {
    return this.db.get<PositionRow>(`SELECT * FROM position WHERE id=?`, [id]);
  }

  listPositions(personId: string) {
    return this.db.all<PositionRow>(
      `SELECT * FROM position WHERE person_id=? ORDER BY (end_date IS NOT NULL), precedence, title`,
      [personId],
    );
  }

  /** Open positions for one person, optionally restricted to a role type. */
  openPositions(personId: string, roleType?: string) {
    return roleType
      ? this.db.all<PositionRow>(
          `SELECT * FROM position WHERE person_id=? AND end_date IS NULL AND role_type=?`,
          [personId, roleType],
        )
      : this.db.all<PositionRow>(`SELECT * FROM position WHERE person_id=? AND end_date IS NULL`, [personId]);
  }

  /**
   * Fields whose movement is a CANONICAL DATA change worth an audit event.
   *
   * `current_as_of` is deliberately absent. It advances every time the source
   * is re-checked and still says the same thing — that is the source being
   * re-confirmed, not a political fact changing. Watching it would emit a
   * change event per position on every single run and bury the real
   * transitions in noise.
   */
  private static readonly POSITION_WATCHED = [
    "title", "role_type", "institution", "ministry", "district_id",
    "start_date", "end_date", "verification",
  ];

  upsertPosition(position: {
    id: string;
    personId: string;
    title: string;
    roleType: string;
    institution: string;
    ministry?: string | null;
    districtId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    currentAsOf?: string | null;
    appointmentType?: string;
    precedence?: number;
    verification?: string;
    canonicalSourceId?: string | null;
  }): UpsertResult {
    const stamp = now();
    const existing = this.db.get<Record<string, unknown>>(`SELECT * FROM position WHERE id=?`, [position.id]);

    /*
     * `undefined` means "this run did not carry that field"; `null` means
     * "the source looked and there is no value". They must not be conflated —
     * the same rule `upsertPerson` already follows, and for the same reason.
     *
     * The bug this prevents, confirmed by test before being fixed: a
     * listing-only Parliament sync carries no start date, no ministry and no
     * district (those live on the profile pages it does not fetch). Flattening
     * those absences to `null` wrote NULL over the dates and portfolios a
     * fuller earlier run had established — a current update silently
     * destroying historical truth, which is the one thing this pipeline
     * exists to prevent.
     */
    const keep = <T>(incomingValue: T | undefined, current: unknown): T | null =>
      incomingValue === undefined ? ((current ?? null) as T | null) : incomingValue;

    const [start, startP] = dateParts(keep(position.startDate, existing?.start_date));
    const [end, endP] = dateParts(keep(position.endDate, existing?.end_date));
    const ministry = keep(position.ministry, existing?.ministry);
    const districtId = keep(position.districtId, existing?.district_id);

    // Stored in normalised form too, not merely compared in it: a title that
    // reached the database with doubled internal spaces would render that way
    // on the person's profile for as long as the row survives.
    const title = norm(position.title) ?? position.title;
    const institution = norm(position.institution) ?? position.institution;
    const normalisedMinistry = norm(ministry);

    const incoming = {
      title,
      role_type: position.roleType,
      institution,
      ministry: normalisedMinistry,
      district_id: districtId,
      start_date: start,
      end_date: end,
      current_as_of: position.currentAsOf ?? null,
      verification: position.verification ?? "unverified",
    };

    const changes = diff(existing, incoming, CanonicalStore.POSITION_WATCHED);

    this.db.run(
      `INSERT INTO position
       (id,person_id,title,role_type,institution,ministry,district_id,constituency,
        start_date,start_date_precision,end_date,end_date_precision,current_as_of,
        appointment_type,precedence,verification,canonical_source_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, role_type=excluded.role_type, institution=excluded.institution,
         ministry=excluded.ministry, district_id=excluded.district_id,
         start_date=excluded.start_date, start_date_precision=excluded.start_date_precision,
         end_date=excluded.end_date, end_date_precision=excluded.end_date_precision,
         current_as_of=excluded.current_as_of, appointment_type=excluded.appointment_type,
         precedence=excluded.precedence, verification=excluded.verification,
         canonical_source_id=excluded.canonical_source_id, updated_at=excluded.updated_at`,
      [
        position.id, position.personId, title, position.roleType, institution,
        normalisedMinistry, districtId,
        start, startP, end, endP, position.currentAsOf ?? null,
        position.appointmentType ?? "unknown", position.precedence ?? 99,
        position.verification ?? "unverified", position.canonicalSourceId ?? null,
        existing?.created_at ?? stamp, stamp,
      ],
    );

    return {
      outcome: !existing ? "created" : changes.length ? "updated" : "unchanged",
      changes,
    };
  }

  /**
   * Close an outgoing office by writing its end date.
   *
   * This is the ONLY mutation applied to a superseded position: the title,
   * institution and start date are left exactly as recorded. A portfolio
   * change must never be applied by rewriting the old row, because that
   * erases the fact that the earlier office was ever held.
   */
  closePosition(positionId: string, endDate: string, supersededBy?: string | null): void {
    const [end, endP] = dateParts(endDate);
    this.db.run(
      `UPDATE position SET end_date=?, end_date_precision=?, superseded_by=?, updated_at=? WHERE id=?`,
      [end, endP, supersededBy ?? null, now(), positionId],
    );
  }

  /* -------------------------------------------------------------- evidence */

  /**
   * Evidence is keyed on what it asserts, so re-importing the same citation
   * updates it rather than piling up duplicate rows pointing at one page.
   */
  upsertEvidence(evidence: {
    id: string;
    sourceId: string;
    entityType: string;
    entityId: string;
    fieldName?: string | null;
    sourceUrl?: string | null;
    documentTitle?: string | null;
    retrievedAt?: string | null;
    locator?: string | null;
    sourceRecordId?: string | null;
    contentHash?: string | null;
    snapshotId?: string | null;
    notes?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO source_evidence
       (id,source_id,entity_type,entity_id,field_name,source_url,document_title,published_at,
        retrieved_at,locator,source_record_id,content_hash,snapshot_id,notes,created_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         source_url=excluded.source_url, document_title=excluded.document_title,
         retrieved_at=excluded.retrieved_at, locator=excluded.locator,
         source_record_id=excluded.source_record_id, content_hash=excluded.content_hash,
         snapshot_id=excluded.snapshot_id, notes=excluded.notes`,
      [
        evidence.id, evidence.sourceId, evidence.entityType, evidence.entityId,
        evidence.fieldName ?? null, evidence.sourceUrl ?? null, evidence.documentTitle ?? null,
        evidence.retrievedAt ?? null, evidence.locator ?? null, evidence.sourceRecordId ?? null,
        evidence.contentHash ?? null, evidence.snapshotId ?? null, evidence.notes ?? null, now(),
      ],
    );
  }

  evidenceFor(entityType: string, entityId: string) {
    return this.db.all(
      `SELECT * FROM source_evidence WHERE entity_type=? AND entity_id=? ORDER BY source_id`,
      [entityType, entityId],
    );
  }

  /** Every evidence row touching a person, including their positions. */
  evidenceForPerson(personId: string) {
    return this.db.all(
      `SELECT e.* FROM source_evidence e
       WHERE (e.entity_type='person' AND e.entity_id=?)
          OR (e.entity_type='position' AND e.entity_id IN (SELECT id FROM position WHERE person_id=?))
          OR (e.entity_type='affiliation' AND e.entity_id IN (SELECT id FROM political_affiliation WHERE person_id=?))
       ORDER BY e.entity_type, e.source_id`,
      [personId, personId, personId],
    );
  }

  /* ---------------------------------------------------------- affiliations */

  upsertAffiliation(affiliation: {
    id: string;
    personId: string;
    partyId: string;
    role?: string;
    startDate?: string | null;
    endDate?: string | null;
    currentAsOf?: string | null;
    verification?: string;
  }): UpsertResult {
    const stamp = now();
    const existing = this.db.get<Record<string, unknown>>(
      `SELECT * FROM political_affiliation WHERE id=?`, [affiliation.id],
    );
    const incoming = {
      party_id: affiliation.partyId,
      role: affiliation.role ?? "member",
      start_date: affiliation.startDate ?? null,
      end_date: affiliation.endDate ?? null,
    };
    const changes = diff(existing, incoming, ["party_id", "role", "start_date", "end_date"]);

    this.db.run(
      `INSERT INTO political_affiliation
       (id,person_id,party_id,role,start_date,end_date,current_as_of,verification,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         party_id=excluded.party_id, role=excluded.role, start_date=excluded.start_date,
         end_date=excluded.end_date, current_as_of=excluded.current_as_of,
         verification=excluded.verification, updated_at=excluded.updated_at`,
      [
        affiliation.id, affiliation.personId, affiliation.partyId, affiliation.role ?? "member",
        affiliation.startDate ?? null, affiliation.endDate ?? null, affiliation.currentAsOf ?? null,
        affiliation.verification ?? "unverified", existing?.created_at ?? stamp, stamp,
      ],
    );

    return { outcome: !existing ? "created" : changes.length ? "updated" : "unchanged", changes };
  }

  listAffiliations(personId: string) {
    return this.db.all(
      `SELECT a.*, p.name AS party_name, p.abbreviation AS party_abbreviation
       FROM political_affiliation a JOIN party p ON p.id=a.party_id
       WHERE a.person_id=? ORDER BY (a.end_date IS NOT NULL), a.start_date DESC`,
      [personId],
    );
  }

  /* --------------------------------------------------- education & career */

  /**
   * Record one educational qualification.
   *
   * PROVENANCE IS PART OF THE WRITE, not an afterthought. A qualification is
   * a claim about a named person's life; storing it without recording which
   * document said so leaves nothing to check it against and nothing to
   * correct it from. Supplying `sourceId` + `sourceUrl` writes the matching
   * `source_evidence` row in the same call, so the two cannot drift apart.
   *
   * This was a real gap, not a hypothetical one: 299 education records were
   * written by an earlier import path marked `source-linked` with no evidence
   * row anywhere in the database — a verification state the data could not
   * support. The guard below makes that combination impossible to repeat.
   */
  upsertEducation(record: {
    id: string;
    personId: string;
    educationType: "school" | "university" | "postgraduate" | "professional" | "other";
    institution: string;
    qualification?: string | null;
    field?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    completion?: "completed" | "incomplete" | "ongoing" | "unknown";
    verification?: string;
    /** The source this qualification came from. Required to claim source-linkage. */
    sourceId?: string | null;
    /** The exact document. Required to claim source-linkage. */
    sourceUrl?: string | null;
    retrievedAt?: string | null;
    /** The source's own wording, retained so a misclassification can be audited. */
    sourceText?: string | null;
  }): UpsertResult {
    const stamp = now();

    // A verification state above `unverified` has to be earned. Without a
    // source and a document there is nothing to link to, so the claim is
    // refused rather than stored and quietly believed later.
    const claimsLinkage = record.verification && record.verification !== "unverified";
    if (claimsLinkage && !(record.sourceId && record.sourceUrl)) {
      throw new Error(
        `upsertEducation(${record.id}): verification "${record.verification}" requires evidence ` +
          `(sourceId and sourceUrl); refusing to record an unsupported verification state`,
      );
    }

    const existing = this.db.get<Record<string, unknown>>(`SELECT * FROM education WHERE id=?`, [record.id]);
    const [start, startP] = dateParts(record.startDate);
    const [end, endP] = dateParts(record.endDate);

    const changes = diff(
      existing,
      {
        institution: record.institution,
        qualification: record.qualification ?? null,
        field: record.field ?? null,
        start_date: start,
        end_date: end,
      },
      ["institution", "qualification", "field", "start_date", "end_date"],
    );

    this.db.run(
      `INSERT INTO education
       (id,person_id,education_type,institution,qualification,field,
        start_date,start_date_precision,end_date,end_date_precision,
        completion,source_text,verification,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         education_type=excluded.education_type, institution=excluded.institution,
         qualification=excluded.qualification, field=excluded.field,
         start_date=excluded.start_date, start_date_precision=excluded.start_date_precision,
         end_date=excluded.end_date, end_date_precision=excluded.end_date_precision,
         completion=excluded.completion, source_text=excluded.source_text,
         verification=excluded.verification,
         updated_at=excluded.updated_at`,
      [
        record.id, record.personId, record.educationType, record.institution,
        record.qualification ?? null, record.field ?? null,
        start, startP, end, endP,
        record.completion ?? "unknown", record.sourceText ?? null,
        record.verification ?? "unverified",
        existing?.created_at ?? stamp, stamp,
      ],
    );

    // The evidence row, written in the same call so a qualification and the
    // document it came from cannot be recorded independently of each other.
    if (record.sourceId && record.sourceUrl) {
      this.upsertEvidence({
        id: evidenceIdFor({
          sourceId: record.sourceId,
          entityType: "education",
          entityId: record.id,
          fieldName: null,
          sourceUrl: record.sourceUrl,
        }),
        sourceId: record.sourceId,
        entityType: "education",
        entityId: record.id,
        sourceUrl: record.sourceUrl,
        documentTitle: record.qualification ?? record.institution,
        retrievedAt: record.retrievedAt ?? stamp,
        notes: record.sourceText ?? null,
      });
    }

    return { outcome: !existing ? "created" : changes.length ? "updated" : "unchanged", changes };
  }

  listEducation(personId: string) {
    return this.db.all(
      `SELECT * FROM education WHERE person_id=?
       ORDER BY CASE education_type
         WHEN 'school' THEN 1 WHEN 'university' THEN 2
         WHEN 'postgraduate' THEN 3 WHEN 'professional' THEN 4 ELSE 5 END,
         (end_date IS NULL), end_date DESC`,
      [personId],
    );
  }

  /**
   * Record one examination subject grade.
   *
   * Deliberately requires a subject and a grade: there is no way to record
   * "sat A/Ls" without recording what was actually sat and achieved, because
   * a vague assertion is exactly the kind of half-fact this table exists to
   * keep out.
   */
  upsertExamResult(record: {
    id: string;
    personId: string;
    examType: "ol" | "al";
    examYear?: string | null;
    stream?: string | null;
    subject: string;
    grade: string;
    verification?: string;
  }): void {
    this.db.run(
      `INSERT INTO exam_result (id,person_id,exam_type,exam_year,stream,subject,grade,verification,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(person_id,exam_type,subject) DO UPDATE SET
         grade=excluded.grade, exam_year=excluded.exam_year, stream=excluded.stream,
         verification=excluded.verification`,
      [
        record.id, record.personId, record.examType, record.examYear ?? null,
        record.stream ?? null, record.subject, record.grade,
        record.verification ?? "unverified", now(),
      ],
    );
  }

  listExamResults(personId: string, examType?: "ol" | "al") {
    return examType
      ? this.db.all(`SELECT * FROM exam_result WHERE person_id=? AND exam_type=? ORDER BY subject`, [personId, examType])
      : this.db.all(`SELECT * FROM exam_result WHERE person_id=? ORDER BY exam_type, subject`, [personId]);
  }

  upsertEmployment(record: {
    id: string;
    personId: string;
    organisation: string;
    title: string;
    employmentType?: string | null;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    currentAsOf?: string | null;
    verification?: string;
  }): UpsertResult {
    const stamp = now();
    const existing = this.db.get<Record<string, unknown>>(`SELECT * FROM employment WHERE id=?`, [record.id]);
    const [start, startP] = dateParts(record.startDate);
    const [end, endP] = dateParts(record.endDate);

    const changes = diff(
      existing,
      { organisation: record.organisation, title: record.title, start_date: start, end_date: end },
      ["organisation", "title", "start_date", "end_date"],
    );

    this.db.run(
      `INSERT INTO employment
       (id,person_id,organisation,title,employment_type,description,
        start_date,start_date_precision,end_date,end_date_precision,
        current_as_of,verification,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         organisation=excluded.organisation, title=excluded.title,
         employment_type=excluded.employment_type, description=excluded.description,
         start_date=excluded.start_date, start_date_precision=excluded.start_date_precision,
         end_date=excluded.end_date, end_date_precision=excluded.end_date_precision,
         current_as_of=excluded.current_as_of, verification=excluded.verification,
         updated_at=excluded.updated_at`,
      [
        record.id, record.personId, record.organisation, record.title,
        record.employmentType ?? null, record.description ?? null,
        start, startP, end, endP, record.currentAsOf ?? null,
        record.verification ?? "unverified", existing?.created_at ?? stamp, stamp,
      ],
    );
    return { outcome: !existing ? "created" : changes.length ? "updated" : "unchanged", changes };
  }

  listEmployment(personId: string) {
    return this.db.all(
      `SELECT * FROM employment WHERE person_id=? ORDER BY (end_date IS NOT NULL), end_date DESC, start_date DESC`,
      [personId],
    );
  }

  upsertPublicService(record: {
    id: string;
    personId: string;
    institution: string;
    role: string;
    serviceType?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    currentAsOf?: string | null;
    verification?: string;
  }): void {
    const stamp = now();
    const existing = this.db.get<Record<string, unknown>>(`SELECT * FROM public_service WHERE id=?`, [record.id]);
    const [start, startP] = dateParts(record.startDate);
    const [end, endP] = dateParts(record.endDate);

    this.db.run(
      `INSERT INTO public_service
       (id,person_id,institution,role,service_type,start_date,start_date_precision,
        end_date,end_date_precision,current_as_of,verification,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         institution=excluded.institution, role=excluded.role, service_type=excluded.service_type,
         start_date=excluded.start_date, end_date=excluded.end_date,
         current_as_of=excluded.current_as_of, verification=excluded.verification,
         updated_at=excluded.updated_at`,
      [
        record.id, record.personId, record.institution, record.role, record.serviceType ?? null,
        start, startP, end, endP, record.currentAsOf ?? null,
        record.verification ?? "unverified", existing?.created_at ?? stamp, stamp,
      ],
    );
  }

  listPublicService(personId: string) {
    return this.db.all(
      `SELECT * FROM public_service WHERE person_id=? ORDER BY (end_date IS NOT NULL), end_date DESC`,
      [personId],
    );
  }

  /** Profession, place of birth, nationality — biographical scalars. */
  setPersonBiographical(
    personId: string,
    patch: { profession?: string | null; placeOfBirth?: string | null; nationality?: string | null },
  ): void {
    const current = this.db.get<Record<string, unknown>>(
      `SELECT profession, place_of_birth, nationality FROM person WHERE id=?`, [personId],
    );
    if (!current) return;
    // `undefined` means this run did not look; only an explicit value writes.
    const keep = (incoming: string | null | undefined, existing: unknown) =>
      incoming === undefined ? ((existing ?? null) as string | null) : incoming;

    this.db.run(
      `UPDATE person SET profession=?, place_of_birth=?, nationality=?, updated_at=? WHERE id=?`,
      [
        keep(patch.profession, current.profession),
        keep(patch.placeOfBirth, current.place_of_birth),
        keep(patch.nationality, current.nationality),
        now(), personId,
      ],
    );
  }

  /**
   * Portrait provenance and rights.
   *
   * Stored even when rights are unknown, because knowing where the official
   * portrait lives is useful; the UI decides whether it may be displayed.
   */
  setPortrait(
    personId: string,
    portrait: {
      url: string | null;
      sourceId: string | null;
      sourceUrl?: string | null;
      credit?: string | null;
      rights?: "public-domain" | "licensed" | "all-rights-reserved" | "unknown";
      rightsNote?: string | null;
      retrievedAt?: string | null;
    },
  ): void {
    this.db.run(
      `UPDATE person SET portrait_url=?, portrait_source_id=?, portrait_source_url=?,
        portrait_credit=?, portrait_rights=?, portrait_rights_note=?, portrait_retrieved_at=?, updated_at=?
       WHERE id=?`,
      [
        portrait.url, portrait.sourceId, portrait.sourceUrl ?? null, portrait.credit ?? null,
        portrait.rights ?? "unknown", portrait.rightsNote ?? null,
        portrait.retrievedAt ?? null, now(), personId,
      ],
    );
  }

  /* -------------------------------------------------------- events / audit */

  upsertPositionEvent(event: {
    id: string;
    positionId?: string | null;
    personId: string;
    eventType: string;
    eventDate: string;
    title: string;
    description?: string | null;
    verification?: string;
  }): void {
    const [date, precision] = dateParts(event.eventDate);
    this.db.run(
      `INSERT INTO position_event
       (id,position_id,person_id,event_type,event_date,event_date_precision,title,description,verification,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         position_id=excluded.position_id, event_type=excluded.event_type,
         event_date=excluded.event_date, event_date_precision=excluded.event_date_precision,
         title=excluded.title, description=excluded.description`,
      [
        event.id, event.positionId ?? null, event.personId, event.eventType,
        date, precision, event.title, event.description ?? null,
        event.verification ?? "unverified", now(),
      ],
    );
  }

  listTimeline(personId: string) {
    return this.db.all(
      `SELECT * FROM position_event WHERE person_id=? ORDER BY event_date DESC`,
      [personId],
    );
  }

  /**
   * Record a change. Insert-only, and idempotent on the deterministic id so a
   * re-run cannot double-log the same transition.
   */
  insertChangeEvent(event: {
    id: string;
    entityType: string;
    entityId: string;
    fieldName: string;
    previousValue: string | null;
    newValue: string | null;
    changeKind?: string;
    sourceId?: string | null;
    snapshotId?: string | null;
    syncRunId?: string | null;
    detectedAt: string;
    actor: string;
  }): void {
    this.db.run(
      `INSERT INTO change_event
       (id,entity_type,entity_id,field_name,previous_value,new_value,change_kind,
        source_id,source_snapshot_id,sync_run_id,detected_at,verified_at,actor)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?)
       ON CONFLICT(id) DO NOTHING`,
      [
        event.id, event.entityType, event.entityId, event.fieldName,
        event.previousValue, event.newValue, event.changeKind ?? "field-changed",
        event.sourceId ?? null, event.snapshotId ?? null, event.syncRunId ?? null,
        event.detectedAt, event.actor,
      ],
    );
  }

  listChangeEvents(entityType?: string, entityId?: string, limit = 100) {
    return entityType && entityId
      ? this.db.all(
          `SELECT * FROM change_event WHERE entity_type=? AND entity_id=? ORDER BY detected_at DESC LIMIT ?`,
          [entityType, entityId, limit],
        )
      : this.db.all(`SELECT * FROM change_event ORDER BY detected_at DESC LIMIT ?`, [limit]);
  }

  countChangeEvents(): number {
    return this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM change_event`)?.n ?? 0;
  }

  /* ---------------------------------------------------- review / conflicts */

  insertIdentityReview(review: {
    id: string;
    incomingName: string;
    incomingPayload: string;
    candidatePersonId: string | null;
    confidence: string;
    signals: string[];
    sourceId: string | null;
    detectedAt: string;
  }): void {
    this.db.run(
      `INSERT INTO identity_review
       (id,incoming_name,incoming_payload,candidate_person_id,confidence,signals,source_id,detected_at)
       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      [
        review.id, review.incomingName, review.incomingPayload, review.candidatePersonId,
        review.confidence, review.signals.join(","), review.sourceId, review.detectedAt,
      ],
    );
  }

  countOpenIdentityReviews(): number {
    return this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM identity_review WHERE resolved_at IS NULL`,
    )?.n ?? 0;
  }

  /** Record a disagreement between two sources. Both claims are retained. */
  upsertConflict(conflict: {
    id: string;
    entityType: string;
    entityId: string;
    fieldName: string;
    factType: string;
    sourceAId: string; valueA: string | null; evidenceAId?: string | null;
    sourceBId: string; valueB: string | null; evidenceBId?: string | null;
    resolutionState: "unresolved" | "resolved-by-authority" | "resolved-by-review";
    resolvedValue?: string | null;
    resolvedSourceId?: string | null;
    detectedAt: string;
  }): void {
    this.db.run(
      `INSERT INTO source_conflict
       (id,entity_type,entity_id,field_name,fact_type,source_a_id,value_a,evidence_a_id,
        source_b_id,value_b,evidence_b_id,resolution_state,resolved_value,resolved_source_id,detected_at,resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(entity_type,entity_id,field_name,source_a_id,source_b_id) DO UPDATE SET
         value_a=excluded.value_a, value_b=excluded.value_b,
         resolution_state=excluded.resolution_state, resolved_value=excluded.resolved_value,
         resolved_source_id=excluded.resolved_source_id`,
      [
        conflict.id, conflict.entityType, conflict.entityId, conflict.fieldName, conflict.factType,
        conflict.sourceAId, conflict.valueA, conflict.evidenceAId ?? null,
        conflict.sourceBId, conflict.valueB, conflict.evidenceBId ?? null,
        conflict.resolutionState, conflict.resolvedValue ?? null, conflict.resolvedSourceId ?? null,
        conflict.detectedAt,
        conflict.resolutionState === "unresolved" ? null : conflict.detectedAt,
      ],
    );
  }

  listConflicts(entityId?: string) {
    return entityId
      ? this.db.all(`SELECT * FROM source_conflict WHERE entity_id=? ORDER BY detected_at DESC`, [entityId])
      : this.db.all(`SELECT * FROM source_conflict ORDER BY detected_at DESC`);
  }

  countConflicts(onlyUnresolved = false): number {
    const sql = onlyUnresolved
      ? `SELECT COUNT(*) AS n FROM source_conflict WHERE resolution_state='unresolved'`
      : `SELECT COUNT(*) AS n FROM source_conflict`;
    return this.db.get<{ n: number }>(sql)?.n ?? 0;
  }

  /* ------------------------------------------------------------ statistics */

  /* ------------------------------------------------------------ provenance */

  /**
   * Everything known about where one synchronised record came from.
   *
   * Answers, for any entity, the nine questions the integrity review asks:
   * canonical ID, source ID, current value, previous value(s), first-seen,
   * last-seen, source URL, source retrieval timestamp, and verification state.
   *
   * NOTE ON LAST-SEEN. It is DERIVED, not stored, and that is deliberate. An
   * unchanged sync run writes no canonical rows at all — that is the whole
   * point of comparing content hashes — so a stored `last_seen_at` column
   * would either sit stale while the source kept confirming the record, or
   * force 226 pointless row writes per run to stay accurate. The honest
   * answer is the later of the row's own `updated_at` and the last SUCCESSFUL
   * check of the source that is canonical for it: the source did confirm this
   * record at that moment, and said nothing had changed.
   */
  provenanceFor(entityType: string, entityId: string): {
    entityType: string;
    canonicalId: string;
    sourceId: string | null;
    currentValue: string | null;
    previousValues: Array<{ fieldName: string; previousValue: string | null; newValue: string | null; detectedAt: string }>;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    sourceUrl: string | null;
    sourceRetrievedAt: string | null;
    verification: string | null;
  } | null {
    // Only tables whose rows are synchronised records with provenance.
    // Anything else is a lookup table, not a claim about a person.
    const TABLES: Record<string, { table: string; valueColumn: string; sourceColumn?: string }> = {
      person: { table: "person", valueColumn: "canonical_name" },
      position: { table: "position", valueColumn: "title", sourceColumn: "canonical_source_id" },
      education: { table: "education", valueColumn: "qualification" },
      employment: { table: "employment", valueColumn: "title" },
      "public-service": { table: "public_service", valueColumn: "role" },
      affiliation: { table: "political_affiliation", valueColumn: "party_id" },
    };

    const spec = TABLES[entityType];
    if (!spec) return null;

    const row = this.db.get<Record<string, unknown>>(
      `SELECT * FROM ${spec.table} WHERE id=?`,
      [entityId],
    );
    if (!row) return null;

    // Evidence: the document this record came from. Most recent first, since
    // a re-import updates `retrieved_at` in place.
    const evidence = this.db.get<{ source_id: string; source_url: string | null; retrieved_at: string | null }>(
      `SELECT source_id, source_url, retrieved_at FROM source_evidence
        WHERE entity_type=? AND entity_id=? AND source_url IS NOT NULL
        ORDER BY retrieved_at DESC LIMIT 1`,
      [entityType, entityId],
    );

    const sourceId =
      (spec.sourceColumn ? (row[spec.sourceColumn] as string | null) : null) ?? evidence?.source_id ?? null;

    const previousValues = this.db.all<{
      field_name: string; previous_value: string | null; new_value: string | null; detected_at: string;
    }>(
      `SELECT field_name, previous_value, new_value, detected_at FROM change_event
        WHERE entity_type=? AND entity_id=? ORDER BY detected_at DESC`,
      [entityType, entityId],
    ).map((c) => ({
      fieldName: c.field_name,
      previousValue: c.previous_value,
      newValue: c.new_value,
      detectedAt: c.detected_at,
    }));

    // See the note above: the later of "when this row last changed" and
    // "when its source last successfully confirmed anything".
    const sourceCheck = sourceId
      ? this.db.get<{ last_successful_sync_at: string | null }>(
          `SELECT last_successful_sync_at FROM source WHERE id=?`,
          [sourceId],
        )?.last_successful_sync_at ?? null
      : null;
    const rowUpdatedAt = (row.updated_at as string | null) ?? null;
    const lastSeenAt =
      sourceCheck && rowUpdatedAt ? (sourceCheck > rowUpdatedAt ? sourceCheck : rowUpdatedAt) : sourceCheck ?? rowUpdatedAt;

    return {
      entityType,
      canonicalId: String(row.id),
      sourceId,
      currentValue: (row[spec.valueColumn] as string | null) ?? null,
      previousValues,
      firstSeenAt: (row.created_at as string | null) ?? null,
      lastSeenAt,
      sourceUrl: evidence?.source_url ?? null,
      sourceRetrievedAt: evidence?.retrieved_at ?? null,
      verification: (row.verification as string | null) ?? null,
    };
  }

  counts() {
    const one = (sql: string) => this.db.get<{ n: number }>(sql)?.n ?? 0;
    return {
      people: one(`SELECT COUNT(*) AS n FROM person`),
      demonstrationPeople: one(`SELECT COUNT(*) AS n FROM person WHERE is_demonstration=1`),
      positions: one(`SELECT COUNT(*) AS n FROM position`),
      openPositions: one(`SELECT COUNT(*) AS n FROM position WHERE end_date IS NULL`),
      closedPositions: one(`SELECT COUNT(*) AS n FROM position WHERE end_date IS NOT NULL`),
      parties: one(`SELECT COUNT(*) AS n FROM party`),
      districts: one(`SELECT COUNT(*) AS n FROM district`),
      affiliations: one(`SELECT COUNT(*) AS n FROM political_affiliation`),
      evidence: one(`SELECT COUNT(*) AS n FROM source_evidence`),
      snapshots: one(`SELECT COUNT(*) AS n FROM source_snapshot`),
      changeEvents: one(`SELECT COUNT(*) AS n FROM change_event`),
      identityReviews: one(`SELECT COUNT(*) AS n FROM identity_review WHERE resolved_at IS NULL`),
      conflicts: one(`SELECT COUNT(*) AS n FROM source_conflict`),
      unresolvedConflicts: one(`SELECT COUNT(*) AS n FROM source_conflict WHERE resolution_state='unresolved'`),
      elections: one(`SELECT COUNT(*) AS n FROM election`),
      education: one(`SELECT COUNT(*) AS n FROM education`),
      examResults: one(`SELECT COUNT(*) AS n FROM exam_result`),
      employment: one(`SELECT COUNT(*) AS n FROM employment`),
      publicService: one(`SELECT COUNT(*) AS n FROM public_service`),
      withProfession: one(`SELECT COUNT(*) AS n FROM person WHERE profession IS NOT NULL`),
      withDateOfBirth: one(`SELECT COUNT(*) AS n FROM person WHERE date_of_birth IS NOT NULL`),
      portraitsStored: one(`SELECT COUNT(*) AS n FROM person WHERE portrait_url IS NOT NULL`),
      // Rights ESTABLISHED — an explicit public-domain or licence grant.
      // Distinct from whether a portrait is displayed: see
      // PORTRAIT_DISPLAY_POLICY in src/data/portraitPolicy.ts. Recording the
      // rights status truthfully matters even when the display decision
      // differs, because the two are separate questions.
      portraitsRightsEstablished: one("SELECT COUNT(*) AS n FROM person WHERE portrait_url IS NOT NULL AND portrait_rights IN ('public-domain','licensed')"),
      portraitsRightsReserved: one("SELECT COUNT(*) AS n FROM person WHERE portrait_url IS NOT NULL AND portrait_rights = 'all-rights-reserved'"),
      syncRuns: one(`SELECT COUNT(*) AS n FROM sync_run`),
      sources: one(`SELECT COUNT(*) AS n FROM source`),
      connectedSources: one(`SELECT COUNT(*) AS n FROM source WHERE sync_state <> 'not-connected'`),
    };
  }
}
