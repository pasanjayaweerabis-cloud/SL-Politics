/**
 * Javora — Cabinet Office connector (server-side, sync-pipeline shaped).
 *
 * This is the `ConnectorRun` the sync worker drives. The HTML parsing lives in
 * `cabinetOfficeConnector.ts`; this file is the part that fetches, normalises
 * into the canonical shape, and — critically — resolves identity.
 *
 * THE IDENTITY PROBLEM, AND WHY IT IS SOLVED HERE
 *
 * Parliament gives every member a stable numeric id. The Cabinet Office gives
 * nothing: just a printed name, spelled its own way. So the pipeline's usual
 * safe path — match on the source's own id inside its own id-space — cannot
 * work, and taking the naive route would mint a SECOND person record for
 * ministers who already exist as MPs. Four of them differ from Parliament only
 * in spelling:
 *
 *     Cabinet Office            Parliament
 *     "Bimal Rathnayaka"        "Bimal Rathnayake"           one letter
 *     "Sunil Handunneththi"     "Sunil Handunnetti"          transliteration
 *     "Anil Jayantha Fernando"  "Anil Jayantha"              extra surname
 *     "Samantha Viddyarathna"   "K.V. Samantha Viddyarathna" dropped initials
 *
 * So this connector takes a `resolvePerson` callback, supplied by the worker
 * and backed by the canonical store. When it resolves, the connector emits the
 * person under PARLIAMENT'S id-space, and the pipeline's ordinary external-id
 * match then lands on the existing person — no duplicate, no id change, and no
 * new merging rule inside the pipeline.
 *
 * When it does NOT resolve, the person is emitted under the Cabinet Office's
 * own id-space. That is the correct outcome for the President, who is not a
 * Member of Parliament and appears in neither parliamentary directory: he is a
 * real person this source is authoritative about, and refusing to publish him
 * because Parliament has never heard of him would be the wrong kind of caution.
 *
 * WHAT THIS SOURCE IS AUTHORITATIVE FOR
 *
 * Portfolio assignment, and nothing else. It publishes no dates, no
 * biography, no party and no portraits, so every one of those fields is left
 * `undefined` — meaning "this run did not look" — rather than `null`, which
 * would assert the source had checked and found nothing. Getting that
 * distinction wrong once wiped 219 dates of birth in an earlier sync.
 */

import {
  parseCabinetRoster, canonicalCabinetName, officeFromPortfolio,
  type CabinetRole,
} from "./cabinetOfficeConnector.ts";
import type { ConnectorRun, NormalisedPerson, NormalisedPosition } from "../sync/syncSource.ts";
import type { ValidationProblem } from "../../src/sync/connectors/types.ts";
import { RoleType } from "../../src/types/models.ts";
import { precedenceFor } from "../../src/data/roles.ts";
import { slugify } from "../../src/lib/slug.ts";

export const CABINET_CONNECTOR_VERSION = "cabinet-office-connector@1";
export const CABINET_PARSER_VERSION = "cabinet-office-roster@1";
export const CABINET_SOURCE_ID = "S006";

export const CABINET_ROSTER_URL =
  "https://www.cabinetoffice.gov.lk/cab/index.php?id=12&lang=en&option=com_content&view=article";

const USER_AGENT = "SLPoliticsSync/1.0 (civic public-record platform)";

/**
 * How a Cabinet name was matched to an existing canonical person.
 *
 * Returned by the worker's resolver; the connector only needs to know WHICH
 * id-space to emit under, but the method travels with it so an inexact match
 * can be recorded for review rather than accepted silently.
 *
 * `curated` is a human assertion from `src/data/identityOverrides.ts`, not a
 * guess. It is still reported below alongside the fuzzy methods: a judgement
 * is exactly the kind of thing that must leave a trace, and one made by a
 * person is no more self-evident than one made by an edit distance.
 */
export interface PersonResolution {
  externalIdKey: string;
  externalId: string;
  method: "curated" | "exact" | "token-subset" | "near-spelling" | "unresolved";
  matchedName?: string | null;
}

export type PersonResolver = (name: string) => PersonResolution | null;

