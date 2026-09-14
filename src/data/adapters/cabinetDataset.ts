/**
 * Javora — the current Cabinet, resolved onto canonical people.
 *
 * WHAT THIS ADDS THAT PARLIAMENT CANNOT
 *
 *   · Portfolios as SEPARATE offices. Parliament publishes one portfolio
 *     string per member; a minister holding two ministries becomes two
 *     Position records here rather than one comma-joined title.
 *
 *   · The President. He is not a Member of Parliament and appears in neither
 *     the current directory nor the past-members directory — both were
 *     checked. Without this source the sitting head of state is absent from
 *     the platform entirely.
 *
 * IDENTITY, AND WHY SOME PEOPLE GET A NON-PARLIAMENT ID
 *
 * Everyone here is matched against Parliament's people first, on normalised
 * names, and a match reuses that person's `parliament:<id>` — no duplicate is
 * created and no id changes. Someone who matches nobody gets a
 * `cabinet:<slug>` id, because "not found in Parliament's directories" is the
 * only claim this file establishes; "not the same human as someone in them"
 * is a separate, uncertain claim it does not decide either way.
 *
 * REVIEW RECORDS ARE NOT BUILT HERE (M-2, docs/security-audit-followup-
 * 2026-09-04.md). This module runs client-side — everything it computes ships
 * in the browser bundle — and an identity-review record's `reason` text names
 * the specific matching heuristic and confidence signal that accepted or
 * rejected a candidate. SECURITY--SL Politics.md §9 treats that as controlled
 * editorial data, not something to publish as a side effect of resolving a
 * name. Nothing in `src/` ever rendered it (verified by grep before removing
 * it), so there is no UI regression here — only the removal of reasoning text
 * that a build previously shipped to every visitor with no consumer at all.
 * The database-backed identity-review queue (`identity_review` table,
 * `CanonicalStore.insertIdentityReview`) is the real mechanism for this and
 * is unaffected: it is server-side only and was never part of this file.
 */

import cabinetData from "../imported/cabinetOffice.json" with { type: "json" };
import {
  RoleType, VerificationState,
  type Person, type Position, type SourceEvidence, type RoleTypeValue,
} from "../../types/models.ts";
import { parliamentDataset } from "./parliamentDataset.ts";
import { pastMembersDataset } from "./pastMembersDataset.ts";
import { precedenceFor } from "../roles.ts";
import { positionIdFor, evidenceIdFor } from "../../sync/importRun.ts";
import { slugify } from "../../lib/slug.ts";
import { matchKey, editDistance } from "../../lib/nameMatch.ts";
import { overrideForCabinetName } from "../identityOverrides.ts";

const CABINET_SOURCE_ID = "S006";

interface RawOffice { title: string; ministry: string | null; verbatim: string }
interface RawCabinetMember {
  rawName: string;
  name: string;
  role: "president" | "prime-minister" | "cabinet-minister";
  offices: RawOffice[];
}

const RAW = (cabinetData.members ?? []) as unknown as RawCabinetMember[];
const SNAPSHOT = cabinetData.snapshot as { retrievedAt: string; url: string };
const RETRIEVED_AT: string = SNAPSHOT?.retrievedAt ?? new Date(0).toISOString();
const RETRIEVED_ON: string = RETRIEVED_AT.slice(0, 10);
const SOURCE_URL: string = SNAPSHOT?.url ?? "";

export interface CabinetDataset {
  /** People the Cabinet Office names who exist in no Parliament directory. */
  people: Person[];
  positions: Position[];
  evidence: SourceEvidence[];
  /** The source's own roster label, verbatim, and any note about it. */
  headingVerbatim: string | null;
  headingNote: string | null;
}

export type MatchMethod = "curated" | "exact" | "token-subset" | "near-spelling" | "none";

/**
 * Resolve a Cabinet Office name onto a Parliament person.
 *
 * The two institutions spell the same people differently, and treating every
 * difference as a different human would publish four ministers twice:
 *
 *   "Bimal Rathnayaka"        vs "Bimal Rathnayake"          one letter
 *   "Sunil Handunneththi"     vs "Sunil Handunnetti"         transliteration
 *   "Anil Jayantha Fernando"  vs "Anil Jayantha"             extra surname
 *   "Samantha Viddyarathna"   vs "K.V. Samantha Viddyarathna" dropped initials
 *
 * So three rules, each only accepted when it yields exactly ONE candidate:
 * exact key, token-subset in either direction, and a near-spelling within a
 * small edit distance. Ambiguity is never resolved by picking — it returns no
 * match, and the caller publishes the member under a fresh `cabinet:<slug>`
 * id rather than guessing which existing person they are.
 *
 * A curated assertion from `data/identityOverrides.ts` outranks all three. It
 * is not a fourth guess: it is a human who read the two records and resolved
 * the review the other rules opened. Where the names alone cannot decide —
 * and for the President they demonstrably cannot, see that file — this is the
 * only mechanism that may merge them.
 */
