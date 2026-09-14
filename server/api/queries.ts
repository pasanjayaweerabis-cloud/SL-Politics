/**
 * Javora — read queries backing the API.
 *
 * Separated from the HTTP layer so the same queries can be unit-tested
 * without a server, and so a Postgres implementation replaces one module
 * rather than the endpoints.
 *
 * BACKEND-AGNOSTIC BY CONSTRUCTION. Every function here takes a `Queryable`
 * — the minimal `get`/`all` shape both `server/db/database.ts`'s synchronous
 * SQLite `Database` and `server/db/postgres.ts`'s asynchronous
 * `AsyncDatabase` satisfy. Every call is `await`ed, which is a no-op on a
 * plain synchronous return value and a real wait on a Promise — so the SAME
 * function body runs correctly against either backend without a branch
 * anywhere. That is what lets `server/api/server.ts` route these five
 * endpoints to PostgreSQL when `DATABASE_URL` is set while the sync worker,
 * CLI and other endpoints continue against SQLite unchanged.
 *
 * Every query is SERVER-SIDE filtered and paginated. The browser must never
 * receive the whole database in order to render a search box — with 225
 * members that would merely be wasteful; with the historical membership it
 * would be untenable.
 *
 * Note what is NOT stored and therefore not selected: no `is_current` column
 * exists. Currency is derived in SQL from `end_date`/`start_date`/
 * `current_as_of` against the query date, so it cannot drift out of step with
 * the dates the way a stored flag would.
 */

import { normaliseName } from "../../src/lib/identity.ts";
import { parseListParam, parsePagination, parseSearchTerm } from "./validation.ts";

/** The minimal read shape both the SQLite and PostgreSQL backends satisfy. */
export interface Queryable {
  get<T = Record<string, unknown>>(sql: string, params?: unknown): T | null | Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown): T[] | Promise<T[]>;
}

export interface PersonSummary {
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

/**
 * SQL fragment deciding whether a position is held right now.
 *
 * Mirrors `isCurrent()` in src/lib/positions.ts: a recorded end date always
 * wins; otherwise the office counts as held if either a start date or a
 * source's dated "currently held" assertion has already arrived.
 */
const IS_CURRENT = `
  (p.end_date IS NULL
   AND (
     (p.start_date IS NOT NULL AND p.start_date <= :today)
     OR (p.start_date IS NULL AND p.current_as_of IS NOT NULL AND p.current_as_of <= :today)
   ))
`.trim();

/** The office a profile leads with: highest precedence among current ones. */
const HEADLINE = `
  (SELECT p.title FROM position p
    WHERE p.person_id = person.id AND ${IS_CURRENT}
    ORDER BY p.precedence ASC, p.title ASC LIMIT 1)
`.trim();

const HEADLINE_ROLE = `
  (SELECT p.role_type FROM position p
    WHERE p.person_id = person.id AND ${IS_CURRENT}
    ORDER BY p.precedence ASC, p.title ASC LIMIT 1)
`.trim();

const HEADLINE_PRECEDENCE = `
  COALESCE((SELECT p.precedence FROM position p
    WHERE p.person_id = person.id AND ${IS_CURRENT}
    ORDER BY p.precedence ASC LIMIT 1), 999)
`.trim();

const SERVING = `
  EXISTS (SELECT 1 FROM position p WHERE p.person_id = person.id AND ${IS_CURRENT})
`.trim();

/** Current party, taken from the open affiliation. */
const PARTY_JOIN = `
  LEFT JOIN political_affiliation aff
    ON aff.person_id = person.id AND aff.end_date IS NULL
  LEFT JOIN party ON party.id = aff.party_id
`;

/** District from the person's current parliamentary seat. */
const DISTRICT_SELECT = `
  (SELECT d.id FROM position p JOIN district d ON d.id = p.district_id
    WHERE p.person_id = person.id AND p.district_id IS NOT NULL
    ORDER BY (p.end_date IS NOT NULL), p.precedence LIMIT 1)
`.trim();

const DISTRICT_NAME_SELECT = `
  (SELECT d.name FROM district d WHERE d.id = ${DISTRICT_SELECT})
`.trim();

/*
 * Every multi-word alias below is double-quoted. Unquoted, PostgreSQL folds
 * identifiers — including `AS` aliases — to lowercase, so `AS headlineTitle`
 * comes back as the column key `headlinetitle`; SQLite preserves the alias
 * exactly as written. Without the quotes, `toSummary()`'s `row.headlineTitle`
 * reads `undefined` on Postgres and every derived field silently goes null —
 * found by running the identical query against both engines and diffing the
 * result, not by inspection; it produces no error, just quietly wrong output.
 */
const SUMMARY_COLUMNS = `
  person.id, person.slug, person.canonical_name AS name,
  party.id AS "partyId", party.name AS "partyName", party.abbreviation AS "partyAbbreviation",
  ${DISTRICT_SELECT} AS "districtId",
  ${DISTRICT_NAME_SELECT} AS "districtName",
  ${HEADLINE} AS "headlineTitle",
  ${HEADLINE_ROLE} AS "headlineRoleType",
  ${HEADLINE_PRECEDENCE} AS "headlinePrecedence",
  ${SERVING} AS "servingFlag",
  person.verification, person.portrait_url AS "portraitUrl"
`;

function toSummary(row: Record<string, unknown>): PersonSummary {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    partyId: (row.partyId as string) ?? null,
    partyName: (row.partyName as string) ?? null,
    partyAbbreviation: (row.partyAbbreviation as string) ?? null,
    districtId: (row.districtId as string) ?? null,
    districtName: (row.districtName as string) ?? null,
    headlineTitle: (row.headlineTitle as string) ?? null,
    headlineRoleType: (row.headlineRoleType as string) ?? null,
    serving: Boolean(row.servingFlag),
    verification: String(row.verification),
    portraitUrl: (row.portraitUrl as string) ?? null,
  };
}

