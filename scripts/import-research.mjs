#!/usr/bin/env node
/**
 * Javora — research-file importer.
 *
 *   node --experimental-strip-types scripts/import-research.mjs \
 *     "path/to/ChatGPT research.txt" "path/to/Gemini Research.txt"
 *
 * Reads research compilations, stages every claim they contain, reconciles
 * each against canonical data, and prints an import report.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not write canonical records straight from a research file. Claims
 * land in `research_claim` first, keyed to the file, line and verbatim text
 * they came from, and are promoted only where an authoritative source is
 * silent — never where one disagrees. A research compilation is Tier 3/4
 * material by nature, and this script's main job is to establish which of its
 * claims are worth anything once Parliament's own record is on the table.
 *
 * Run with --dry to reconcile and report without writing to the database.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";

import { openMigrated } from "../server/db/database.ts";
import { parseResearchFile } from "../server/research/parseResearchFiles.ts";
import { matchPerson, disposeClaim } from "../server/research/reconcileResearch.ts";
import { parliamentDataset } from "../src/data/adapters/parliamentDataset.ts";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const FILES = args.filter((a) => !a.startsWith("--"));

if (FILES.length === 0) {
  console.error("Usage: import-research.mjs <file> [<file>...] [--dry]");
  process.exit(1);
}

const nowIso = () => new Date().toISOString();
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 32);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/* ------------------------------------------------------------------ main */

