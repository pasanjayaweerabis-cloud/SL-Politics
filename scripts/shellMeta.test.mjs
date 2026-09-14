import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripShellMeta, DUPLICATED_BY_PAGE_META } from "./shellMeta.mjs";

/**
 * The regression test for the bug this whole module exists to prevent:
 * `og:site_name`, `og:type` and `twitter:card` shipped duplicated on all
 * 1,628 prerendered pages because the shell-stripping list was not updated
 * when `renderMetaTags` grew those three tags.
 *
 * This does not merely check the CURRENT five-item list against itself —
 * that would pass even if a sixth shared tag were added to both index.html
 * and renderMetaTags without anyone updating this list, which is exactly how
 * the original bug happened. Instead it derives, independently, every
 * `<meta>`/`<title>` family `renderMetaTags` can produce, and asserts each
 * one that ALSO appears in the raw index.html shell is on the strip list.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const shellTemplate = readFileSync(join(ROOT, "index.html"), "utf8");
const seoSource = readFileSync(join(ROOT, "src", "lib", "seo.ts"), "utf8");

/**
 * Every tag family `renderMetaTags` can emit, read out of its own source —
 * not hand-copied here, for the same reason seo.test.ts derives
 * `applyPageMeta`'s accepted keys from its signature rather than restating
 * them: a hand-maintained duplicate list is exactly what goes stale.
 */
function taggedFamiliesInRenderMetaTags() {
  const body = seoSource.slice(
    seoSource.indexOf("export function renderMetaTags"),
    seoSource.indexOf("\n}", seoSource.indexOf("export function renderMetaTags")),
  );
  const families = new Set();
  for (const match of body.matchAll(/(?:name|property)="([a-zA-Z:_-]+)"/g)) families.add(match[1]);
  if (/<title>/.test(body)) families.add("<title>");
  return families;
}

/** Whether the shell's raw template contains a tag for this family at all. */
function shellHasFamily(family) {
  if (family === "<title>") return /<title>/i.test(shellTemplate);
  return new RegExp(`(?:name|property)="${family}"`, "i").test(shellTemplate);
}

describe("shell/page metadata — no tag can be emitted by both", () => {
  it("every renderMetaTags family that also appears in the raw shell is on the strip list", () => {
    const stripped = DUPLICATED_BY_PAGE_META.map((e) => e.label);
    const missing = [];

    for (const family of taggedFamiliesInRenderMetaTags()) {
      if (shellHasFamily(family) && !stripped.includes(family)) missing.push(family);
    }

    expect(
      missing,
      `renderMetaTags now also emits ${JSON.stringify(missing)}, which the raw shell ALSO carries — ` +
        `add it to DUPLICATED_BY_PAGE_META in scripts/shellMeta.mjs or every prerendered page will carry it twice`,
    ).toEqual([]);
  });

  it("stripping the shell removes every tag family renderMetaTags will inject, leaving zero duplicates", () => {
    const stripped = stripShellMeta(shellTemplate);

    // Simulate exactly what prerender.mjs does: inject a representative
    // per-page head (title, description, and the three previously-duplicated
    // OG/Twitter tags) into the stripped shell, then count each family.
    const injectedHead = [
      "<title>Example Person | SL Politics</title>",
      '<meta name="description" content="Example.">',
      '<meta property="og:site_name" content="SL Politics">',
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary">',
    ].join("\n");
    const assembled = stripped.replace("</head>", `${injectedHead}\n</head>`);

    for (const { label, pattern } of DUPLICATED_BY_PAGE_META) {
      const count = (assembled.match(new RegExp(pattern.source, `${pattern.flags.replace("i", "")}gi`)) ?? []).length;
      expect(count, `"${label}" appears ${count} time(s) after assembly — expected exactly 1`).toBe(1);
    }
  });

  it("the strip list still matches something in the real index.html (it is not stripping nothing)", () => {
    for (const { label, pattern } of DUPLICATED_BY_PAGE_META) {
      expect(pattern.test(shellTemplate), `index.html no longer contains a "${label}" tag for this pattern to strip`).toBe(true);
    }
  });
});
