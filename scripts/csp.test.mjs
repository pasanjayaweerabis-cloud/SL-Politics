import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiConnectOrigin, connectSrc, cspReportingDirectives, reportingEndpointsHeader } from "./csp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Javora — CSP connect-src.
 *
 * The regression this file exists for: `connect-src` was hardcoded to
 * `'self'` while .env.production.example ships a CROSS-ORIGIN API
 * (site https://javora.lk, API https://api.javora.lk). Every browser API call
 * in that configuration was blocked by policy, and blocked silently — the
 * page catches the failure and falls back to the bundled dataset, so it looks
 * correct while serving stale data forever.
 */

describe("apiConnectOrigin", () => {
  it("returns the API origin when it differs from the site origin", () => {
    // The exact production configuration that was broken.
    expect(apiConnectOrigin("https://api.javora.lk", "https://javora.lk")).toBe("https://api.javora.lk");
  });

  it("returns only the origin, never a path", () => {
    // connect-src matches scheme/host/port; a path neither restricts further
    // nor matches correctly.
    expect(apiConnectOrigin("https://api.javora.lk/v1/people", "https://javora.lk")).toBe("https://api.javora.lk");
  });

  it("returns null for a same-origin API — 'self' already covers it", () => {
    expect(apiConnectOrigin("https://javora.lk", "https://javora.lk")).toBeNull();
    expect(apiConnectOrigin("https://javora.lk/api", "https://javora.lk")).toBeNull();
  });

  it("distinguishes origins that differ only by port or scheme", () => {
    expect(apiConnectOrigin("http://localhost:4000", "http://localhost:5173")).toBe("http://localhost:4000");
    expect(apiConnectOrigin("http://javora.lk", "https://javora.lk")).toBe("http://javora.lk");
  });

  it("returns null when no API is configured", () => {
    expect(apiConnectOrigin(undefined, "https://javora.lk")).toBeNull();
    expect(apiConnectOrigin("", "https://javora.lk")).toBeNull();
    expect(apiConnectOrigin("   ", "https://javora.lk")).toBeNull();
  });

  it("returns null rather than throwing on an unparseable value", () => {
    // An invalid VITE_API_URL already disables the API client, so there is no
    // origin worth allowing — and no reason to fail an otherwise good build.
    expect(apiConnectOrigin("not a url", "https://javora.lk")).toBeNull();
  });
});

describe("connectSrc", () => {
  it("allows the cross-origin API alongside 'self'", () => {
    expect(connectSrc("https://api.javora.lk", "https://javora.lk")).toBe("connect-src 'self' https://api.javora.lk");
  });

  it("is exactly \"connect-src 'self'\" when no API is configured", () => {
    expect(connectSrc(undefined, "https://javora.lk")).toBe("connect-src 'self'");
  });
});

/*
 * L-8 (docs/security-audit-followup-2026-09-04.md). The CSP carried no
 * violation-reporting directive at all — a policy violation in production
 * was invisible. CSP_REPORT_URI is optional and unset by default, so the
 * key behaviour to pin is that an unset endpoint changes nothing about the
 * generated CSP (no build should ever break over this).
 */
describe("cspReportingDirectives", () => {
  it("is empty when no endpoint is configured — the CSP is unaffected", () => {
    expect(cspReportingDirectives(undefined)).toEqual([]);
    expect(cspReportingDirectives("")).toEqual([]);
    expect(cspReportingDirectives("   ")).toEqual([]);
  });

  it("emits both report-uri and report-to when an endpoint is set", () => {
    expect(cspReportingDirectives("https://reports.javora.lk/csp")).toEqual([
      "report-uri https://reports.javora.lk/csp",
      "report-to csp-endpoint",
    ]);
  });
});

describe("reportingEndpointsHeader", () => {
  it("is null when no endpoint is configured", () => {
    expect(reportingEndpointsHeader(undefined)).toBeNull();
    expect(reportingEndpointsHeader("")).toBeNull();
  });

  it("names the same group cspReportingDirectives' report-to points at", () => {
    const header = reportingEndpointsHeader("https://reports.javora.lk/csp");
    expect(header).toBe('csp-endpoint="https://reports.javora.lk/csp"');
    // The group name in both must match, or report-to is a dangling
    // reference to an endpoint group the header never actually defines.
    const [, groupName] = cspReportingDirectives("https://reports.javora.lk/csp")[1].split(" ");
    expect(header?.startsWith(`${groupName}=`)).toBe(true);
  });
});

describe("the production configuration this bug broke", () => {
  it("the API origin in .env.production.example is NOT covered by 'self'", () => {
    // Reads the shipped example directly: if someone later changes the API to
    // a same-origin path, this test says so rather than silently passing on a
    // configuration that no longer exercises the bug.
    const env = readFileSync(join(ROOT, ".env.production.example"), "utf8");
    const site = env.match(/^VITE_SITE_ORIGIN=(\S+)/m)?.[1];
    const api = env.match(/^VITE_API_URL=(\S+)/m)?.[1];

    expect(site, "VITE_SITE_ORIGIN missing from .env.production.example").toBeTruthy();
    expect(api, "VITE_API_URL missing from .env.production.example").toBeTruthy();

    const origin = apiConnectOrigin(api, site);
    expect(
      origin,
      `production ships site=${site} api=${api}; connect-src must name the API origin explicitly`,
    ).toBe(new URL(api).origin);
  });

  it("prerender.mjs builds connect-src from apiConnectOrigin, not a hardcoded literal", () => {
    const source = readFileSync(join(ROOT, "scripts", "prerender.mjs"), "utf8");
    expect(source).toMatch(/connect-src 'self'\$\{apiOrigin/);
    // The exact hardcoded form that shipped the bug must not come back.
    expect(source).not.toMatch(/["`]connect-src 'self'["`]\s*,/);
  });
});
