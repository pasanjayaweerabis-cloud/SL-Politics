import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/**
 * Javora — HTTP-level regression tests for scripts/serve-dist.mjs.
 *
 * These make real requests, over a real socket, against a real spawned
 * `serve-dist.mjs` process — the same way server/api/server.test.ts exercises
 * server.ts — because the bug this file guards against (F1: an unhandled
 * exception that crashed the whole process) is a property of the running HTTP
 * server, not of any function that could be called directly. A direct import
 * would also be wrong here for a second reason: the script calls `.listen()`
 * as a side effect of being loaded, so it cannot be imported into the same
 * process as the test runner without starting a server the test file never
 * asked for.
 *
 * SKIPPING. dist/ is gitignored and absent until `npm run build` has run,
 * matching scripts/prerenderOutput.test.mjs's own skip rule.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HAVE_DIST = existsSync(join(ROOT, "dist", "index.html"));

/*
 * M-3 (docs/security-audit-followup-2026-09-04.md): the same dist/-dependent
 * skip that silently disabled distSecretScan.test.mjs, deploy/nginxCsp.
 * test.mjs and scripts/prerenderOutput.test.mjs in CI applies here too — this
 * is the F1 crash-recovery regression test, and it never ran in CI either.
 */
if (process.env.CI && !HAVE_DIST) {
  throw new Error(
    "dist/ is missing in CI. `npm run build` (with VITE_SITE_ORIGIN set) must run before `npm test` " +
      "so this suite actually exercises the built static server instead of skipping silently.",
  );
}

// A port unlikely to collide with the default (5190) or another test run.
const PORT = 20000 + (process.pid % 10000);
const BASE = `http://127.0.0.1:${PORT}`;

/** Poll until the server answers or the timeout elapses. */
async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`serve-dist did not start listening on ${PORT} in time`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

describe.skipIf(!HAVE_DIST)("scripts/serve-dist.mjs", () => {
  let child;

  beforeAll(async () => {
    child = spawn(process.execPath, [join(ROOT, "scripts", "serve-dist.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "pipe",
    });
    await waitForServer();
  }, 15000);

  afterAll(() => {
    child?.kill();
  });

  it("serves the homepage normally", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
  });

  it("F1 — returns 400, not a crash, for malformed percent-encoding", async () => {
    // Before the fix, a single request like this raised an uncaught URIError
    // inside the async request handler (decodeURIComponent throws on a lone
    // "%"), which Node treats as an unhandled rejection and exits the
    // process — verified live during the audit: every request after this one
    // failed with ECONNREFUSED. The correct behaviour is a 400.
    const res = await fetch(`${BASE}/%`);
    expect(res.status).toBe(400);
  });

  it("F1 — the process survives a malformed request and keeps serving others", async () => {
    await fetch(`${BASE}/%`).catch(() => {});
    await fetch(`${BASE}/%zz`).catch(() => {});
    // If the process had crashed, this would reject with ECONNREFUSED rather
    // than resolving.
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
  });

  it("path traversal is still blocked, including encoded and null-byte forms", async () => {
    for (const path of [
      "/../../../../etc/passwd",
      "/..%2f..%2f..%2f..%2fetc%2fpasswd",
      "/%252e%252e%252fetc%252fpasswd",
      "/%00",
    ]) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.status).toBe(404);
    }
  });

  it("F2 — the 404 response carries the same security headers as a 200", async () => {
    const res = await fetch(`${BASE}/this-page-does-not-exist-anywhere`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("F2 — the 400 response for a malformed path also carries the security headers", async () => {
    const res = await fetch(`${BASE}/%`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe.skipIf(HAVE_DIST)("scripts/serve-dist.mjs", () => {
  it("skipped: dist/ has not been built", () => {
    expect(true).toBe(true);
  });
});
