import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allPeople, getPersonBySlug } from "./repository.ts";
import { IDENTITY_OVERRIDES } from "../data/identityOverrides.ts";
import { personMeta } from "../lib/pageMeta.ts";

/**
 * Javora — the slug list is a golden file.
 *
 * A slug is the permanent public URL of a person. `models.ts` states the
 * contract in those words: "URL-stable slug. Never reused, never changed once
 * published." Every published link, every sitemap entry, every prerendered
 * file under dist/person/ and every external citation of this site depends on
 * a given person keeping the same slug forever.
 *
 * WHY THIS FILE EXISTS. `slugify` is currently implemented six times, in
 * parliamentDataset.ts, pastMembersDataset.ts, cabinetDataset.ts,
 * parliamentConnector.ts, cabinetConnector.ts and promote-detail.mjs. All six
 * agree today. The day one of them is edited — to handle an apostrophe, a
 * Tamil name, a hyphen — the same person acquires two different URLs depending
 * on which ingestion path created their record, and every previously published
 * link to the other one dies. Nothing else in the test suite would notice:
 * the site would build, render and pass, just at different addresses.
 *
 * So this pins the actual output rather than the implementation. Consolidating
 * the six copies into one is expected and safe; changing what any of them
 * PRODUCE is not. If this test fails after a refactor that was supposed to be
 * mechanical, the refactor is wrong — do not regenerate the fixture to make it
 * pass.
 *
 * Legitimately regenerating it (a real import that adds or removes people) is
 * a deliberate act with a reviewable diff:
 *
 *     node scripts/generate-golden-slugs.mjs
 *
 * The diff must contain only added or removed lines. A CHANGED slug on an
 * existing id is a broken public URL — with exactly ONE exception, which is
 * not a loophole because it is mechanically enforced below.
 *
 * THE EXCEPTION: a curated identity merge. When `data/identityOverrides.ts`
 * establishes that two source records are one human, the merged record has to
 * publish under one of the two spellings, and the other slug stops being
 * minted. That is a changed line in this fixture. It is permitted only
 * because the displaced slug does NOT die: it is listed in the override's
 * `retiredSlugs`, `getPersonBySlug` still resolves it, and the profile it
 * reaches declares the new slug canonical. "Retired" and "broken" are
 * different things, and the third suite below is what keeps them different —
 * it fails if a retired slug ever stops resolving. Changing a slug WITHOUT
 * retiring the old one properly is still a broken public URL, and this
 * fixture will still catch it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "__golden__", "slugs.tsv");

/**
 * Pinned so the fixture cannot drift because the clock moved. Slug generation
 * must not depend on the current date, and if it ever starts to, this pinning
 * is what turns that into a visible failure instead of a silent one.
 */
const FIXED_DAY = new Date("2026-08-31T00:00:00Z");

const currentRows = () =>
  allPeople(FIXED_DAY)
    .map((v) => `${v.person.id}\t${v.person.slug}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe("public slugs are byte-identical to the golden file", () => {
  const expected = readFileSync(FIXTURE, "utf8").trimEnd().split("\n");
  const actual = currentRows();

  it("covers every person in the dataset", () => {
    expect(actual.length).toBe(expected.length);
  });

  it("is byte-identical, id for id", () => {
    // Compared as whole strings so the failure output names the exact
    // id -> slug pair that moved, rather than an index into an array.
    expect(actual.join("\n")).toBe(expected.join("\n"));
  });

  it("names no person twice", () => {
    const ids = actual.map((row) => row.split("\t")[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("slug invariants that must hold for any implementation", () => {
  const slugs = allPeople(FIXED_DAY).map((v) => v.person.slug);

  it("mints a unique slug for every person", () => {
    // A collision means two people share one public URL and one of them is
    // unreachable. The adapters carry explicit collision handling
    // (`taken.has(base) ? base-parliamentId : base`) precisely for this.
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("emits only lowercase ASCII, digits and single hyphens", () => {
    const offenders = slugs.filter((s) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s));
    expect(offenders).toEqual([]);
  });

  it("never emits an empty slug", () => {
    // An empty slug would collapse to /person/, which is not a profile.
    expect(slugs.filter((s) => s.length === 0)).toEqual([]);
  });
});

/**
 * A retired slug is a URL this site published and must keep answering.
 *
 * This is the price of the exception documented at the top of this file: a
 * curated identity merge may change which slug a record publishes under, but
 * only because the displaced one keeps working. If that ever stops being
 * true, the merge has broken a public URL and these tests say so.
 */
describe("retired slugs stay resolvable forever", () => {
  const retired = IDENTITY_OVERRIDES.flatMap((o) =>
    o.retiredSlugs.map((slug) => ({ slug, override: o })),
  );

  it("has at least one to check, or this suite proves nothing", () => {
    // Guards against the suite silently passing because the override list was
    // emptied — the tests below are all vacuous over an empty array.
    expect(retired.length).toBeGreaterThan(0);
  });

  it("resolves every retired slug to the person who inherited it", () => {
    for (const { slug, override } of retired) {
      const view = getPersonBySlug(slug, FIXED_DAY);
      expect(view, `retired slug /person/${slug} no longer resolves`).not.toBeNull();
      expect(view!.person.id).toBe(override.personId);
    }
  });

  it("points every retired slug at the current one as canonical", () => {
    // What stops a retired slug becoming a second, competing address for the
    // same profile: personMeta builds the canonical URL from the person's
    // CURRENT slug, whichever slug was asked for.
    for (const { slug, override } of retired) {
      expect(personMeta(slug, FIXED_DAY).path).toBe(`/person/${override.slug}`);
    }
  });

  it("never retires a slug that is still in active use", () => {
    // A retired slug that some person still publishes under would mean two
    // records fighting over one URL.
    const live = new Set(allPeople(FIXED_DAY).map((v) => v.person.slug));
    for (const { slug, override } of retired) {
      const holder = allPeople(FIXED_DAY).find((v) => v.person.slug === slug);
      expect(
        live.has(slug) && holder?.person.id !== override.personId,
        `/person/${slug} is retired but another person publishes under it`,
      ).toBe(false);
    }
  });
});
