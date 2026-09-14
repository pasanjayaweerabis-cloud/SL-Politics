-- Javora — migration 002: education, employment, public service, portraits.
--
-- Adds the "Education & Career" half of a person's record: the structures the
-- profile's first tab renders.
--
-- ============================================================================
-- SUPERSEDED IN PART BY 003. READ THIS FIRST.
--
-- The paragraph below is WRONG and is left in place because a migration is a
-- historical record, not a document to be quietly corrected.
--
-- It claims Parliament publishes no education data. That conclusion came from
-- reading only the labelled fields at the top of a member's profile page. The
-- qualifications live in tab panes further down the SAME page, and Parliament
-- publishes academic qualifications for 175 of the 225 sitting members.
--
-- Migration 003 rebuilds the `education` table accordingly. See
-- server/fetchers/parliamentProfileDetail.ts.
-- ============================================================================
--
-- A NOTE ON WHAT THESE TABLES WILL AND WILL NOT CONTAIN
--
-- These are real structures with real constraints, and they are almost
-- entirely EMPTY, because no authoritative Sri Lankan source publishes the
-- data. Parliament's member profile exposes exactly eleven fields — District,
-- Portfolio, Date of Birth, Religion, Civil Status, Legislative Service,
-- Profession, Political Party, two Addresses and Email. There is no school,
-- no university, no degree, no examination result.
--
-- G.C.E. O/L and A/L results in particular are individual examination records
-- held by the Department of Examinations. They are not published for any
-- citizen, politician or otherwise, and they are personal data. The `exam_result`
-- table exists so that a genuinely authoritative disclosure (a candidate's own
-- published record, say) has somewhere correct to live — never so that results
-- can be inferred from a biography.
--
-- Empty-but-correct is the honest state. The profile renders "Not publicly
-- verified" against these sections rather than leaving a silent gap that
-- invites the reader to assume the person has no education.

-- ---------------------------------------------------------------- education

CREATE TABLE IF NOT EXISTS education (
  id             TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  -- What KIND of education this row records, so the profile can group
  -- school / university / postgraduate / professional without guessing.
  education_type TEXT NOT NULL
                   CHECK (education_type IN ('school','university','postgraduate','professional','other')),
  institution    TEXT NOT NULL,
  -- "Bachelor of Arts", "MPhil", "Diploma". NULL when a source names the
  -- institution but not the award.
  qualification  TEXT,
  field          TEXT,
  start_date     TEXT,
  start_date_precision TEXT CHECK (start_date_precision IN ('year','month','day')),
  end_date       TEXT,
  end_date_precision   TEXT CHECK (end_date_precision IN ('year','month','day')),
  -- Whether the award was completed, where a source actually says so.
  -- 'unknown' is the correct default; attending is not graduating.
  completion     TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (completion IN ('completed','incomplete','ongoing','unknown')),
  verification   TEXT NOT NULL DEFAULT 'unverified',
  verified_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  CHECK (verification <> 'verified' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_education_person ON education (person_id, education_type);

-- ---------------------------------------------------------- exam results
--
-- G.C.E. Ordinary and Advanced Level. One row per SUBJECT, not one row per
-- examination: a grade belongs to a subject, and flattening them into a text
-- blob would make the whole thing unqueryable and unciteable.
--
-- Every row demands its own evidence. There is no path by which a grade
-- enters this table without a source naming it.

CREATE TABLE IF NOT EXISTS exam_result (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  exam_type    TEXT NOT NULL CHECK (exam_type IN ('ol','al')),
  exam_year    TEXT,
  -- A/L stream: Physical Science, Biological Science, Commerce, Arts…
  stream       TEXT,
  subject      TEXT NOT NULL,
  grade        TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'unverified',
  verified_at  TEXT,
  created_at   TEXT NOT NULL,

  UNIQUE (person_id, exam_type, subject),
  CHECK (verification <> 'verified' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_exam_person ON exam_result (person_id, exam_type);

-- ---------------------------------------------------------- employment

-- Professional employment OUTSIDE public office.
--
-- Political and public offices live in `position` and must not be duplicated
-- here: a ministry is not a job someone applied for, and listing it as
-- "employment" would double-count a person's career and blur the line the
-- two profile tabs exist to draw.
CREATE TABLE IF NOT EXISTS employment (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  organisation    TEXT NOT NULL,
  title           TEXT NOT NULL,
  employment_type TEXT,
  description     TEXT,
  start_date      TEXT,
  start_date_precision TEXT CHECK (start_date_precision IN ('year','month','day')),
  end_date        TEXT,
  end_date_precision   TEXT CHECK (end_date_precision IN ('year','month','day')),
  current_as_of   TEXT,
  verification    TEXT NOT NULL DEFAULT 'unverified',
  verified_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,

  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (verification <> 'verified' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_employment_person ON employment (person_id);

-- ------------------------------------------------------- public service

-- Commissions, boards, academic and professional bodies: public roles that
-- are neither elected/ministerial office nor ordinary employment.
CREATE TABLE IF NOT EXISTS public_service (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  institution   TEXT NOT NULL,
  role          TEXT NOT NULL,
  service_type  TEXT,
  start_date    TEXT,
  start_date_precision TEXT CHECK (start_date_precision IN ('year','month','day')),
  end_date      TEXT,
  end_date_precision   TEXT CHECK (end_date_precision IN ('year','month','day')),
  current_as_of TEXT,
  verification  TEXT NOT NULL DEFAULT 'unverified',
  verified_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,

  CHECK (verification <> 'verified' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_public_service_person ON public_service (person_id);

-- ------------------------------------------------------------ person fields

-- Profession as the source states it — a single descriptor such as
-- "Attorney-at-Law" or "Teacher". This is NOT an employment record: it names
-- what someone is, with no employer, no dates and no post. Deriving an
-- `employment` row from it would manufacture a job history nobody published.
ALTER TABLE person ADD COLUMN profession TEXT;

ALTER TABLE person ADD COLUMN place_of_birth TEXT;
ALTER TABLE person ADD COLUMN nationality TEXT;

-- Portrait rights.
--
-- 'unknown' is the default and, for every portrait currently held, the
-- accurate value: parliament.lk carries "Copyright © The Parliament of Sri
-- Lanka. All Rights Reserved." A government publishing an image is not a
-- grant of reuse, so the UI shows the monogram unless rights are
-- 'public-domain' or 'licensed'. The URL and provenance are still stored, so
-- the record of where the official portrait lives is not lost.
ALTER TABLE person ADD COLUMN portrait_rights TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE person ADD COLUMN portrait_rights_note TEXT;
ALTER TABLE person ADD COLUMN portrait_source_url TEXT;
