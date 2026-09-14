/**
 * Javora — resolving a Cabinet Office name onto a canonical person.
 *
 * The Cabinet Office publishes names and no identifiers, so a minister who is
 * already in the database as a Member of Parliament has to be recognised by
 * name alone. Getting this wrong in either direction is costly: too strict and
 * the same human is published twice; too loose and two different people are
 * merged into one.
 *
 * THREE RULES, EACH ACCEPTED ONLY WHEN IT YIELDS EXACTLY ONE CANDIDATE
 *
 *   exact          normalised names identical
 *   token-subset   every token of one name appears in the other
 *   near-spelling  same number of name parts, small total edit distance
 *
 * Ambiguity is never resolved by picking. Two candidates means no match, and
 * the connector then publishes the person under the Cabinet Office's own
 * id-space where they are visible for review — rather than being silently
 * attached to whichever record happened to sort first.
 *
 * The live roster exercises all three: "Anil Jayantha Fernando" is a token
 * superset of Parliament's "Anil Jayantha", "Bimal Rathnayaka" differs from
 * "Bimal Rathnayake" by one letter, and the President matched nobody at all
 * until a human asserted the identity by hand.
 *
 * A CURATED ASSERTION OUTRANKS ALL THREE. `src/data/identityOverrides.ts` is
 * shared with the bundle adapter deliberately: this file and
 * `src/data/adapters/cabinetDataset.ts` are two implementations of ONE policy
 * (see the header of src/lib/nameMatch.ts), so a human decision about who two
 * records refer to must reach both stores or they diverge on identity — the
 * one thing they cannot be allowed to disagree about.
 */

import type { CanonicalStore } from "../db/store.ts";
import type { PersonResolution } from "../fetchers/cabinetConnector.ts";
import { matchKey, editDistance } from "../../src/lib/nameMatch.ts";
import { overrideForCabinetName } from "../../src/data/identityOverrides.ts";

export interface Candidate {
  id: string;
  canonicalName: string;
  parliamentId: string | null;
}

/** `"parliament:112"` -> `["parliament", "112"]`. */
function splitPersonId(personId: string): [string, string] {
  const at = personId.indexOf(":");
  return at === -1 ? ["", personId] : [personId.slice(0, at), personId.slice(at + 1)];
}

/** Pure matcher, separated from the database so it can be tested directly. */
export function matchAgainst(name: string, candidates: readonly Candidate[]): PersonResolution {
  const key = matchKey(name);
  const unresolved: PersonResolution = {
    externalIdKey: "cabinetOffice",
    externalId: "",
    method: "unresolved",
    matchedName: null,
  };
  if (!key) return unresolved;

  const emit = (c: Candidate, method: PersonResolution["method"]): PersonResolution => ({
    // Emitted under Parliament's id-space when the person has a Parliament id,
    // so the pipeline's ordinary external-id match lands on the existing
    // record and no duplicate is created.
    externalIdKey: c.parliamentId ? "parliament" : "cabinetOffice",
    externalId: c.parliamentId ?? c.id.replace(/^[^:]*:/, ""),
    method,
    matchedName: c.canonicalName,
  });

  // A human already resolved this one. Matched on the asserted target's
  // Parliament id rather than on its name, so the assertion cannot be
  // silently undone by either store re-spelling the person.
  const curated = overrideForCabinetName(name);
  if (curated) {
    const [namespace, externalId] = splitPersonId(curated.personId);
    const target = namespace === "parliament"
      ? candidates.find((c) => c.parliamentId === externalId)
      : candidates.find((c) => c.id === curated.personId);
    if (target) return emit(target, "curated");
  }

  const exact = candidates.filter((c) => matchKey(c.canonicalName) === key);
  if (exact.length === 1) return emit(exact[0]!, "exact");
  if (exact.length > 1) return unresolved;

  const tokens = key.split(" ").filter(Boolean);

  const subset = candidates.filter((c) => {
    const other = matchKey(c.canonicalName).split(" ").filter(Boolean);
    if (!other.length || !tokens.length) return false;
    return tokens.every((t) => other.includes(t)) || other.every((t) => tokens.includes(t));
  });
  if (new Set(subset.map((c) => c.id)).size === 1) return emit(subset[0]!, "token-subset");
  if (subset.length > 1) return unresolved;

  const near = candidates.filter((c) => {
    const otherKey = matchKey(c.canonicalName);
    const other = otherKey.split(" ").filter(Boolean);
    if (other.length !== tokens.length) return false;
    return editDistance(otherKey, key) <= 2;
  });
  if (new Set(near.map((c) => c.id)).size === 1) return emit(near[0]!, "near-spelling");

  return unresolved;
}

/**
 * Build the resolver the worker injects into the Cabinet connector.
 *
 * Candidates are loaded once per run rather than queried per name: the roster
 * is ~22 people and the person table is thousands, so one scan beats
 * twenty-two.
 */
export function createCabinetResolver(store: CanonicalStore): (name: string) => PersonResolution {
  const rows = store.database.all<{ id: string; canonical_name: string; external_id: string | null }>(
    `SELECT p.id, p.canonical_name,
            (SELECT external_id FROM person_external_id
              WHERE person_id = p.id AND source_key = 'parliament' LIMIT 1) AS external_id
       FROM person p`,
  );
  const candidates: Candidate[] = rows.map((r) => ({
    id: r.id,
    canonicalName: r.canonical_name,
    parliamentId: r.external_id,
  }));

  return (name: string) => matchAgainst(name, candidates);
}
