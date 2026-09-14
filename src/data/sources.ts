/**
 * Javora — institutional sources and their authority.
 *
 * These are real public bodies at their real published addresses. What is
 * asserted here, and what is not:
 *
 *   ASSERTED  — that the named institution publishes the described record, and
 *               that Javora treats it as primary for the listed fact types.
 *               Both are checkable statements about institutions and policy.
 *
 *   NOT ASSERTED — that every source is read automatically, or that any of
 *               them is real-time.
 *
 * WHAT IS ACTUALLY CONNECTED, as of the Current Government work:
 *
 *   S001  Parliament     a real connector, run by hand. "manual-import".
 *   S006  Cabinet Office a real connector wired into the scheduler and the
 *                        sync worker, but the rows bundled here were produced
 *                        by running scripts/import-cabinet.mjs by hand, so this
 *                        file records "manual-import" — see the note on the
 *                        S006 entry for why the bundled build must not claim a
 *                        schedule it cannot observe.
 *
 * Every other source is "not-connected" with null timestamps. Nothing is ever
 * back-filled to look active: a null here means no check has happened, and
 * the interface says so in those words rather than showing a plausible date.
 *
 * Authority is per-fact-type, deliberately. Parliament is primary for who sits
 * in Parliament but not for election returns; the Election Commission is the
 * reverse. A single global source ranking would silently prefer the wrong body
 * for half the facts on the site.
 */

import { VerificationState, type FactType, type InstitutionalSource } from "../types/models.ts";
import { IMPORT_SNAPSHOT } from "./adapters/datasetDescriptor.ts";
import cabinetData from "./imported/cabinetOffice.json" with { type: "json" };

