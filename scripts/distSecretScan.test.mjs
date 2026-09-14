import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Javora — production artefact verification (SECURITY--SL Politics.md §27).
 *
 * The build is a security boundary: everything under dist/ is what ships to
 * every reader's browser and, for a static host, to search engines and
 * scrapers too. This turns the audit's one-off manual grep (secrets, source
 * maps, database files) into a regression that runs with the rest of the
 * suite, so a future change that starts leaking one of these does not depend
 * on someone remembering to check by hand again.
 *
 * SKIPPING. dist/ is gitignored and absent until `npm run build` has run,
 * matching scripts/prerenderOutput.test.mjs's own skip rule.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");
const HAVE_DIST = existsSync(join(DIST, "index.html"));

/*
 * M-3 (docs/security-audit-followup-2026-09-04.md). This suite exists
 * specifically to turn SECURITY--SL Politics.md §27's manual grep into a
 * standing regression — skipping it silently in CI (which never ran
 * `npm run build` before `npm test`) defeated that purpose on every push and
 * pull request. See scripts/prerenderOutput.test.mjs's matching check.
 */
if (process.env.CI && !HAVE_DIST) {
  throw new Error(
    "dist/ is missing in CI. `npm run build` (with VITE_SITE_ORIGIN set) must run before `npm test` " +
      "so this suite actually scans a real build instead of skipping silently.",
  );
}

/** Every file under dist/, as absolute paths. */
function allFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

// Never legitimately part of a static build output — a database file, a
// backup, an env file, or a source map copied or generated in by mistake.
// Mirrors deploy/nginx.conf's own deny-list plus source maps, which nginx
// does not need to block (nothing requests them) but a build should not emit.
const FORBIDDEN_EXTENSIONS = [
  ".db", ".sqlite", ".sqlite3", ".bak", ".backup", ".sql", ".dump", ".log", ".env", ".map",
];

// Env-var names and secret-shaped patterns that must never appear in shipped
// JavaScript. Deliberately narrow (exact names, not a bare "secret" or
// "password" substring) — this dataset's own scraped biographical text
// contains "Secretary" and similar words, which a loose pattern would flag as
// a false positive on every build.
const SECRET_PATTERNS = [
  /DATABASE_URL\s*[:=]/,
  /POSTGRES_PASSWORD/,
  /JAVORA_DB\s*=/,
  /process\.env\.[A-Z_]*(PASSWORD|SECRET|TOKEN|API_KEY)/,
];

describe.skipIf(!HAVE_DIST)("dist/ production artefact — no secrets or private backend assets", () => {
  const files = allFiles(DIST);

  it("contains no forbidden file types (db, backup, sql, env, source maps, ...)", () => {
    const hits = files.filter((f) => FORBIDDEN_EXTENSIONS.includes(extname(f).toLowerCase()));
    expect(hits, `found forbidden file(s): ${hits.join(", ")}`).toEqual([]);
  });

  it("contains no dotfiles or dot-directories (.env*, .git, .data, ...)", () => {
    const hits = files.filter((f) => f.slice(DIST.length + 1).split(/[\\/]/).some((seg) => seg.startsWith(".")));
    expect(hits, `found dotfile(s): ${hits.join(", ")}`).toEqual([]);
  });

  it("no shipped JavaScript contains a credential env-var name or secret-shaped pattern", () => {
    const jsFiles = files.filter((f) => extname(f) === ".js");
    expect(jsFiles.length, "expected at least one built JS bundle").toBeGreaterThan(0);

    const offenders = [];
    for (const file of jsFiles) {
      const text = readFileSync(file, "utf8");
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(text)) offenders.push(`${file.slice(DIST.length + 1)} matches ${pattern}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /*
   * M-2 (docs/security-audit-followup-2026-09-04.md). src/data/adapters/
   * cabinetDataset.ts used to build an `identityReviews` array whose `reason`
   * text named the specific name-matching heuristic (exact/token-subset/
   * near-spelling/curated) and confidence signal behind an identity
   * resolution — controlled editorial data under SECURITY--SL Politics.md §9,
   * not something to ship to every visitor as a side effect of resolving a
   * Cabinet Office name onto a Parliament record. Reproduced against a real
   * build before the fix: these exact strings were present in dist/assets/
   * index-*.js. Nothing in src/ ever rendered them.
   */
  it("no identity-review payload (candidate names, match reasoning) is present in shipped JS", () => {
    const jsFiles = files.filter((f) => extname(f) === ".js");
    const IDENTITY_REVIEW_PATTERNS = [
      /identityReviews/,
      /curated assertion, not by name matching/,
      /Named by the Cabinet Office but present in neither/,
    ];
    const offenders = [];
    for (const file of jsFiles) {
      const text = readFileSync(file, "utf8");
      for (const pattern of IDENTITY_REVIEW_PATTERNS) {
        if (pattern.test(text)) offenders.push(`${file.slice(DIST.length + 1)} matches ${pattern}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe.skipIf(HAVE_DIST)("dist/ production artefact", () => {
  it("skipped: dist/ has not been built", () => {
    expect(true).toBe(true);
  });
});
