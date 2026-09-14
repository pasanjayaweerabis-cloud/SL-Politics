-- Javora — migration 003: Parliament detail panes, legal challenges, and the
-- research-file staging layer.
--
-- WHY THIS MIGRATION EXISTS
--
-- Migration 002 was written on the finding that the Parliament of Sri Lanka
-- publishes no education data. That finding was wrong. It came from reading
-- only the eleven labelled fields at the top of a member profile; the rest of
-- the record — Qualifications, Legislative History, Portfolios Held,
-- Ministerial Services — sits in tab panes further down the SAME HTML
-- document, which the connector was downloading and discarding.
--
-- Parliament publishes academic qualifications for 175 of the 225 sitting
-- members and per-member parliamentary service dates for all 225. The
-- education tables built in 002 are therefore no longer correct-but-empty;
-- they need to hold real Tier 1 data, and their shape has to change to do it
-- honestly.
--
-- THE SHAPE CHANGE
--
-- `education.institution` was NOT NULL. Parliament routinely names an award
-- without naming the awarding body ("BA (Hons) Sociology", "MBBS"). A NOT NULL
-- column forces a choice between discarding a real credential and inventing an
-- institution for it. NULL is the correct representation of "the source states
-- the award and not the awarding body", so the column becomes nullable.
--
-- The education tables are empty (verified before writing this migration), so
-- they are dropped and recreated rather than patched. That keeps the SQL
-- portable between SQLite and PostgreSQL — neither ALTER COLUMN DROP NOT NULL
-- nor SQLite's twelve-step table rebuild is portable — and destroys no data.

-- ------------------------------------------------------------------ education

DROP TABLE IF EXISTS education;