export interface ListOptions {
  q?: string;
  party?: string[];
  district?: string[];
  role?: string[];
  status?: string[];
  limit?: number;
  offset?: number;
  today?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Build the WHERE clause and bindings for a listing.
 *
 * Every value is bound as a parameter, never interpolated — the search box is
 * user input reaching a database, and string-building a query with it is how
 * injection happens.
 */
function buildFilter(options: ListOptions) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = { today: options.today ?? new Date().toISOString().slice(0, 10) };

  if (options.q?.trim()) {
    // Token-prefix matching, mirroring lib/identity.ts: every term must match
    // some token, so extra terms narrow rather than widen.
    const terms = normaliseName(options.q).split(" ").filter(Boolean);
    if (terms.length) {
      terms.forEach((term, i) => {
        const key = `q${i}`;
        // A term matches at the start of the text or after a space.
        clauses.push(`(s.search_text LIKE :${key}_a OR s.search_text LIKE :${key}_b)`);
        params[`${key}_a`] = `${term}%`;
        params[`${key}_b`] = `% ${term}%`;
      });
    } else {
      // The raw query was non-empty but normalised to nothing at all (e.g.
      // "%", "___" — see L-1, docs/security-audit-followup-2026-09-04.md).
      // Falling through here would add no clause at all, which reads as "no
      // search filter" and matches every row — the same wrong outcome the
      // unescaped LIKE wildcard produced, reached a different way. A query
      // that normalises to nothing must match nothing.
      clauses.push("1=0");
    }
  }

  const inList = (column: string, values: string[] | undefined, prefix: string) => {
    if (!values?.length) return;
    const keys = values.map((value, i) => {
      params[`${prefix}${i}`] = value;
      return `:${prefix}${i}`;
    });
    clauses.push(`${column} IN (${keys.join(",")})`);
  };

  inList("party.id", options.party, "party");
  inList(DISTRICT_SELECT, options.district, "district");

