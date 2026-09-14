import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import CorrectionsPage from "./CorrectionsPage.jsx";

/**
 * Javora — what CorrectionsPage may and may not send (L-9 / Invariant 3).
 *
 * WHAT THIS FILE USED TO ASSERT, AND WHY IT CHANGED. Until the corrections
 * write path shipped, the invariant here was absolute: the page called
 * `fetch` nowhere, because the API was GET-only and there was nowhere to
 * send a report. `POST /api/corrections` (server/api/corrections.ts, built to
 * docs/corrections-security-design.md) makes that no longer true, and the
 * honest move is to narrow the invariant rather than delete it:
 *
 *   BEFORE  the page never issues a network request, at all.
 *   NOW     the page issues exactly one, only from the submit handler, only
 *           to the configured API origin, and never while rendering.
 *
 * The render-time half — which was always the stronger half — is unchanged
 * and still asserted below. Prerendering runs this component on the server
 * for a static page; a request fired during render would be both a hydration
 * hazard and a privacy leak (a reader who opened the page, filled in
 * nothing, and submitted nothing must transmit nothing).
 *
 * The same limit `src/components/components.test.tsx` documents applies here:
 * no jsdom/RTL is installed (a deliberate, documented position), so there is
 * no way to dispatch a real `submit` event and watch the handler run. Two
 * checks stand in for it:
 *
 *   1. STATIC — the file's networking primitives are enumerated and checked
 *      against an allowlist of exactly one call site. Stronger than a single
 *      simulated click: it proves no OTHER path in the file can fetch, not
 *      just that the path a test happened to exercise doesn't.
 *   2. RENDER-TIME — render with `fetch`/`XMLHttpRequest` stubbed to throw,
 *      and assert neither fires. This covers what static reading cannot: a
 *      call assembled dynamically (`window['fetch']`) would not be greppable.
 *
 * The server-side half of "the client is not trusted" is not tested here at
 * all, by design — it is in `server/api/corrections.test.ts`, against a real
 * HTTP server, on the premise that the request never came from this page.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_SOURCE = readFileSync(join(HERE, "CorrectionsPage.jsx"), "utf8");
const SERVICE_SOURCE = readFileSync(join(HERE, "..", "services", "corrections.ts"), "utf8");
const CLIENT_SOURCE = readFileSync(join(HERE, "..", "services", "apiClient.ts"), "utf8");

const NETWORK_PRIMITIVES = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\b/,
  /\bnew\s+WebSocket\b/,
  /\baxios\b/,
];

describe("the page and the validation service still contain no networking primitive (static)", () => {
  it("CorrectionsPage.jsx makes no network call of its own — it delegates to apiClient", () => {
    for (const pattern of NETWORK_PRIMITIVES) {
      expect(PAGE_SOURCE, `CorrectionsPage.jsx matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("services/corrections.ts — validation and payload building stay pure", () => {
    for (const pattern of NETWORK_PRIMITIVES) {
      expect(SERVICE_SOURCE, `services/corrections.ts matches ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe("the one write goes to the configured API origin and nowhere else", () => {
  /*
   * Every `fetch(` in apiClient.ts, with the expression it is called on.
   * The file is the whole networking surface of the frontend, so enumerating
   * its call sites is enumerating everything the app can talk to.
   */
  const CALL_SITES = [...CLIENT_SOURCE.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());

  it("every request is built from API_BASE, never a literal or reporter-supplied URL", () => {
    expect(CALL_SITES.length).toBeGreaterThan(0);
    for (const target of CALL_SITES) {
      expect(target, `fetch(${target}) does not start from API_BASE`).toContain("${API_BASE}");
    }
  });

  it("exactly one call site is a POST, and it is the corrections endpoint", () => {
    const posts = [...CLIENT_SOURCE.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(posts).toEqual(["POST"]);
    expect(CLIENT_SOURCE).toMatch(/fetch\(`\$\{API_BASE\}\/api\/corrections`/);
  });

  it("never sends the currentValue the page displayed — the server re-derives it", () => {
    // The specific claim server/api/corrections.ts refuses to trust. Sending
    // it anyway would be harmless (it is ignored) but would misrepresent, in
    // this file, which side owns the check.
    const body = CLIENT_SOURCE.slice(CLIENT_SOURCE.indexOf("export async function submitCorrection"));
    expect(body.slice(0, body.indexOf("\n}"))).not.toMatch(/currentValue/);
  });
});

describe("CorrectionsPage triggers no network call while rendering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders successfully with fetch/XMLHttpRequest stubbed to throw, and never calls either", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("CorrectionsPage must never call fetch() during render");
    });
    const xhrSpy = vi.fn(() => {
      throw new Error("CorrectionsPage must never construct XMLHttpRequest");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhrSpy);

    const out = renderToString(<CorrectionsPage route={{ search: "" }} />);

    expect(out).toContain("Report an error");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });

  it("says plainly that nothing is transmitted when no API is configured", () => {
    // `VITE_API_URL` is unset under test, which is also the default for a
    // static deployment — so this is the copy most readers see, and it must
    // keep telling them the truth rather than promising a submission the
    // build cannot make.
    const out = renderToString(<CorrectionsPage route={{ search: "" }} />);
    expect(out).toMatch(/is transmitted or stored anywhere/);
    expect(out).toContain("Validate report");
    expect(out).not.toContain("Submit report");
  });
});
