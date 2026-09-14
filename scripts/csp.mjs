/**
 * Javora — Content-Security-Policy construction.
 *
 * Extracted from prerender.mjs so the one directive with a history of being
 * silently wrong can be tested directly.
 *
 * THE BUG THIS EXISTS TO PREVENT. `connect-src` was hardcoded to `'self'`,
 * with a comment claiming the deployment would add the API origin. Nothing
 * did, and nothing could: the CSP is generated at build time and written into
 * dist/_headers alongside a hash of the inline theme script, so a deployment
 * editing it afterwards would have to re-derive that hash too.
 *
 * The configuration this broke is the one .env.production.example actually
 * ships: VITE_SITE_ORIGIN=https://javora.lk with
 * VITE_API_URL=https://api.javora.lk. Those are different origins, so every
 * API call from the browser was blocked by policy — and blocked SILENTLY,
 * because GovernmentPage catches the failure and falls back to the bundled
 * dataset. The page looks correct and serves stale data indefinitely.
 *
 * Found by loading a real production build in a real browser against a real
 * API and reading the console, not by code review.
 */

/**
 * The API origin to allow in `connect-src`, or null when there is nothing to add.
 *
 * Returns null for a same-origin API (already covered by `'self'`), for an
 * unset value, and for an unparseable one — an invalid VITE_API_URL already
 * means the API client is disabled, so there is no origin worth allowing and
 * no reason to fail the build over it.
 */
export function apiConnectOrigin(apiUrl, siteOrigin) {
  const raw = apiUrl?.trim();
  if (!raw) return null;
  try {
    const origin = new URL(raw).origin;
    return origin === siteOrigin ? null : origin;
  } catch {
    return null;
  }
}

/** The `connect-src` directive value for a build. */
export function connectSrc(apiUrl, siteOrigin) {
  const origin = apiConnectOrigin(apiUrl, siteOrigin);
  return `connect-src 'self'${origin ? ` ${origin}` : ""}`;
}

/**
 * L-8 (docs/security-audit-followup-2026-09-04.md). The CSP carried no
 * violation-reporting directive at all, so a policy violation in production
 * — a misconfigured script tag, a future edit that breaks the inline theme
 * script's hash, an actual injection attempt — was invisible: nothing
 * anywhere records that the browser ever blocked something.
 *
 * Returns the `report-uri`/`report-to` directives to append to the CSP
 * array, or an empty array when no endpoint is configured — so an unset
 * `CSP_REPORT_URI` produces byte-identical output to a build from before
 * this existed, and never breaks a build over a feature nobody opted into.
 *
 * BOTH directives, deliberately. `report-uri` is deprecated but still the
 * only one every current browser actually honours without extra setup;
 * `report-to` is its replacement, needed for browsers that have started
 * removing `report-uri` support — but `report-to` alone is a dangling
 * reference unless a matching `Reporting-Endpoints` HTTP header is also
 * sent (see reportingEndpointsHeader below), so the two always ship as a pair.
 */
export function cspReportingDirectives(endpoint) {
  const url = endpoint?.trim();
  if (!url) return [];
  return [`report-uri ${url}`, "report-to csp-endpoint"];
}

/**
 * The `Reporting-Endpoints` header `report-to csp-endpoint` above refers to
 * by name — the Reporting API's current (non-deprecated) way of naming an
 * endpoint, superseding the older `Report-To` JSON header. Returns null
 * when no endpoint is configured, matching cspReportingDirectives above.
 */
export function reportingEndpointsHeader(endpoint) {
  const url = endpoint?.trim();
  if (!url) return null;
  return `csp-endpoint="${url}"`;
}
