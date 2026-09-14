/**
 * Javora — challenges to a member's mandate.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * These records are about living, named people, and every one of them
 * concerns an allegation that has not been decided. A writ petition is one
 * party asking a court to rule. It is not a ruling, it is not evidence of
 * wrongdoing, and it is not a disqualification.
 *
 * The research documents supplied to this project describe two such cases and
 * are, in places, loose about the distinction — one calls a seat's validity
 * "highly contested" and flags the member's own status as CONFLICTING. That
 * phrasing is not carried through. What is carried through is: a petition
 * exists, this is what it asserts, this is who is hearing it, no decision has
 * been reported.
 *
 * CONSTRAINTS ENCODED HERE
 *
 *   · `outcome` is "pending" and cannot be changed to a decided value without
 *     a dated decision and a source for it (enforced by a CHECK constraint in
 *     migration 003 as well as by this file).
 *   · Verification is SECONDARY_CORROBORATED: the cases are reported by news
 *     outlets and by a research compilation, not by a court record Javora has
 *     read.
 *   · The member's parliamentary position is NOT marked conflicting,
 *     withdrawn or ended. They sit in Parliament; a pending challenge to that
 *     does not change the fact of it, and rendering their seat as disputed
 *     would state as fact the very thing the court has yet to decide.
 *
 * The interface renders these under a heading that says "under review" and
 * never uses the word "disqualified".
 */

import {
  VerificationState,
  type LegalChallenge,
} from "../../types/models.ts";
import { legalChallengeIdFor } from "../../sync/importRun.ts";

interface ChallengeSeed {
  /** Parliament member id, so the record binds to a canonical person. */
  parliamentId: string;
  challengeType: string;
  forum: string;
  petitioner: string | null;
  /** What the petition ASSERTS. Written as an assertion, not as a finding. */
  claimSummary: string;
  filedOn: string | null;
  citedSource: string;
}

/**
 * The two cases the research documents describe.
 *
 * Both are recorded because a reader looking up either member deserves to
 * know a challenge is live — omitting it would be its own kind of
 * incompleteness. Neither is recorded as an outcome.
 */
const SEEDS: ChallengeSeed[] = [
  {
    parliamentId: "3535", // Ramanathan Archchuna, Jaffna
    challengeType: "quo-warranto",
    forum: "Court of Appeal of Sri Lanka",
    petitioner: "Oshala Herath",
    claimSummary:
      "A writ of quo warranto petition asks the court to rule that the member was disqualified " +
      "under Article 91(1)(d) and (e) of the Constitution, on the basis that he remained a public " +
      "officer — interdicted rather than dismissed or resigned — at the time of nomination and " +
      "election. The member has not been found disqualified; the question is what the court decides.",
    filedOn: "2025-01",
    citedSource: "Research compilation citing Daily News (secondary reporting)",
  },
  {
    parliamentId: "3606", // Upali Pannilage
    challengeType: "quo-warranto",
    forum: "Court of Appeal of Sri Lanka",
    petitioner: null,
    claimSummary:
      "A writ petition asks the court to rule on whether the member held an interest in a state " +
      "contract under Article 91(1)(e), on the basis that he was employed by the University of " +
      "Ruhuna when declared elected. No finding has been reported.",
    filedOn: null,
    citedSource: "Research compilation (secondary reporting; no court record retrieved)",
  },
];

export function legalChallengesFor(
  personIdByParliamentId: (parliamentId: string) => string | null,
): LegalChallenge[] {
  const out: LegalChallenge[] = [];
  for (const seed of SEEDS) {
    const personId = personIdByParliamentId(seed.parliamentId);
    // A challenge with no identified person is dropped, not attached to a
    // guess. Attributing a court case to the wrong member is among the worst
    // errors this platform could make.
    if (!personId) continue;

    out.push({
      id: legalChallengeIdFor(personId, `${seed.challengeType}-${seed.forum}`),
      personId,
      challengeType: seed.challengeType,
      forum: seed.forum,
      caseReference: null,
      petitioner: seed.petitioner,
      claimSummary: seed.claimSummary,
      filedOn: seed.filedOn,
      // Never anything else without a dated, sourced decision.
      outcome: "pending",
      decidedOn: null,
      decisionSummary: null,
      claim: {
        verification: VerificationState.SECONDARY_CORROBORATED,
        evidenceIds: [],
        verifiedAt: null,
      },
    });
  }
  return out;
}
