/**
 * Javora — the canonical slug string-transform.
 *
 * A slug is a person’s permanent public URL: models.ts states the contract
 * explicitly — "URL-stable slug. Never reused, never changed once published."
 * This transform existed as six independent, byte-identical copies across the
 * two ingestion paths (parliamentDataset.ts, pastMembersDataset.ts,
 * cabinetDataset.ts, parliamentConnector.ts, cabinetConnector.ts,
 * promote-detail.mjs). Six copies of the function that mints a permanent
 * public identifier is a latent data-integrity failure: the day one copy is
 * edited — to handle an apostrophe, a hyphen, a name in a script this does not
 * touch — the same person acquires two different URLs depending on which
 * ingestion path created their record, and every previously published link to
 * the other one silently breaks.
 *
 * WHAT THIS FILE DOES NOT OWN. Only the string transform is shared. Each call
 * site keeps its own:
 *   - collision handling (parliamentDataset.ts, pastMembersDataset.ts,
 *     parliamentConnector.ts) — taken.has(base) ? base-externalId : base,
 *     with a member-parliamentId fallback for an empty slug
 *   - id namespacing — cabinetDataset.ts uses this for a PERSON ID
 *     ("cabinet:" + slugify(name)), not a slug; a different namespace with
 *     different rules
 *   - district-id use in promote-detail.mjs
 * None of that moved here. Moving it would risk exactly the kind of behaviour
 * drift this extraction exists to prevent.
 *
 * MANDATORY GATE. src/services/slugs.golden.test.ts pins the full current slug
 * list. Do not change this function’s output without checking that test
 * first — a byte-for-byte diff of all 1,624 slugs, before and after, is the
 * bar for any change here.
 */

export const slugify = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
