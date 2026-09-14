/**
 * Javora — page metadata contract.
 *
 * These tests are static: they read the source of the pages rather than
 * rendering them. That is deliberate. The bug being guarded against was
 * `applyPageMeta({ canonical: '/government' })` on the Government page — an
 * option that does not exist, silently dropped, leaving the page with no
 * canonical URL. Nothing throws, nothing looks wrong in the browser, and the
 * only visible symptom is in view-source.
 *
 * Every caller is a `.jsx` file, so TypeScript checks none of these object
 * literals. Without a check here, the next typo ships the same way.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPageMeta, renderMetaTags } from "./seo.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every source file under src/, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The keys `applyPageMeta` actually accepts, read out of its own destructuring
 * pattern rather than hard-coded here.
 *
 * Duplicating the list would let the two drift: someone adds a field to
 * PageMeta, this test keeps rejecting it, and the natural fix is to weaken the
 * test. Deriving it means adding a field just works.
 */
function acceptedKeys(): Set<string> {
  const seo = readFileSync(join(SRC, "lib/seo.ts"), "utf8");
  const signature = seo.match(/export function applyPageMeta\(\{([^}]*)\}/);
  if (!signature) throw new Error("could not locate the applyPageMeta signature");

  const keys = signature[1]!
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("..."))
    // "description = DEFAULT_DESCRIPTION" -> "description"
    .map((part) => part.split("=")[0]!.trim());

  return new Set(keys);
}

/**
 * Object-literal keys passed to `applyPageMeta` in one file.
 *
 * Brace-depth tracking rather than a regex, because a nested object —
 * `structuredData: { '@type': 'Person' }` — would otherwise contribute its own
 * keys and produce noise. Only depth-1 keys belong to the call itself.
 */
function metaKeysIn(source: string): { keys: string[]; line: number }[] {
  const calls: { keys: string[]; line: number }[] = [];
  const CALL = /applyPageMeta\(\s*\{/g;

  for (const match of source.matchAll(CALL)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    let end = open;

    for (let i = open; i < source.length; i++) {
      const char = source[i]!;
      // Skip over string and template literals so a brace inside one — or a
      // colon inside a URL — cannot be mistaken for structure.
      if (char === '"' || char === "'" || char === "`") {
        const quote = char;
        i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (char === "{" || char === "[" || char === "(") depth++;
      else if (char === "}" || char === "]" || char === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    const body = source.slice(open + 1, end);
    const keys: string[] = [];
    let depthInBody = 0;

    for (let i = 0; i < body.length; i++) {
      const char = body[i]!;
      if (char === '"' || char === "'" || char === "`") {
        const quote = char;
        i++;
        while (i < body.length && body[i] !== quote) {
          if (body[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (char === "{" || char === "[" || char === "(") depthInBody++;
      else if (char === "}" || char === "]" || char === ")") depthInBody--;
      else if (depthInBody === 0) {
        const rest = body.slice(i);
        const key = rest.match(/^([A-Za-z_$][\w$]*)\s*:/);
        if (key) { keys.push(key[1]!); i += key[1]!.length; }
      }
    }

    calls.push({ keys, line: source.slice(0, match.index).split("\n").length });
  }

  return calls;
}

describe("applyPageMeta call sites", () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith("seo.test.ts"));
  const callers = files
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("applyPageMeta("))
    .filter(({ file }) => !file.endsWith(join("lib", "seo.ts")));

  it("finds the pages that set metadata", () => {
    // A guard that silently matches nothing passes forever. Assert it has work.
    expect(callers.length).toBeGreaterThanOrEqual(5);
  });

  it("passes only options applyPageMeta accepts", () => {
    const accepted = acceptedKeys();
    const rejected: string[] = [];

    for (const { file, source } of callers) {
      for (const call of metaKeysIn(source)) {
        for (const key of call.keys) {
          if (!accepted.has(key)) {
            rejected.push(`${file.replace(SRC, "src")}:${call.line} — "${key}"`);
          }
        }
      }
    }

    expect(rejected, `unknown applyPageMeta option(s):\n${rejected.join("\n")}`).toEqual([]);
  });

  it("gives every indexable page a canonical path", () => {
    const missing: string[] = [];

    for (const { file, source } of callers) {
      for (const call of metaKeysIn(source)) {
        // A noindex page needs no canonical URL — nothing will index it.
        if (call.keys.includes("noindex")) continue;
        if (!call.keys.includes("path")) {
          missing.push(`${file.replace(SRC, "src")}:${call.line}`);
        }
      }
    }

    expect(missing, `page(s) with no canonical path:\n${missing.join("\n")}`).toEqual([]);
  });
});

/**
 * og:image / twitter:image — `renderMetaTags` (the prerender path) and
 * `applyPageMeta` (the client path) both build their tags from ONE
 * `buildPageMeta` call, so a test of `buildPageMeta`'s resolved `image` plus
 * `renderMetaTags`'s string output covers both by construction: there is no
 * second, independently-computed image URL for the client path to drift
 * against. See the file header's "ONE definition, TWO renderers".
 */
describe("share-card image (og:image / twitter:image)", () => {
  const ORIGIN = "https://javora.lk";

  it("falls back to the sitewide default card when a route declares no image", () => {
    const resolved = buildPageMeta({ title: "Current Government", path: "/government" }, ORIGIN);
    expect(resolved.image).toEqual({
      url: `${ORIGIN}/og/default.png`,
      alt: "SL Politics — public records, clearly presented and traceable to their source.",
      width: 1200,
      height: 630,
    });
  });

  it("uses a route's own image when it declares one", () => {
    const resolved = buildPageMeta(
      {
        title: "Harsha de Silva",
        path: "/person/harsha-de-silva",
        image: { path: "/og/harsha-de-silva.png", alt: "SL Politics — Harsha de Silva, public record" },
      },
      ORIGIN,
    );
    expect(resolved.image).toEqual({
      url: `${ORIGIN}/og/harsha-de-silva.png`,
      alt: "SL Politics — Harsha de Silva, public record",
      width: 1200,
      height: 630,
    });
  });

  it("emits no image at all when no origin is configured — same gate as canonical", () => {
    const resolved = buildPageMeta({ title: "Home", path: "/" }, "");
    expect(resolved.image).toBeNull();
    expect(resolved.canonical).toBeNull();
  });

  it("renderMetaTags emits exactly one each of og:image / og:image:alt / twitter:image, and summary_large_image", () => {
    const html = renderMetaTags(
      {
        title: "Harsha de Silva",
        path: "/person/harsha-de-silva",
        image: { path: "/og/harsha-de-silva.png", alt: "SL Politics — Harsha de Silva, public record" },
      },
      ORIGIN,
    );

    expect(html.match(/<meta property="og:image" /g)).toHaveLength(1);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og/harsha-de-silva.png">`);
    expect(html).toContain('<meta property="og:image:alt" content="SL Politics — Harsha de Silva, public record">');
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html.match(/<meta name="twitter:image" /g)).toHaveLength(1);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/og/harsha-de-silva.png">`);
  });

  it("a route with no image still gets the default card, not a missing tag", () => {
    const html = renderMetaTags({ title: "Public Figures Directory", path: "/directory" }, ORIGIN);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og/default.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("renderMetaTags degrades to plain 'summary' and no image tags when there is no origin", () => {
    const html = renderMetaTags({ title: "Home", path: "/" }, "");
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });
});
