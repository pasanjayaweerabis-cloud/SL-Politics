#!/usr/bin/env node
/**
 * Javora — Cabinet Office of Sri Lanka importer.
 *
 *   node --experimental-strip-types scripts/import-cabinet.mjs
 *
 * Retrieves the current Cabinet of Ministers and writes
 * `src/data/imported/cabinetOffice.json`.
 *
 * Two things this source has that Parliament's directory does not:
 *
 *   1. Each minister's portfolios as SEPARATE entries. Parliament publishes
 *      one "Portfolio" string per member; the Cabinet Office publishes the
 *      ministries, so a minister holding two of them is two records instead of
 *      one comma-joined line.
 *
 *   2. The President, who heads the Cabinet, is not a Member of Parliament,
 *      and therefore appears in NEITHER parliamentary directory — not the
 *      current one, and not the past-members one (checked). Without this
 *      source the sitting head of state is absent from the platform entirely.
 *
 * Identity resolution happens downstream, in the adapter, which can see every
 * other source. This script records names exactly as the Cabinet Office writes
 * them and resolves nobody.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseCabinetRoster, canonicalCabinetName, officeFromPortfolio,
} from "../server/fetchers/cabinetOfficeConnector.ts";
import { contentHash } from "../src/sync/snapshot.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_FILE = resolve(ROOT, "src/data/imported/cabinetOffice.json");

const ROSTER_URL =
  "https://www.cabinetoffice.gov.lk/cab/index.php?id=12&lang=en&option=com_content&view=article";
const PARSER_VERSION = "cabinet-office-roster@1";
const SOURCE_ID = "S006";

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`SL Politics Cabinet Office importer — ${startedAt}`);

  const res = await fetch(ROSTER_URL, {
    headers: { "user-agent": "SLPoliticsImporter/1.0 (civic records; contact via repository)" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${ROSTER_URL}`);
  const html = await res.text();

  const roster = parseCabinetRoster(html);
  const members = roster.members.map((m) => ({
    rawName: m.rawName,
    name: canonicalCabinetName(m.rawName),
    role: m.role,
    offices: m.portfolios.map((line) => {
      const { title, ministry } = officeFromPortfolio(line);
      return { title, ministry, verbatim: line };
    }),
  }));

  const canonical = JSON.stringify(
    members.map((m) => [m.name, m.role, m.offices.map((o) => o.title)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en")),
  );

  const payload = {
    $comment:
      "Retrieved from the official Cabinet Office of Sri Lanka by scripts/import-cabinet.mjs. " +
      "Not hand-edited. Names are recorded exactly as the Cabinet Office writes them; identity " +
      "resolution against Parliament's records happens in the adapter, which can see every source. " +
      "`headingVerbatim` is the source's own label for this roster, reproduced without correction.",
    snapshot: {
      sourceId: SOURCE_ID,
      url: ROSTER_URL,
      retrievedAt: startedAt,
      contentHash: contentHash(canonical),
      rawContentHash: contentHash(html),
      rawHashIsStable: true,
      parserVersion: PARSER_VERSION,
      bytes: html.length,
    },
    /*
     * The source labels this "Cabinet of the 9th Parliament" while listing the
     * ministers appointed after the 2024 election, which seated the 10th.
     * That is the Cabinet Office's own error. It is recorded verbatim and
     * flagged rather than silently corrected: Javora does not edit what a
     * source says, and a reader comparing the two should be able to see the
     * discrepancy rather than find it quietly resolved.
     */
    headingVerbatim: roster.heading,
    headingNote:
      roster.heading && /9th Parliament/i.test(roster.heading)
        ? "Source labels this the 9th Parliament's Cabinet; these ministers were appointed after the " +
          "November 2024 election, which seated the 10th. Reproduced as published, not corrected."
        : null,
    counts: {
      members: members.length,
      offices: members.reduce((a, m) => a + m.offices.length, 0),
      president: members.filter((m) => m.role === "president").length,
      primeMinister: members.filter((m) => m.role === "prime-minister").length,
      cabinetMinisters: members.filter((m) => m.role === "cabinet-minister").length,
      multiPortfolio: members.filter((m) => m.offices.length > 1).length,
    },
    members,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`Wrote ${OUT_FILE}`);
  console.log(JSON.stringify(payload.counts, null, 2));
  if (payload.headingNote) console.warn(`\nNOTE: ${payload.headingNote}`);
  if (!members.length) {
    console.error("\nERROR: parsed zero Cabinet members — the page layout has probably changed.");
    process.exitCode = 1;
  }
}

const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  main().catch((e) => { console.error("Cabinet import failed:", e); process.exit(1); });
}
