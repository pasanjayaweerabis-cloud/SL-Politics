/**
 * Javora — structured vocabularies.
 *
 * Parties and districts are records in their own right, not strings repeated
 * across people.
 *
 * They are DERIVED FROM THE IMPORTED SOURCE DATA rather than hand-curated.
 * That is a deliberate reversal of the earlier approach, and the reason is
 * accuracy: a curated list forces someone to assert mappings the source does
 * not make ("Jathika Jana balawegaya is the NPP", "Mahanuwara is Kandy").
 * Those particular assertions happen to be right, but the mechanism is the
 * problem — it invites quiet, unsourced editorialising in exactly the layer
 * that is supposed to be a faithful record. Deriving instead means the
 * vocabulary is always precisely what Parliament publishes, and a new party
 * appearing in the source appears here without anyone editing a file.
 *
 * The one exception is district → province, which is stable public geography
 * the source does not publish; see `PROVINCE_BY_DISTRICT` in
 * `adapters/parliamentDataset.ts`. Districts it does not cover get a null
 * province rather than a guess.
 *
 * Name fields stay multilingual-ready: `si` and `ta` are null because the
 * source publishes English only, and are never machine-transliterated.
 */

import type { Party } from "../types/models.ts";
import {
  derivedParties,
  derivedDistricts,
  type DerivedDistrict,
} from "./adapters/parliamentDataset.ts";

export type District = DerivedDistrict;

export const parties: Party[] = derivedParties;
export const districts: District[] = derivedDistricts;

/* ==========================================================================
   Service status
   ========================================================================== */

export const statuses = [
  { id: "serving", name: "Currently serving", description: "Holds at least one recorded office." },
  { id: "former", name: "Former", description: "No office currently recorded." },
] as const;

/* ==========================================================================
   Lookups
   ========================================================================== */

export const partyIndex = new Map(parties.map((p) => [p.id, p]));
export const districtIndex = new Map(districts.map((d) => [d.id, d]));

export const getParty = (id: string | null | undefined): Party | null =>
  id ? partyIndex.get(id) ?? null : null;

export const getDistrict = (id: string | null | undefined): District | null =>
  id ? districtIndex.get(id) ?? null : null;

/** "Samagi Jana Balawegaya (SJB)", or null when unaffiliated / not recorded. */
export function partyLabel(id: string | null | undefined): string | null {
  const party = getParty(id);
  return party ? `${party.name} (${party.abbreviation})` : null;
}

/** "Colombo District", or "National List" which takes no suffix. */
export function districtLabel(id: string | null | undefined): string | null {
  const district = getDistrict(id);
  if (!district) return null;
  return district.id === "national-list" ? district.name : `${district.name} District`;
}
