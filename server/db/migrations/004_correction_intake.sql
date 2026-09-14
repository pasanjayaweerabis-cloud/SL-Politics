-- Javora — migration 004: the corrections intake column.
--
-- WHY THIS MIGRATION EXISTS
--
-- `correction_report` has existed since 001 with no write path: the form in
-- `src/pages/CorrectionsPage.jsx` validated a report and showed it back to
-- the reporter, because the API was GET-only and there was nowhere to send
-- it. `POST /api/corrections` (server/api/corrections.ts) is that write path,
-- built to `docs/corrections-security-design.md`, and it needs one column the
-- table does not have.
--
-- WHAT IT ADDS
--
-- `submitter_ip_hash` — the abuse signal the design document's "Rate limiting
-- and abuse control" section asks for. A moderator triaging the queue needs
-- to be able to see "twelve open reports from the same network in the last
-- hour", because the realistic failure mode for this feature is not a
-- corrupted database, it is a reviewer approving something false because the
-- volume of noise made careful review impractical. Comparing reports needs a
-- stable per-reporter token; it does not need the address itself.
--
-- So this is a SALTED hash (see `hashReporter` in server/api/corrections.ts),
-- not the address and not a bare digest of it: an unsalted hash of a 32-bit
-- address space is recoverable by brute force in seconds, which would make
-- storing "not the raw IP" a distinction with no difference. Two reports from
-- one network compare equal; nothing here reconstructs where they came from.
--
-- The existing `submitter_contact` column is NOT reused for this. It means
-- what its name says — a contact address a reporter chose to leave — and
-- overloading it with an opaque token would make both meanings unreadable.
-- The endpoint collects no contact address today and writes NULL there.

ALTER TABLE correction_report ADD COLUMN submitter_ip_hash TEXT;

-- Triage query: the open queue, newest first, grouped by reporter token.
CREATE INDEX IF NOT EXISTS idx_correction_reporter
  ON correction_report (submitter_ip_hash, submitted_at DESC);
