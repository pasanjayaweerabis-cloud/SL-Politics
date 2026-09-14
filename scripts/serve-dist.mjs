/**
 * Javora — a static server with production semantics.
 *
 * `vite preview` is not a proxy for production: it answers every unmatched
 * path with the SPA shell BEFORE it looks for a matching file, so
 * `/person/harini-amarasuriya` returns the homepage even though
 * `dist/person/harini-amarasuriya/index.html` exists. Verifying prerendering
 * against it would prove nothing.
 *
 * So this implements the resolution order a static host must use, in order:
 *
 *   1. the exact file                     /sitemap.xml
 *   2. that path's directory index        /person/x  -> /person/x/index.html
 *   3. 404.html, with a real 404 status
 *
 * Step 3 is the one that is easy to get wrong. The tempting SPA config
 * rewrites every miss to index.html and returns 200, so a search engine
 * indexes an unlimited supply of "record not found" pages that all claim to
 * exist. There is no SPA fallback here at all, and there should not be one in
 * production either: every real route is prerendered to its own file.
 *
 * This file is also the executable specification for deploy/. If a host's
 * config disagrees with this, the host is wrong.
 *
 *   npm run serve:dist
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 5190);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * The generated policy, applied here so it is actually exercised.
 *
 * A CSP that is only ever written into a config file is a CSP nobody has
 * tested. The inline theme script is allowed by hash, and a stale hash breaks
 * it silently — the page still renders, the theme just flashes. Serving the
 * real policy locally turns that into a visible console violation.
 */
let CSP = "";
try {
  CSP = readFileSync(join(DIST, "csp.txt"), "utf8").trim();
} catch {
  console.warn("serve-dist: no csp.txt — run the build first to generate it");
}

/**
 * Refuse to let a stale dist/ pass itself off as the current build.
 *
 * This server is what `npm run validate:crawlability` points at, so serving a
 * dist/ built before the last source change means the project's HARD GATE
 * passes against code nobody is running any more — and it passes cleanly,
 * which is what makes it dangerous. It also accounts for most of the "why does
 * the built site look different from the dev server" confusion: usually the
 * answer is that it does not, it is just older.
 *
 * A warning, never a refusal. Serving a deliberately old build is a legitimate
 * thing to do — comparing rendered output before and after a change is exactly
 * how several changes in this repository were verified.
 */
function newestSourceFile() {
  // The inputs the prerender actually consumes. public/ is copied verbatim and
  // cannot change the rendered HTML, so it is left out rather than reported as
  // a false positive.
  const roots = ["index.html", "vite.config.js", join("scripts", "prerender.mjs")];
  const files = roots.map((relative) => join(ROOT, relative));

  // Node >= 24 is already required (see CLAUDE.md), so recursive readdir needs
  // no dependency and no hand-rolled walk.
  for (const entry of readdirSync(join(ROOT, "src"), { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
  }

  let newest = null;
  for (const file of files) {
    try {
      const mtime = statSync(file).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { file, mtime };
    } catch {
      // A listed root that does not exist is not this check's problem.
    }
  }
  return newest;
}

try {
  const built = statSync(join(DIST, "index.html")).mtimeMs;
  const newest = newestSourceFile();
  if (newest && newest.mtime > built) {
    const relative = newest.file.startsWith(ROOT) ? newest.file.slice(ROOT.length + 1) : newest.file;
    console.warn(
      `\nserve-dist: STALE BUILD — dist/ is older than the source it was built from.` +
        `\n  newest source : ${relative}` +
        `\n  built         : ${new Date(built).toISOString()}` +
        `\n  source change : ${new Date(newest.mtime).toISOString()}` +
        `\n  Serving it anyway. Anything you check here — including` +
        `\n  validate:crawlability — is judging the OLD build.` +
        `\n  Run: VITE_SITE_ORIGIN=https://javora.lk npm run build\n`,
    );
  }
} catch {
  console.warn("serve-dist: no dist/index.html — run the build first, or every route will 404");
}

async function readIfFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? await readFile(path) : null;
  } catch {
    return null;
  }
}

/**
 * Headers every response carries, success or not — pulled out so the 404
 * fallback does not silently skip them, which it did until this was found: a
 * `writeHead(404, { "content-type": ... })` with nothing else meant the one
 * page every broken link serves shipped with no CSP, no X-Content-Type-Options,
 * no X-Frame-Options at all.
 */
function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    ...(CSP ? { "content-security-policy": CSP } : {}),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Reject traversal before touching the filesystem: a request for
  // /../../.env must never resolve outside dist/.
  //
  // decodeURIComponent throws on malformed percent-encoding (a lone "%", an
  // incomplete "%2", ...) — the WHATWG URL parser does not validate that
  // before handing back `pathname`. That is a malformed CLIENT request, not a
  // reason to crash: left unguarded, a single `GET /%` raised an uncaught
  // URIError inside this async handler with no catch anywhere above it,
  // which Node treats as an unhandled rejection and exits the process —
  // verified live, one such request took the whole server down for every
  // other client.
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8", ...securityHeaders() }).end("bad request");
    return;
  }

  const requested = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const target = join(DIST, requested);
  if (!target.startsWith(DIST)) {
    res.writeHead(403, securityHeaders()).end("forbidden");
    return;
  }

  const candidates = requested.endsWith("/")
    ? [join(target, "index.html")]
    : [target, join(target, "index.html")];

  for (const candidate of candidates) {
    const body = await readIfFile(candidate);
    if (!body) continue;
    const type = TYPES[extname(candidate)] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      ...securityHeaders(),
      // Hashed assets are immutable; HTML must revalidate so a deploy is seen.
      "cache-control": candidate.includes(`${join("assets", "")}`)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    });
    res.end(body);
    return;
  }

  const notFound = await readIfFile(join(DIST, "404.html"));
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", ...securityHeaders() });
  res.end(notFound ?? "404");
}).listen(PORT, () => {
  console.log(`serving dist/ with production semantics on http://localhost:${PORT}`);
});
