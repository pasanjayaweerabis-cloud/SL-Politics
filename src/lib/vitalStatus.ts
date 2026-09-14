import type { Person, VitalStatus } from "../types/models.ts";

/**
 * Whether a person is alive, deceased, or simply not known either way.
 *
 * Derived, never asserted: the only fact this reads is `Person.dateOfDeath`,
 * which an import or a published correction sets ONLY when a source states a
 * death occurred. Its absence is not evidence of anything — "former",
 * "historical" and "old" all describe people who may be very much alive, so
 * a missing death record defaults to `unknown` rather than `alive`.
 *
 * `serving` is the one case an absence can safely resolve the other way:
 * Parliament cannot swear in someone who has died, so holding an office with
 * no recorded end IS itself a real (if weak) assertion of being alive — not
 * a guess about death, which this function never makes either direction of.
 */
export function deriveVitalStatus(
  person: Pick<Person, "dateOfDeath">,
  serving: boolean,
): VitalStatus {
  if (person.dateOfDeath) return "deceased";
  return serving ? "alive" : "unknown";
}
