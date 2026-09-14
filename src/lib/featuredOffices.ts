/**
 * Javora — which offices the homepage's rail and the search panel's
 * "Offices" group both show.
 *
 * One definition, used by both surfaces, so they can never silently
 * disagree about who's featured — the same reason `currentGovernment()`
 * itself exists. President, Prime Minister, Speaker, Leader of the
 * Opposition, and whichever Cabinet member currently holds the Finance
 * portfolio — an editorial act ("featured politicians") turned into a
 * public, neutral, self-updating rule instead.
 */

import type { CurrentGovernment, GovMember } from "./currentGovernment.ts";

const FINANCE_PATTERN = /finance/i;
const WANTED_LEADERSHIP_ROLES = new Set(["speaker", "opposition-leader"]);

function holdsFinance(member: GovMember | null): boolean {
  return (
    !!member &&
    member.offices.some((office) => office.roleType === "cabinet-minister" && FINANCE_PATTERN.test(office.title))
  );
}

export function featuredOfficeHolders(gov: CurrentGovernment): GovMember[] {
  const base = [
    gov.president,
    gov.primeMinister,
    ...gov.parliamentaryLeadership.filter((member) => WANTED_LEADERSHIP_ROLES.has(member.primaryRoleType)),
  ].filter((member): member is GovMember => member !== null);

  // The President or Prime Minister often holds Finance directly (true of
  // this dataset today) rather than delegating it to a separate Cabinet
  // member — only look for a distinct Finance minister when neither already
  // covers it, so the same person is never listed twice.
  const financeMinister = base.some(holdsFinance)
    ? null
    : (gov.cabinet.find(
        (member) =>
          member.offices.some((office) => office.roleType === "cabinet-minister" && FINANCE_PATTERN.test(office.title)),
      ) ?? null);

  const holders = financeMinister ? [...base, financeMinister] : base;

  const seen = new Set<string>();
  return holders.filter((member) => {
    if (seen.has(member.personId)) return false;
    seen.add(member.personId);
    return true;
  });
}