export const sources: InstitutionalSource[] = [
  {
    id: "S001",
    name: "Parliament of Sri Lanka — Members Directory",
    institution: "Parliament of Sri Lanka",
    sourceType: "legislature",
    category: "Official directory",
    url: "https://www.parliament.lk/en/members-of-parliament/directory-of-members",
    description:
      "The register of sitting members maintained by the Parliament Secretariat, covering electoral district, party affiliation and parliamentary service.",
    authoritativeFor: ["parliamentary-membership"],
    // The one genuinely connected source. `scripts/import-parliament.mjs`
    // retrieved it, and these timestamps are that retrieval — real, not
    // back-filled. It is "manual-import", not "live": no scheduler runs it.
    syncState: "manual-import",
    syncLabel: "Imported manually",
    lastCheckedAt: IMPORT_SNAPSHOT.retrievedAt,
    lastSuccessfulSyncAt: IMPORT_SNAPSHOT.retrievedAt,
    verification: VerificationState.SOURCE_LINKED,
  },
  {
    id: "S002",
    name: "Election Commission — Official Results",
    institution: "Election Commission of Sri Lanka",
    sourceType: "election-authority",
    category: "Electoral record",
    url: "https://elections.gov.lk/",
    description:
      "Declared results for presidential, parliamentary, provincial and local authority elections, including preference counts and district returns.",
    authoritativeFor: ["election-result"],
    syncState: "not-connected",
    syncLabel: "Not connected",
    lastCheckedAt: null,
    lastSuccessfulSyncAt: null,
    verification: VerificationState.UNVERIFIED,
  },
  {
    id: "S003",
    name: "Presidential Secretariat — Cabinet and Office Records",
    institution: "Presidential Secretariat of Sri Lanka",
    sourceType: "executive",
    category: "Executive record",
    url: "https://www.presidentsoffice.gov.lk/",
    description:
      "Announcements of appointment, cabinet composition and assignment of subjects and functions to ministers.",
    authoritativeFor: ["executive-appointment"],
    syncState: "not-connected",
    syncLabel: "Not connected",
    lastCheckedAt: null,
    lastSuccessfulSyncAt: null,
    verification: VerificationState.UNVERIFIED,
  },
  {
    id: "S004",
    name: "University Grants Commission — Institutional Records",
    institution: "University Grants Commission, Sri Lanka",
    sourceType: "academic",
    category: "Academic record",
    url: "https://www.ugc.ac.lk/",
    description:
      "Recognised higher education institutions and awarded qualifications, used to corroborate academic credentials against the awarding body.",
    authoritativeFor: ["qualification"],
    syncState: "not-connected",
    syncLabel: "Not connected",
    lastCheckedAt: null,
    lastSuccessfulSyncAt: null,
    verification: VerificationState.UNVERIFIED,
  },
  {
    id: "S005",
    name: "Department of Government Printing — Gazette",
    institution: "Department of Government Printing, Sri Lanka",
    sourceType: "gazette",
    category: "Gazette",
    url: "https://documents.gov.lk/en/gazette.php",
    description:
      "The Extraordinary and weekly Gazette, of record for appointments, ministerial assignments and instruments given force of law.",
    authoritativeFor: ["gazette-instrument", "portfolio-assignment"],
    syncState: "not-connected",
    syncLabel: "Not connected",
    lastCheckedAt: null,
    lastSuccessfulSyncAt: null,
    verification: VerificationState.UNVERIFIED,
  },
  {
    id: "S006",
    name: "Cabinet Office — Decisions and Portfolios",
    institution: "Cabinet Office of Sri Lanka",
    sourceType: "executive",
    category: "Executive record",
    url: "https://www.cabinetoffice.gov.lk/",
    description:
      "Published cabinet decisions and the record of portfolio allocation among ministers.",
    authoritativeFor: ["portfolio-assignment"],
    /*
      "manual-import", not "scheduled".

      A real connector exists for this source and the worker can poll it. But
      whether anything is actually scheduled is a property of a DEPLOYMENT, not
      of this file: server/scheduler/schedule.ts defaults CABINET_SYNC_INTERVAL
      to 0, and isAutomaticSyncOperational() is false until a deployment sets a
      positive interval. A static build has no way to observe that.

      So this described every profile citing the Cabinet Office as
      "Scheduled" - an automation claim - when the default configuration
      schedules nothing. What this file can honestly state is how the bundled
      rows got here: scripts/import-cabinet.mjs, run by hand, exactly like
      S001. A deployment with VITE_API_URL set replaces this with the real run
      records from the database (see GovernmentPage), which is the only place
      the true schedule state is known.
    */
    syncState: "manual-import",
    syncLabel: "Imported by running the connector manually",
    // The bundled dataset's own retrieval date, not the server database's.
    // The page must report when THIS data was fetched, not when some other
    // copy of it was.
    lastCheckedAt: cabinetData.snapshot.retrievedAt,
    lastSuccessfulSyncAt: cabinetData.snapshot.retrievedAt,
    verification: VerificationState.UNVERIFIED,
  },
  {
    id: "S900",
    name: "Research compilation (non-authoritative)",
    institution: "Compiled research input",
    sourceType: "other-official",
    category: "Non-authoritative research",
    url: "",
    description:
      "Records derived from research documents supplied to the project — compilations ABOUT sources, not sources. " +
      "Facts carried here are attested by whatever the compilation cited, which in most cases is a news outlet or " +
      "biography aggregator, and in some cases nothing checkable at all. Every record keeps the file, line and " +
      "verbatim sentence it came from so it can be checked against the original.",
    // Deliberately authoritative for NOTHING. This entry exists so a
    // research-derived claim can name its provenance honestly, not so it can
    // acquire standing it does not have.
    authoritativeFor: [],
    syncState: "manual-import",
    syncLabel: "Manually imported research input",
    lastCheckedAt: null,
    lastSuccessfulSyncAt: null,
    verification: VerificationState.UNVERIFIED,
  },
];

export const sourceIndex = new Map(sources.map((source) => [source.id, source]));

export const getSource = (id: string | null | undefined): InstitutionalSource | null =>
  id ? sourceIndex.get(id) ?? null : null;

export const sourceInstitution = (id: string): string | null =>
  getSource(id)?.institution ?? null;

/**
 * Sources treated as primary for a given class of fact, in listed order.
 * Used to decide which source a conflict should be resolved in favour of, and
 * to flag a claim cited to a source that is not authoritative for its own type.
 */
export function authoritativeSourcesFor(factType: FactType): InstitutionalSource[] {
  return sources.filter((source) => source.authoritativeFor.includes(factType));
}

/** Whether a source is primary for a fact type. */
export function isAuthoritativeFor(sourceId: string, factType: FactType): boolean {
  return Boolean(getSource(sourceId)?.authoritativeFor.includes(factType));
}

/** How Javora's own ingestion state should be presented. Never invented. */
export const SYNC_PRESENTATION: Record<
  InstitutionalSource["syncState"],
  { label: string; tone: string; icon: string }
> = {
  "not-connected": { label: "Not connected", tone: "muted", icon: "slash" },
  "manual-import": { label: "Imported manually", tone: "info", icon: "archive" },
  scheduled: { label: "Scheduled", tone: "info", icon: "clock" },
  live: { label: "Live", tone: "success", icon: "refresh" },
  failing: { label: "Failing", tone: "warning", icon: "alert" },
};