  if (options.role?.length) {
    const keys = options.role.map((value, i) => {
      params[`role${i}`] = value;
      return `:role${i}`;
    });
    clauses.push(
      `EXISTS (SELECT 1 FROM position p WHERE p.person_id = person.id AND p.role_type IN (${keys.join(",")}))`,
    );
  }

  if (options.status?.length === 1) {
    clauses.push(options.status[0] === "serving" ? SERVING : `NOT ${SERVING}`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const SEARCH_JOIN = `LEFT JOIN person_search s ON s.person_id = person.id`;

export async function listPeople(db: Queryable, options: ListOptions = {}): Promise<Page<PersonSummary>> {
  const limit = Math.min(Math.max(1, options.limit ?? 25), 200);
  const offset = Math.max(0, options.offset ?? 0);
  const { where, params } = buildFilter(options);

  const totalRow = await db.get<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM person ${PARTY_JOIN} ${SEARCH_JOIN} ${where}`,
    params as never,
  );
  // node-postgres returns COUNT(*) as a string (Postgres's bigint has more
  // range than a JS number, so the driver won't silently narrow it) while
  // node:sqlite returns a plain number for the same query. Coercing here is
  // what keeps the API's response SHAPE — a JSON number, not sometimes a
  // string — identical regardless of which database answered it.
  const total = Number(totalRow?.n ?? 0);

  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM person ${PARTY_JOIN} ${SEARCH_JOIN}
     ${where}
     ORDER BY "servingFlag" DESC, "headlinePrecedence" ASC, person.canonical_name ASC
     LIMIT :limit OFFSET :offset`,
    { ...params, limit, offset } as never,
  );

  return {
    items: rows.map(toSummary),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}

/**
 * Typeahead suggestions.
 *
 * Ranked so direct name matches beat incidental ones: typing "anura" should
 * surface people called Anura before members from Anuradhapura district, even
 * though both are legitimate matches.
 */
export async function suggestPeople(db: Queryable, query: string, limit = 8, today?: string): Promise<PersonSummary[]> {
  if (!query.trim()) return [];
  const { where, params } = buildFilter({ q: query, today });
  const terms = normaliseName(query).split(" ").filter(Boolean);

  const nameRank = terms.length
    ? terms
        .map((term, i) => {
          params[`n${i}`] = `${term}%`;
          params[`n${i}b`] = `% ${term}%`;
          return `(LOWER(person.canonical_name) LIKE :n${i} OR LOWER(person.canonical_name) LIKE :n${i}b)`;
        })
        .join(" AND ")
    : "1";

  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${SUMMARY_COLUMNS}, CASE WHEN ${nameRank} THEN 0 ELSE 1 END AS nameRank
     FROM person ${PARTY_JOIN} ${SEARCH_JOIN}
     ${where}
     ORDER BY nameRank ASC, "servingFlag" DESC, "headlinePrecedence" ASC, person.canonical_name ASC
     LIMIT :limit`,
    { ...params, limit: Math.min(Math.max(1, limit), 25) } as never,
  );

  return rows.map(toSummary);
}

/* ==========================================================================
   getPerson — the full profile record
   ========================================================================== */

/**
 * These mirror `CanonicalStore`'s own read methods in server/db/store.ts
 * exactly (same tables, same ordering) but go through `Queryable` directly
 * rather than through the store, so this endpoint works against whichever
 * backend the API was started with. `CanonicalStore` itself stays
 * synchronous/SQLite-only — it is the sync worker and CLI's write path, and
 * converting it is a separate, larger undertaking than hardening five read
 * endpoints (see server/db/postgres.ts's header for that scope).
 */

/*
 * M-2. Every `SELECT *` below on this public-read path is replaced with an
 * explicit column list, so a future migration's `ALTER TABLE ADD COLUMN`
 * cannot be published here by default — the opposite of the deny-by-default
 * rule SECURITY--SL Politics.md §5.2 states. `person`, `change_event` and
 * `source_conflict` additionally go through a `toPublicXxx()` mapper as a
 * second, independent layer: even a `SELECT *` reintroduced by a careless
 * future edit would still be narrowed before it reaches a response.
 */

const PERSON_COLUMNS = `
  id, slug, canonical_name, name_en, name_si, name_ta,
  date_of_birth, date_of_birth_precision, date_of_death, date_of_death_precision,
  gender, biography, portrait_url, portrait_source_id, portrait_credit, portrait_retrieved_at,
  verification, verified_at, is_demonstration, profession, place_of_birth, nationality
`.trim();

/** Identity-shaped on purpose: enumerating every field here, even unchanged, is the choke point a future `SELECT *` regression would still be caught by. */
function toPublicPerson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, slug: row.slug, canonical_name: row.canonical_name, name_en: row.name_en,
    name_si: row.name_si, name_ta: row.name_ta,
    date_of_birth: row.date_of_birth, date_of_birth_precision: row.date_of_birth_precision,
    date_of_death: row.date_of_death, date_of_death_precision: row.date_of_death_precision,
    gender: row.gender, biography: row.biography,
    portrait_url: row.portrait_url, portrait_source_id: row.portrait_source_id,
    portrait_credit: row.portrait_credit, portrait_retrieved_at: row.portrait_retrieved_at,
    verification: row.verification, verified_at: row.verified_at,
    is_demonstration: row.is_demonstration, profession: row.profession,
    place_of_birth: row.place_of_birth, nationality: row.nationality,
  };
}

async function findPerson(db: Queryable, idOrSlug: string) {
  const bySlug = await db.get<Record<string, unknown>>(`SELECT ${PERSON_COLUMNS} FROM person WHERE slug=?`, [idOrSlug]);
  if (bySlug) return bySlug;
  return db.get<Record<string, unknown>>(`SELECT ${PERSON_COLUMNS} FROM person WHERE id=?`, [idOrSlug]);
}

const POSITION_COLUMNS = `
  id, person_id, title, role_type, institution, ministry, district_id, constituency,
  start_date, start_date_precision, end_date, end_date_precision, current_as_of,
  appointment_type, precedence, verification, verified_at, canonical_source_id, superseded_by
`.trim();

const listPositionsSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${POSITION_COLUMNS} FROM position WHERE person_id=? ORDER BY (end_date IS NOT NULL), precedence, title`,
    [personId],
  );

const AFFILIATION_COLUMNS = `
  a.id, a.person_id, a.party_id, a.role, a.start_date, a.end_date, a.current_as_of,
  a.verification, a.verified_at
`.trim();

const listAffiliationsSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${AFFILIATION_COLUMNS}, p.name AS party_name, p.abbreviation AS party_abbreviation
     FROM political_affiliation a JOIN party p ON p.id=a.party_id
     WHERE a.person_id=? ORDER BY (a.end_date IS NOT NULL), a.start_date DESC`,
    [personId],
  );

const POSITION_EVENT_COLUMNS = `
  id, position_id, person_id, event_type, event_date, event_date_precision,
  title, description, verification, verified_at
`.trim();

const listTimelineSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${POSITION_EVENT_COLUMNS} FROM position_event WHERE person_id=? ORDER BY event_date DESC`,
    [personId],
  );

const EDUCATION_COLUMNS = `
  id, person_id, education_type, institution, qualification, field,
  start_date, start_date_precision, end_date, end_date_precision,
  completion, verification, verified_at
`.trim();

const listEducationSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${EDUCATION_COLUMNS} FROM education WHERE person_id=?
     ORDER BY CASE education_type
       WHEN 'school' THEN 1 WHEN 'university' THEN 2
       WHEN 'postgraduate' THEN 3 WHEN 'professional' THEN 4 ELSE 5 END,
       (end_date IS NULL), end_date DESC`,
    [personId],
  );

const EXAM_RESULT_COLUMNS = `id, person_id, exam_type, exam_year, stream, subject, grade, verification, verified_at`;

const listExamResultsSql = (db: Queryable, personId: string) =>
  db.all(`SELECT ${EXAM_RESULT_COLUMNS} FROM exam_result WHERE person_id=? ORDER BY exam_type, subject`, [personId]);

const EMPLOYMENT_COLUMNS = `
  id, person_id, organisation, title, employment_type, description,
  start_date, start_date_precision, end_date, end_date_precision,
  current_as_of, verification, verified_at
`.trim();

const listEmploymentSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${EMPLOYMENT_COLUMNS} FROM employment WHERE person_id=? ORDER BY (end_date IS NOT NULL), end_date DESC, start_date DESC`,
    [personId],
  );

const PUBLIC_SERVICE_COLUMNS = `
  id, person_id, institution, role, service_type,
  start_date, start_date_precision, end_date, end_date_precision,
  current_as_of, verification, verified_at
`.trim();

const listPublicServiceSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${PUBLIC_SERVICE_COLUMNS} FROM public_service WHERE person_id=? ORDER BY (end_date IS NOT NULL), end_date DESC`,
    [personId],
  );

const EVIDENCE_COLUMNS = `
  e.id, e.source_id, e.entity_type, e.entity_id, e.field_name, e.source_url,
  e.document_title, e.published_at, e.retrieved_at, e.locator, e.notes
`.trim();

const evidenceForPersonSql = (db: Queryable, personId: string) =>
  db.all(
    `SELECT ${EVIDENCE_COLUMNS} FROM source_evidence e
     WHERE (e.entity_type='person' AND e.entity_id=?)
        OR (e.entity_type='position' AND e.entity_id IN (SELECT id FROM position WHERE person_id=?))
        OR (e.entity_type='affiliation' AND e.entity_id IN (SELECT id FROM political_affiliation WHERE person_id=?))
     ORDER BY e.entity_type, e.source_id`,
    [personId, personId, personId],
  );

/**
 * `change_event.actor` is a sync identifier today (always "sync-worker" or
 * similar) and, the day §5's administration exists, becomes an
 * administrative account identifier this endpoint would otherwise start
 * publishing automatically, with no code change and no review. Dropped from
 * both the SQL and the response — never selected, so there is nothing to
 * accidentally forward even if the mapper below were bypassed.
 */
const CHANGE_EVENT_COLUMNS = `
  id, entity_type, entity_id, field_name, previous_value, new_value,
  change_kind, source_id, detected_at, verified_at
`.trim();

function toPublicChange(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, field_name: row.field_name,
    previous_value: row.previous_value, new_value: row.new_value, change_kind: row.change_kind,
    source_id: row.source_id, detected_at: row.detected_at, verified_at: row.verified_at,
  };
}

const listChangeEventsSql = async (db: Queryable, personId: string, limit: number) => {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${CHANGE_EVENT_COLUMNS} FROM change_event WHERE entity_type=? AND entity_id=? ORDER BY detected_at DESC LIMIT ?`,
    ["person", personId, limit],
  );
  return rows.map(toPublicChange);
};