export interface CabinetConnectorOptions {
  /** Injected by the worker; backed by the canonical store. */
  resolvePerson?: PersonResolver;
  /** Overridden in tests to supply fixture HTML instead of the network. */
  fetchHtml?: (url: string) => Promise<string>;
  now?: () => string;
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * `syncSource.ts` races a timeout against `fetch()`'s returned promise, but
 * that race doesn't abort the underlying request — without its own
 * AbortController, a hung cabinetoffice.gov.lk connection outlives the sync
 * run that gave up on it and keeps consuming a socket. Mirrors
 * parliamentConnector.ts's `get()`.
 */
async function defaultFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** The office a Cabinet line names, as a canonical role type. */
function roleTypeFor(role: CabinetRole, title: string): string {
  if (/^President$/i.test(title)) return RoleType.PRESIDENT;
  if (/^Prime Minister$/i.test(title)) return RoleType.PRIME_MINISTER;
  // Everything under any section that is not the office itself is a ministry.
  // The President holding Defence is a Cabinet Minister for that portfolio,
  // and recording it as anything else would lose the portfolio.
  void role;
  return RoleType.CABINET_MINISTER;
}

/**
 * Build the connector.
 *
 * `fetch()` is the only async, network-touching part; parsing and
 * normalisation are pure functions over the retrieved text, which is what
 * makes the end-to-end change tests possible without a network.
 */
export function createCabinetConnector(options: CabinetConnectorOptions = {}): ConnectorRun {
  const fetchHtml = options.fetchHtml ?? defaultFetch;
  const nowFn = options.now ?? (() => new Date().toISOString());

  return {
    sourceId: CABINET_SOURCE_ID,
    connectorVersion: CABINET_CONNECTOR_VERSION,
    parserVersion: CABINET_PARSER_VERSION,
    url: CABINET_ROSTER_URL,

    async fetch() {
      const retrievedAt = nowFn();
      const html = await fetchHtml(CABINET_ROSTER_URL);
      const roster = parseCabinetRoster(html);
      const problems: ValidationProblem[] = [];

      if (roster.members.length === 0) {
        // Zero members is never a real Cabinet. Reporting it as a validation
        // error rather than applying it is what stops a layout change at the
        // source from emptying the Cabinet in canonical data.
        problems.push({
          severity: "error",
          code: "cabinet-empty",
          message:
            "Parsed zero Cabinet members. The page layout has probably changed; " +
            "refusing to treat this as an empty Cabinet.",
          subject: null,
        });
      }

      const people: NormalisedPerson[] = [];

      for (const member of roster.members) {
        const name = canonicalCabinetName(member.rawName);
        if (!name) continue;

        const resolution = options.resolvePerson?.(name) ?? null;
        const resolved = resolution && resolution.method !== "unresolved" ? resolution : null;

        if (resolution && resolution.method !== "exact" && resolution.method !== "unresolved") {
          // Accepted, but recorded: "these are the same person" is a
          // judgement, and a judgement that leaves no trace cannot be checked.
          problems.push({
            severity: "warning",
            code: "identity-inexact-match",
            message:
              `Cabinet Office name "${name}" matched canonical person ` +
              `"${resolution.matchedName ?? resolution.externalId}" by ${resolution.method}.`,
            subject: name,
          });
        }

        const positions: NormalisedPosition[] = [];
        for (const line of member.portfolios) {
          const { title, ministry } = officeFromPortfolio(line);
          const roleType = roleTypeFor(member.role, title);
          const ministerial = roleType === RoleType.CABINET_MINISTER;
          positions.push({
            title,
            roleType,
            institution: ministerial ? "Cabinet of Ministers" : "Government of Sri Lanka",
            ministry,
            /*
             * UNDEFINED, NOT NULL, and the difference matters.
             *
             * The roster publishes no appointment dates at all. `undefined`
             * says "this source did not carry that field"; `null` would say
             * "this source looked and there is no such date". Only the first
             * is true, and asserting the second is destructive: Parliament's
             * profile pages DO publish appointment dates, and a `null` here
             * overwrote them — 23 ministerial start dates, including the
             * Prime Minister's, were found erased in the live database by
             * exactly this, and could only be recovered by re-running the
             * profile promotion.
             *
             * `currentAsOf` carries the currency instead — a dated
             * observation that the office is held, which syncSource fills
             * from the retrieval date. An invented start date would be
             * fabrication; erasing a real one is worse.
             */
            startDate: undefined,
            endDate: undefined,
            precedence: precedenceFor(roleType as never),
            factType: "portfolio-assignment",
            /*
             * Supersedable: a portfolio's holder can change without the
             * portfolio ending, so a reshuffle supersedes within the slot.
             * This is what makes "Minister of Energy" moving from one person
             * to another close the old office instead of leaving two people
             * holding it.
             */
            supersedable: true,
          });
        }

        if (positions.length === 0) continue;

        people.push({
          externalId: resolved ? resolved.externalId : slugify(name),
          externalIdKey: resolved ? resolved.externalIdKey : "cabinetOffice",
          canonicalName: name,
          slug: slugify(name),
          aliases: member.rawName !== name ? [member.rawName] : [],
          // Left `undefined` throughout: this source publishes none of these,
          // and `null` would claim it had looked and found nothing — which is
          // how a previous sync erased 219 dates of birth.
          dateOfBirth: undefined,
          biography: undefined,
          portraitUrl: undefined,
          profession: undefined,
          partyId: undefined as never,
          districtId: undefined as never,
          sourceUrl: CABINET_ROSTER_URL,
          positions,
        });
      }

      /*
       * The canonical payload drives change detection, so it must contain
       * exactly what a meaningful change would alter — who holds which office
       * — and nothing that varies per request. It is sorted so that the source
       * merely reordering its table is not mistaken for a reshuffle.
       */
      const canonicalPayload = JSON.stringify(
        people
          .map((p) => [p.canonicalName, p.positions.map((x) => x.title).sort()])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en")),
      );

      return {
        retrievedAt,
        canonicalPayload,
        // This page carries no per-request token, so the raw byte hash is
        // stable and worth recording alongside the semantic one.
        rawContentHash: null,
        rawHashIsStable: false,
        people,
        problems,
      };
    },
  };
}
