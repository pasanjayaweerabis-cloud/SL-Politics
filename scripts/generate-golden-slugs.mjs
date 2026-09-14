#!/usr/bin/env node
/**
 * Javora — regenerate the golden slug fixture.
 *
 *   node scripts/generate-golden-slugs.mjs
 *
 * Writes src/services/__golden__/slugs.tsv, the fixture
 * src/services/slugs.golden.test.ts compares against.
 *
 * WHEN TO RUN THIS. Only when the set of PEOPLE has legitimately changed — a
 * real import that added or removed records. Then review the diff: it must
 * contain only added and removed lines.
 *
 * WHEN NOT TO RUN IT. Never to make a failing test pass. A CHANGED slug on an
 * existing id means a permanent public URL moved, every published link to it is
 * dead, and the prerendered page at the old address is gone. That is a bug in
 * whatever changed slug generation, not a stale fixture. `models.ts` puts it
 * plainly: "Never reused, never changed once published."
 */

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "services", "__golden__", "slugs.tsv");

// Must match FIXED_DAY in slugs.golden.test.ts. Slug generation does not depend
// on the date, and pinning it here is what keeps that true by construction.
const FIXED_DAY = new Date("2026-08-31T00:00:00Z");

const { allPeople } = await import(
  new URL("../src/services/repository.ts", import.meta.url).href
);

const people = allPeople(FIXED_DAY);
const rows = people
  .map((v) => `${v.person.id}\t${v.person.slug}`)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const slugs = people.map((v) => v.person.slug);
const unique = new Set(slugs).size;
if (unique !== slugs.length) {
  console.error(
    `REFUSING TO WRITE: ${slugs.length - unique} duplicate slug(s). ` +
      `Two people would share one public URL and one would be unreachable.`,
  );
  process.exit(1);
}

writeFileSync(OUT, rows.join("\n") + "\n", { encoding: "utf8" });
console.log(`wrote ${rows.length} rows to ${OUT}`);
console.log("review the diff: added/removed lines only. A CHANGED slug is a bug.");