export function resolveIdentity(
  name: string,
  known: Map<string, { id: string; name: string }>,
): { match: { id: string; name: string } | null; method: MatchMethod } {
  const curated = overrideForCabinetName(name);
  if (curated) {
    // Trust the assertion's target id, but take the display name from the
    // Parliament record it points at, so a stale override cannot invent a
    // person who is not in the directory.
    const target = [...known.values()].find((v) => v.id === curated.personId);
    if (target) return { match: target, method: "curated" };
  }

  const key = matchKey(name);
  if (!key) return { match: null, method: "none" };

  const exact = known.get(key);
  if (exact) return { match: exact, method: "exact" };

  const tokens = key.split(" ").filter(Boolean);
  const entries = [...known.entries()];

  // Token subset, either direction. "Anil Jayantha" ⊂ "Anil Jayantha Fernando".
  const subset = entries.filter(([k]) => {
    const other = k.split(" ").filter(Boolean);
    if (!other.length) return false;
    return tokens.every((t) => other.includes(t)) || other.every((t) => tokens.includes(t));
  });
  const subsetIds = new Set(subset.map(([, v]) => v.id));
  if (subsetIds.size === 1) return { match: subset[0]![1], method: "token-subset" };

  // Near-spelling: same number of name parts, small total edit distance.
  const near = entries.filter(([k]) => {
    const other = k.split(" ").filter(Boolean);
    if (other.length !== tokens.length) return false;
    return editDistance(k, key) <= 2;
  });
  const nearIds = new Set(near.map(([, v]) => v.id));
  if (nearIds.size === 1) return { match: near[0]![1], method: "near-spelling" };

  return { match: null, method: "none" };
}

function roleTypeFor(member: RawCabinetMember, office: RawOffice): RoleTypeValue {
  if (/^President$/i.test(office.title)) return RoleType.PRESIDENT;
  if (/^Prime Minister$/i.test(office.title)) return RoleType.PRIME_MINISTER;
  if (member.role === "president" || member.role === "prime-minister" || member.role === "cabinet-minister") {
    return RoleType.CABINET_MINISTER;
  }
  return RoleType.CABINET_MINISTER;
}

function project(): CabinetDataset {
  const people: Person[] = [];
  const positions: Position[] = [];
  const evidence: SourceEvidence[] = [];

  // Everyone Parliament knows about, current and historical.
  const known = new Map<string, { id: string; name: string }>();
  for (const p of [...parliamentDataset.people, ...pastMembersDataset.people]) {
    const key = matchKey(p.canonicalName);
    if (!known.has(key)) known.set(key, { id: p.id, name: p.canonicalName });
    for (const alias of p.aliases) {
      const aliasKey = matchKey(alias);
      if (aliasKey && !known.has(aliasKey)) known.set(aliasKey, { id: p.id, name: p.canonicalName });
    }
  }

  const evidenceFor = (entityType: SourceEvidence["entityType"], entityId: string, field: string | null): string[] => {
    const id = evidenceIdFor({ sourceId: CABINET_SOURCE_ID, entityType, entityId, fieldName: field, sourceUrl: SOURCE_URL });
    if (!evidence.some((e) => e.id === id)) {
      evidence.push({
        id, sourceId: CABINET_SOURCE_ID, entityType, entityId, fieldName: field,
        sourceUrl: SOURCE_URL, documentTitle: "Cabinet of Ministers",
        publishedAt: null, retrievedAt: RETRIEVED_AT, locator: "Cabinet of Ministers",
        sourceRecordId: null, contentHash: null,
        notes: (cabinetData as { headingVerbatim?: string }).headingVerbatim ?? null,
      });
    }
    return [id];
  };

  for (const member of RAW) {
    const resolved = resolveIdentity(member.name, known);

    let personId: string;
    if (resolved.match) {
      personId = resolved.match.id;
      // Register the Cabinet Office's own confirmation of this identity as
      // person-level evidence even though no new Person object is created
      // here — Parliament's record already publishes one and wins the
      // merge in services/repository.ts. Without this call the Cabinet
      // Office's page confirming who holds this office was cited only at
      // the POSITION level below; the person-level claim (services/
      // repository.ts folds any "person" evidence it finds here onto the
      // surviving Person object) would otherwise never see it, understating
      // how many sources actually corroborate this person's identity.
      evidenceFor("person", personId, "canonicalName");
    } else {
      personId = `cabinet:${slugify(member.name)}`;
      people.push({
        id: personId,
        slug: slugify(member.name),
        canonicalName: member.name,
        names: { en: member.name, si: null, ta: null },
        aliases: member.rawName !== member.name ? [member.rawName] : [],
        // The Cabinet Office publishes offices, not biography.
        dateOfBirth: null, dateOfDeath: null, gender: null,
        portrait: null, biography: null, profession: null,
        externalIds: { cabinetOffice: slugify(member.name) },
        claim: {
          verification: VerificationState.SOURCE_LINKED,
          evidenceIds: evidenceFor("person", personId, "canonicalName"),
          verifiedAt: null,
        },
        createdAt: RETRIEVED_AT, updatedAt: RETRIEVED_AT,
      });
    }

    for (const office of member.offices) {
      const roleType = roleTypeFor(member, office);
      const id = positionIdFor(personId, office.title);
      if (positions.some((p) => p.id === id)) continue;
      positions.push({
        id, personId,
        title: office.title,
        roleType,
        institution: roleType === RoleType.PRESIDENT ? "Government of Sri Lanka" : "Cabinet of Ministers",
        ministry: office.ministry,
        districtId: null, constituency: null,
        // The Cabinet Office roster names who holds what NOW; it publishes no
        // appointment dates on this page, so the dated-observation fallback
        // carries the currency rather than an invented start date.
        startDate: null, endDate: null, currentAsOf: RETRIEVED_ON,
        endStatus: "ongoing",
        appointmentType: "appointed",
        precedence: precedenceFor(roleType),
        claim: {
          verification: VerificationState.SOURCE_LINKED,
          evidenceIds: evidenceFor("position", id, "title"),
          verifiedAt: null,
        },
        createdAt: RETRIEVED_AT, updatedAt: RETRIEVED_AT,
      });
    }
  }

  return {
    people, positions, evidence,
    headingVerbatim: (cabinetData as { headingVerbatim?: string | null }).headingVerbatim ?? null,
    headingNote: (cabinetData as { headingNote?: string | null }).headingNote ?? null,
  };
}

export const cabinetDataset: CabinetDataset = project();