async function main() {
  const startedAt = nowIso();
  console.log(`SL Politics research importer — ${startedAt}${DRY ? " (dry run)" : ""}`);

  const people = parliamentDataset.people.map((p) => ({
    id: p.id, canonicalName: p.canonicalName, aliases: p.aliases,
  }));
  const educationByPerson = new Map();
  for (const row of parliamentDataset.education) {
    const list = educationByPerson.get(row.personId) ?? [];
    list.push(row);
    educationByPerson.set(row.personId, list);
  }
  console.log(`Canonical: ${people.length} people, ${parliamentDataset.education.length} education records.\n`);

  const db = DRY ? null : openMigrated();
  if (db) db.run("BEGIN");

  const report = {
    documents: 0,
    claims: 0,
    matched: 0, unmatched: 0, weakMatches: 0,
    byDisposition: {},
    bySubject: new Map(),
    promotedCredentials: [],
    promotedCareer: [],
    unmatchedNames: new Set(),
  };

  // Records promoted into the front-end dataset. Written to its own file, kept
  // apart from the Parliament import: a reader (and a later maintainer) can
  // always tell which facts came from an institution and which from a
  // research compilation.
  const derived = { education: [], employment: [], publicService: [] };

  for (const path of FILES) {
    const text = await readFile(path, "utf8");
    const fileName = basename(path);
    const documentId = `research:${slug(fileName)}`;
    const claims = parseResearchFile(text, fileName);
    report.documents++;

    if (db) {
      db.run(
        `INSERT INTO research_document (id, file_name, content_hash, bytes, ingested_at, document_kind)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content_hash = excluded.content_hash,
           bytes = excluded.bytes, ingested_at = excluded.ingested_at`,
        [documentId, fileName, hash(text), text.length, startedAt, "research-compilation"],
      );
    }

    console.log(`${fileName}: ${claims.length} claims from ${new Set(claims.map((c) => c.subjectName)).size} named people`);

    for (const [index, claim] of claims.entries()) {
      report.claims++;
      const match = matchPerson(claim.subjectName, people);
      if (match.personId) report.matched++;
      else { report.unmatched++; report.unmatchedNames.add(claim.subjectName); }
      if (match.confidence === "weak") report.weakMatches++;

      let disposition = "unmatched";
      let note = `No canonical person matched (${match.method}).`;
      let credentials = [];
      let entity = null;

      if (match.personId && match.confidence === "weak") {
        // A weak match is a review item. Nothing is promoted onto a person
        // Javora is not sure it has identified — attaching a degree to the
        // wrong member is worse than leaving a gap.
        disposition = "unmatched";
        note = `Person match is weak (${match.method}): staged for review, nothing promoted.`;
      } else if (match.personId) {
        const result = disposeClaim(claim, educationByPerson.get(match.personId) ?? []);
        disposition = result.disposition;
        note = result.note;
        credentials = result.credentials;
        entity = result.entity ?? null;
      }

      report.byDisposition[disposition] = (report.byDisposition[disposition] ?? 0) + 1;
      const subjectRow = report.bySubject.get(claim.subjectName) ?? { matched: Boolean(match.personId), dispositions: {} };
      subjectRow.dispositions[disposition] = (subjectRow.dispositions[disposition] ?? 0) + 1;
      report.bySubject.set(claim.subjectName, subjectRow);

      const provenance = {
        tier: claim.tier,
        citedSource: claim.citedSource,
        sourceUrl: claim.sourceUrl,
        selfReportedStatus: claim.selfReportedStatus,
        file: claim.file,
        line: claim.line,
        rawText: claim.rawText,
      };

      for (const credential of credentials) {
        report.promotedCredentials.push({
          subject: claim.subjectName, personId: match.personId,
          award: credential.award, level: credential.level,
          tier: claim.tier, citedSource: claim.citedSource,
          file: claim.file, line: claim.line,
        });
        derived.education.push({
          personId: match.personId,
          educationType: credential.level,
          institution: credential.institution,
          qualification: credential.award,
          field: credential.field,
          sourceText: credential.context,
          provenance,
        });
      }

      if (disposition === "promoted" && entity) {
        const target = claim.field === "employment" ? derived.employment : derived.publicService;
        target.push({
          personId: match.personId,
          organisation: entity.organisation,
          role: entity.role,
          startDate: entity.startDate,
          endDate: entity.endDate,
          description: entity.description,
          provenance,
        });
        report.promotedCareer.push({
          subject: claim.subjectName, field: claim.field,
          organisation: entity.organisation, role: entity.role,
          startDate: entity.startDate, endDate: entity.endDate,
          tier: claim.tier, citedSource: claim.citedSource,
          file: claim.file, line: claim.line,
        });
      }

      if (db) {
        db.run(
          `INSERT INTO research_claim (
             id, document_id, subject_name, person_id, match_method, match_confidence,
             field, value, cited_source, source_url, source_tier, self_reported_status,
             line_number, raw_text, disposition, disposition_note, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             person_id = excluded.person_id, match_method = excluded.match_method,
             match_confidence = excluded.match_confidence,
             disposition = excluded.disposition, disposition_note = excluded.disposition_note`,
          [
            `${documentId}#${index}`, documentId, claim.subjectName,
            match.personId, match.method, match.confidence,
            claim.field, claim.value, claim.citedSource, claim.sourceUrl,
            claim.tier, claim.selfReportedStatus,
            claim.line, claim.rawText, disposition, note, startedAt,
          ],
        );
      }
    }
  }

  if (db) { db.run("COMMIT"); db.close(); }

  if (!DRY) {
    await mkdir("src/data/imported", { recursive: true });
    await writeFile(
      "src/data/imported/researchDerived.json",
      JSON.stringify({
        $comment:
          "Records promoted from research compilations by scripts/import-research.mjs. " +
          "NOT authoritative data. Every row carries the file, line and verbatim text it " +
          "came from, and renders as secondary-corroborated unless its cited source is Tier 1. " +
          "Kept separate from parliamentMembers.json so institutional facts and research " +
          "claims are never confused for one another.",
        generatedAt: startedAt,
        sourceFiles: FILES.map((f) => basename(f)),
        counts: {
          education: derived.education.length,
          employment: derived.employment.length,
          publicService: derived.publicService.length,
        },
        ...derived,
      }, null, 2) + "\n",
      "utf8",
    );
    console.log("\nWrote src/data/imported/researchDerived.json");
  }

  /* ---------------------------------------------------------------- report */

  console.log("\n" + "=".repeat(64));
  console.log("RESEARCH IMPORT REPORT");
  console.log("=".repeat(64));
  console.log(`Documents ingested        : ${report.documents}`);
  console.log(`Claims staged             : ${report.claims}`);
  console.log(`  matched to a person     : ${report.matched}`);
  console.log(`  unmatched               : ${report.unmatched}`);
  console.log(`  weak (needs review)     : ${report.weakMatches}`);
  console.log("\nDisposition:");
  for (const [k, v] of Object.entries(report.byDisposition).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}`);
  }

  if (report.unmatchedNames.size) {
    console.log("\nNames with no canonical match (NOT created as new people):");
    for (const n of report.unmatchedNames) console.log(`  - ${n}`);
  }

  console.log(`\nCredentials promoted (secondary-corroborated): ${report.promotedCredentials.length}`);
  for (const c of report.promotedCredentials) {
    console.log(`  ${c.subject} — ${c.award} [${c.level}] · Tier ${c.tier}`);
    console.log(`      cited: ${c.citedSource ?? "(none)"}`);
    console.log(`      from : ${c.file}:${c.line}`);
  }

  console.log(`\nCareer records promoted: ${report.promotedCareer.length}`);
  for (const c of report.promotedCareer) {
    console.log(`  ${c.subject} — ${c.role ?? "(no role)"} · ${c.organisation}`);
    console.log(`      ${c.startDate ?? "no start"} → ${c.endDate ?? "no end recorded"} · Tier ${c.tier} · ${c.field}`);
    console.log(`      from : ${c.file}:${c.line}`);
  }

  console.log("\nPer-person outcome:");
  for (const [name, row] of [...report.bySubject].sort()) {
    const parts = Object.entries(row.dispositions).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`  ${row.matched ? "✓" : "✗"} ${name.padEnd(32)} ${parts}`);
  }

  if (DRY) console.log("\n(dry run — nothing written to the database)");
}

main().catch((e) => { console.error("Research import failed:", e); process.exit(1); });