const CONFLICT_COLUMNS = `
  id, entity_type, entity_id, field_name, fact_type,
  source_a_id, value_a, evidence_a_id, source_b_id, value_b, evidence_b_id,
  resolution_state, resolved_value, resolved_source_id, detected_at, resolved_at
`.trim();

function toPublicConflict(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, field_name: row.field_name,
    fact_type: row.fact_type,
    source_a_id: row.source_a_id, value_a: row.value_a, evidence_a_id: row.evidence_a_id,
    source_b_id: row.source_b_id, value_b: row.value_b, evidence_b_id: row.evidence_b_id,
    resolution_state: row.resolution_state, resolved_value: row.resolved_value,
    resolved_source_id: row.resolved_source_id, detected_at: row.detected_at, resolved_at: row.resolved_at,
  };
}

const listConflictsSql = async (db: Queryable, personId: string) => {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${CONFLICT_COLUMNS} FROM source_conflict WHERE entity_id=? ORDER BY detected_at DESC`,
    [personId],
  );
  return rows.map(toPublicConflict);
};

export async function getPerson(db: Queryable, idOrSlug: string, today?: string) {
  const person = await findPerson(db, idOrSlug);
  if (!person) return null;

  const day = today ?? new Date().toISOString().slice(0, 10);
  const personId = String(person.id);

  // Nine independent reads: run concurrently rather than one round trip at a
  // time. Against SQLite this makes no difference (the driver is
  // synchronous regardless of how many `await`s wrap it); against a
  // network-hop backend like Postgres it is the difference between one
  // round-trip latency and nine serialised ones for a single profile page.
  const [positionsRaw, affiliations, timeline, education, examResults, employment, publicService, evidence, changes, conflicts] =
    await Promise.all([
      listPositionsSql(db, personId),
      listAffiliationsSql(db, personId),
      listTimelineSql(db, personId),
      listEducationSql(db, personId),
      listExamResultsSql(db, personId),
      listEmploymentSql(db, personId),
      listPublicServiceSql(db, personId),
      evidenceForPersonSql(db, personId),
      listChangeEventsSql(db, personId, 20),
      listConflictsSql(db, personId),
    ]);

  const positions = (positionsRaw as Array<Record<string, unknown>>).map((p) => ({
    ...p,
    // Derived here, never stored.
    current:
      !p.end_date &&
      (p.start_date ?? p.current_as_of ?? "") !== "" &&
      ((p.start_date ?? p.current_as_of) as string) <= day,
  }));

  return {
    person: toPublicPerson(person),
    // ---- Political Career tab -------------------------------------------
    positions,
    affiliations,
    timeline,
    // ---- Education & Career tab -----------------------------------------
    education,
    examResults,
    employment,
    publicService,
    // ---- Provenance ------------------------------------------------------
    evidence,
    changes,
    conflicts,
  };
}

/** node-postgres returns COUNT(...) as a string; node:sqlite returns a number. Coerced so the response shape never depends on which database answered. */
const withNumericCount = (rows: Array<Record<string, unknown>>) =>
  rows.map((row) => ({ ...row, count: Number(row.count) }));

export async function getFacets(db: Queryable) {
  const [parties, districts, roles] = await Promise.all([
    db.all<Record<string, unknown>>(
      `SELECT party.id, party.name, party.abbreviation, COUNT(*) AS count
       FROM political_affiliation aff JOIN party ON party.id = aff.party_id
       WHERE aff.end_date IS NULL
       GROUP BY party.id, party.name, party.abbreviation ORDER BY count DESC`,
    ),
    db.all<Record<string, unknown>>(
      `SELECT d.id, d.name, COUNT(DISTINCT p.person_id) AS count
       FROM position p JOIN district d ON d.id = p.district_id
       GROUP BY d.id, d.name ORDER BY count DESC`,
    ),
    db.all<Record<string, unknown>>(
      `SELECT role_type AS id, COUNT(DISTINCT person_id) AS count
       FROM position GROUP BY role_type ORDER BY count DESC`,
    ),
  ]);

  return { parties: withNumericCount(parties), districts: withNumericCount(districts), roles: withNumericCount(roles) };
}

/* ==========================================================================
   Request-parameter parsing
   ========================================================================== */

/**
 * Turn raw URL search params into validated `ListOptions`.
 *
 * The one place `/api/people` and `/api/search`'s query parsing has to agree
 * with what `parsePagination`/`parseListParam` enforce — pulled out of
 * `server.ts` so the HTTP layer stays free of validation logic and this stays
 * testable without an HTTP request.
 */
export function parseListOptions(params: URLSearchParams): ListOptions {
  const { limit, offset } = parsePagination(params);
  return {
    q: parseSearchTerm(params.get("q")),
    party: parseListParam(params, "party"),
    district: parseListParam(params, "district"),
    role: parseListParam(params, "role"),
    status: parseListParam(params, "status"),
    limit,
    offset,
  };
}