CREATE TABLE education (
  id             TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  education_type TEXT NOT NULL
                   CHECK (education_type IN ('school','university','postgraduate','professional','other')),
  -- NULL when the source states the award but not the awarding body.
  institution    TEXT,
  qualification  TEXT,
  field          TEXT,

  -- Set for a G.C.E. Ordinary or Advanced Level entry. Parliament lists these
  -- among academic qualifications, so they arrive through the same channel as
  -- degrees but belong in their own sections of the profile.
  --
  -- Recording the EXAMINATION is not recording RESULTS. Grades live in
  -- exam_result and remain empty: individual examination records are personal
  -- data held by the Department of Examinations and are published for nobody.
  exam_level     TEXT CHECK (exam_level IN ('ol','al')),
  stream         TEXT,

  start_date     TEXT,
  start_date_precision TEXT CHECK (start_date_precision IN ('year','month','day')),
  end_date       TEXT,
  end_date_precision   TEXT CHECK (end_date_precision IN ('year','month','day')),
  completion     TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (completion IN ('completed','incomplete','ongoing','unknown')),

  -- The source's own words, before any classification this platform applied.
  -- Classification is a judgement; the verbatim string is the evidence, and
  -- keeping it means a misclassification can always be audited and corrected
  -- without re-fetching.
  source_text    TEXT,

  verification   TEXT NOT NULL DEFAULT 'unverified',
  verified_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  CHECK (verification <> 'verified' OR verified_at IS NOT NULL),
  -- A row must say SOMETHING. An entry with neither institution nor award is
  -- not a record of an education, it is an empty row with a person attached.
  CHECK (institution IS NOT NULL OR qualification IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_education_person ON education (person_id, education_type);
CREATE INDEX IF NOT EXISTS idx_education_exam ON education (person_id, exam_level)
  WHERE exam_level IS NOT NULL;

-- ------------------------------------------------------------ legal challenge
--
-- A challenge to a member's mandate — a Court of Appeal writ petition, an
-- election petition, a disqualification application.
--
-- THIS TABLE RECORDS THAT A CHALLENGE EXISTS. IT DOES NOT RECORD A VERDICT.
--
-- Two sitting members are the subject of Quo Warranto petitions under Article
-- 91 of the Constitution. A petition is an allegation. Presenting one as
-- established fact would tell readers that a sitting MP is disqualified when
-- no court has decided anything, which is both false and defamatory.
--
-- `outcome` therefore defaults to 'pending' and can only become a decided
-- value when `decided_on` and `decision_source_id` are both present — there is
-- no path by which a case is marked concluded without a dated, sourced
-- decision.
CREATE TABLE IF NOT EXISTS legal_challenge (
  id             TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  -- 'quo-warranto', 'election-petition', 'disqualification', 'other'
  challenge_type TEXT NOT NULL,
  -- The court or body hearing it, verbatim.
  forum          TEXT,
  case_reference TEXT,
  -- Who brought it, where a source names them.
  petitioner     TEXT,
  -- The ground asserted, in the petition's own terms. NOT a finding.
  claim_summary  TEXT NOT NULL,
  filed_on       TEXT,
  filed_on_precision TEXT CHECK (filed_on_precision IN ('year','month','day')),

  outcome        TEXT NOT NULL DEFAULT 'pending'
                   CHECK (outcome IN ('pending','withdrawn','dismissed','upheld','other')),
  decided_on     TEXT,
  decision_summary TEXT,
  decision_source_id TEXT REFERENCES source(id),

  verification   TEXT NOT NULL DEFAULT 'unverified',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  -- A concluded case needs a date AND a source for the conclusion.
  CHECK (outcome = 'pending' OR (decided_on IS NOT NULL AND decision_source_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_legal_challenge_person ON legal_challenge (person_id);

-- ------------------------------------------------------- research staging
--
-- Research inputs are NOT canonical data and never write to canonical tables
-- directly. They land here first, are matched and reconciled against what the
-- authoritative sources say, and only then does anything get promoted.
--
-- The point of the staging layer is auditability: every row keeps the file,
-- the line number and the verbatim text it came from, so any promoted fact can
-- be traced back to the sentence that produced it in one step.

CREATE TABLE IF NOT EXISTS research_document (
  id            TEXT PRIMARY KEY,
  file_name     TEXT NOT NULL,
  -- Hash of the file contents, so a re-run against an edited file is visible.
  content_hash  TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  ingested_at   TEXT NOT NULL,
  -- What kind of document this is. Research compilations are Tier 3/4 by
  -- nature; recording that here stops a later reader assuming otherwise.
  document_kind TEXT NOT NULL DEFAULT 'research-compilation'
);

CREATE TABLE IF NOT EXISTS research_claim (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES research_document(id) ON DELETE CASCADE,
  -- The name as the FILE writes it, before any matching.
  subject_name  TEXT NOT NULL,
  -- Resolved during reconciliation; NULL means unmatched.
  person_id     TEXT REFERENCES person(id) ON DELETE SET NULL,
  match_method  TEXT,
  match_confidence TEXT CHECK (match_confidence IN ('exact','strong','weak','none')),

  field         TEXT NOT NULL,
  value         TEXT NOT NULL,
  cited_source  TEXT,
  source_url    TEXT,
  source_tier   INTEGER NOT NULL CHECK (source_tier BETWEEN 1 AND 4),
  -- The file's own confidence label, preserved unchanged.
  self_reported_status TEXT,

  -- Provenance back to the original file.
  line_number   INTEGER NOT NULL,
  raw_text      TEXT NOT NULL,

  -- What reconciliation decided. 'corroborates' means an authoritative source
  -- already states this and the claim added nothing; 'promoted' means it
  -- became a canonical record; 'conflict' means it disagrees with an
  -- authoritative source and was NOT applied.
  disposition   TEXT NOT NULL DEFAULT 'staged'
                  CHECK (disposition IN ('staged','corroborates','promoted','conflict','rejected','unmatched')),
  disposition_note TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_claim_person ON research_claim (person_id, field);
CREATE INDEX IF NOT EXISTS idx_research_claim_disposition ON research_claim (disposition);
CREATE INDEX IF NOT EXISTS idx_research_claim_subject ON research_claim (subject_name);
