#!/usr/bin/env node
/**
 * Javora — server command line.
 *
 *   node server/cli.ts migrate            apply database migrations
 *   node server/cli.ts seed               load source + authority definitions
 *   node server/cli.ts sync <sourceId>    run one synchronisation
 *   node server/cli.ts status             what the database actually holds
 *
 * Flags: --profiles  --delay=<ms>  --dry-run  --force  --max-pages=<n>
 */

import { openDatabase, migrate } from "./db/database.ts";
import { CanonicalStore } from "./db/store.ts";
import { syncSource } from "./sync/syncSource.ts";
import { createParliamentConnector } from "./fetchers/parliamentConnector.ts";
import { createCabinetConnector } from "./fetchers/cabinetConnector.ts";
import { createCabinetResolver } from "./sync/resolveCabinetIdentity.ts";
import { AUTHORITY_RULES } from "./sync/authority.ts";
import { sources as SOURCE_DEFINITIONS } from "../src/data/sources.ts";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
};

function open() {
  const db = openDatabase();
  migrate(db, { silent: true });
  return { db, store: new CanonicalStore(db) };
}

/**
 * Load the source definitions and the fact-type authority table.
 *
 * Seeds only institutional metadata — which bodies exist and what each is
 * authoritative for. It never seeds people: political records come from a
 * connector reading an official source, never from a fixture.
 */
function seed(store: CanonicalStore) {
  const byFact = new Map<string, Array<{ factType: string; rank: number }>>();
  for (const rule of AUTHORITY_RULES) {
    rule.sourceIds.forEach((sourceId, index) => {
      const list = byFact.get(sourceId) ?? [];
      list.push({ factType: rule.factType, rank: index + 1 });
      byFact.set(sourceId, list);
    });
  }

  for (const source of SOURCE_DEFINITIONS) {
    store.upsertSource({
      id: source.id,
      name: source.name,
      institution: source.institution,
      sourceType: source.sourceType,
      category: source.category,
      url: source.url,
      description: source.description,
      authoritativeFor: byFact.get(source.id) ?? [],
    });
  }
  return SOURCE_DEFINITIONS.length;
}

/**
 * Connector factories.
 *
 * Each takes the CLI options AND the store, because a connector may need to
 * resolve identity against canonical data. The Cabinet Office publishes no
 * person identifiers, so its connector matches ministers onto people who
 * already exist rather than creating a second record for each of them.
 */
const CONNECTORS: Record<
  string,
  (o: Record<string, unknown>, store: CanonicalStore) => ReturnType<typeof createParliamentConnector>
> = {
  S001: (o) => createParliamentConnector(o),
  S006: (_o, store) => createCabinetConnector({ resolvePerson: createCabinetResolver(store) }),
};

async function main() {
  if (!command || command === "help") {
    console.log(`SL Politics server CLI

  migrate              apply database migrations
  seed                 load source definitions and authority rules
  sync <sourceId>      run one synchronisation (e.g. sync S001)
  status               report what the database holds

Flags
  --profiles           also fetch each member's profile page (slower)
  --delay=<ms>         milliseconds between requests (default 500)
  --max-pages=<n>      cap listing pages fetched
  --dry-run            decide and report, write nothing
  --force              apply even when the source is unchanged
`);
    return;
  }

  if (command === "migrate") {
    const db = openDatabase();
    const applied = migrate(db);
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : "Database already up to date.");
    db.close();
    return;
  }

  if (command === "seed") {
    const { db, store } = open();
    const count = seed(store);
    console.log(`Seeded ${count} source definitions and their authority rules.`);
    db.close();
    return;
  }

  if (command === "sync") {
    const sourceId = args[1];
    if (!sourceId) {
      console.error("Usage: sync <sourceId>   e.g. sync S001");
      process.exit(1);
    }
    const factory = CONNECTORS[sourceId];
    if (!factory) {
      console.error(
        `No connector is implemented for ${sourceId}.\n` +
          `Implemented: ${Object.keys(CONNECTORS).join(", ")}.\n` +
          `See the README for why the other sources are not connected.`,
      );
      process.exit(1);
    }

    const { db, store } = open();
    seed(store);

    const connector = factory({
      delayMs: Number(value("delay") ?? 500),
      withProfiles: flag("profiles"),
      maxPages: value("max-pages") ? Number(value("max-pages")) : undefined,
      onProgress: (m: string) => process.stdout.write(`\r  ${m}`.padEnd(50)),
    }, store);

    console.log(`Syncing ${sourceId}…`);
    const result = await syncSource(store, connector, {
      trigger: "manual",
      dryRun: flag("dry-run"),
      force: flag("force"),
    });
    process.stdout.write("\n");

    console.log(`Outcome:        ${result.outcome}`);
    console.log(`Changed:        ${result.changed} (${result.changeReason})`);
    console.log(`Content hash:   ${result.contentHash}`);
    console.log(`Seen/created/updated/unchanged: ${result.counts.seen}/${result.counts.created}/${result.counts.updated}/${result.counts.unchanged}`);
    console.log(`Positions opened/closed:        ${result.positionsOpened}/${result.positionsClosed}`);
    console.log(`Change events:  ${result.changeEventIds.length}`);
    console.log(`Identity reviews: ${result.identityReviews}`);
    if (result.error) console.log(`Error:          ${result.error}`);

    const errors = result.problems.filter((p) => p.severity === "error");
    const warnings = result.problems.filter((p) => p.severity === "warning");
    console.log(`Validation:     ${errors.length} error(s), ${warnings.length} warning(s)`);
    for (const problem of errors.slice(0, 10)) {
      console.log(`  ERROR  ${problem.code} ${problem.subject ?? ""}: ${problem.message}`);
    }

    db.close();
    return;
  }

  if (command === "status") {
    const { db, store } = open();
    const counts = store.counts();
    console.log("\n═══ JAVORA DATABASE ═══\n");
    for (const [key, n] of Object.entries(counts)) {
      console.log(`  ${key.padEnd(24)} ${String(n).padStart(6)}`);
    }
    console.log("\n  Sources:");
    for (const source of store.listSources() as Array<Record<string, unknown>>) {
      console.log(
        `    ${String(source.id).padEnd(6)} ${String(source.sync_state).padEnd(15)} ` +
          `${source.last_successful_sync_at ?? "never synced"}  ${source.name}`,
      );
    }
    const runs = store.listRuns(undefined, 5) as Array<Record<string, unknown>>;
    if (runs.length) {
      console.log("\n  Recent sync runs:");
      for (const run of runs) {
        console.log(`    ${run.started_at}  ${String(run.source_id)}  ${String(run.outcome).padEnd(10)} ${run.error_message ?? ""}`);
      }
    }
    console.log();
    db.close();
    return;
  }

  console.error(`Unknown command: ${command}. Try "help".`);
  process.exit(1);
}

main().catch((error) => {
  console.error("Command failed:", error);
  process.exit(1);
});
