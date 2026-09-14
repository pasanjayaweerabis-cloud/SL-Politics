/**
 * Javora — minimal client-side router.
 *
 * No routing library: the route table is small and stable, and a dependency
 * would outweigh the ~120 lines here.
 *
 * Two design decisions worth knowing about:
 *
 * 1. NAVIGATION IS INTERCEPTED, NOT DECLARED. A single delegated click handler
 *    on `document` upgrades ordinary same-origin `<a href>` links to
 *    client-side navigation. Every link in the app stays a real anchor with a
 *    real href, so middle-click, ctrl-click, "copy link address", right-click
 *    and screen-reader link lists all keep working — and the app still renders
 *    correctly if JavaScript fails. Rewriting every link as a `<Link>` component
 *    would have bought nothing and broken those behaviours by degrees.
 *
 * 2. FOCUS MOVES ON NAVIGATION. A client-side route change leaves the keyboard
 *    focus wherever it was, which strands screen-reader and keyboard users on a
 *    page that has silently replaced itself. After each navigation focus is
 *    moved to the main landmark and the route change is announced.
 */

import React from "react";
import { flushSync } from "react-dom";

/* ==========================================================================
   Route table
   ========================================================================== */

export type RouteName =
  | "home"
  | "government"
  | "directory"
  | "person"
  | "about"
  | "corrections"
  | "decision-profile-prototype"
  | "harsha-de-silva-profile"
  | "not-found";

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  path: string;
  search: string;
}

interface Pattern {
  name: RouteName;
  /** Path segments; ":name" captures. */
  segments: string[];
}

const PATTERNS: Pattern[] = [
  { name: "home", segments: [] },
  { name: "government", segments: ["government"] },
  { name: "directory", segments: ["directory"] },
  { name: "person", segments: ["person", ":slug"] },
  { name: "about", segments: ["about"] },
  { name: "corrections", segments: ["corrections"] },
  // Design prototype, one hardcoded person — deliberately absent from
  // routeManifest.ts, so it is never prerendered and never sitemapped. See
  // DecisionProfilePrototype.jsx and CLAUDE.md's Route section.
  { name: "decision-profile-prototype", segments: ["prototype", "decision-profile"] },
  // Retired standalone route: the profile now lives at the canonical
  // /person/harsha-de-silva (see PersonPage.jsx's PortfolioPersonPage), and
  // this address is kept resolving via routeManifest.ts's LEGACY_ROUTES
  // rather than 404ing — prerendered, but excluded from the sitemap since
  // the page declares the person route canonical.
  { name: "harsha-de-silva-profile", segments: ["politician", "harsha-de-silva"] },
];

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Resolve a URL to a route.
 *
 * Unknown paths resolve to `not-found` — never silently to the homepage, which
 * would present a 404 as though it were a real page.
 */
export function matchRoute(pathname: string, search = ""): Route {
  const segments = splitPath(pathname);

  for (const pattern of PATTERNS) {
    if (pattern.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < pattern.segments.length; i++) {
      const expected = pattern.segments[i]!;
      const actual = segments[i]!;
      if (expected.startsWith(":")) {
        if (!actual) { matched = false; break; }
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected.toLowerCase() !== actual.toLowerCase()) {
        matched = false;
        break;
      }
    }

    if (matched) return { name: pattern.name, params, path: pathname, search };
  }

  return { name: "not-found", params: {}, path: pathname, search };
}

/**
 * Legacy URL migration.
 *
 * Profiles used to live at `/profile?id=<slug>`. Those links exist in the wild,
 * so they are redirected to the canonical `/person/<slug>` rather than broken.
 *
 * `/parties`, `/elections` and `/sources*` were briefly standalone pages before
 * Javora consolidated back to Home → Directory → Person Profile — that
 * information now lives inside the directory filters and each person's
 * profile. Anyone who bookmarked one of those URLs is sent to the directory
 * rather than hitting a dead link.
 *
 * Returns the replacement URL, or null when no redirect applies.
 */
export function legacyRedirect(pathname: string, search: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);

  if (path === "/profile" || path.endsWith("/profile.html")) {
    const id = params.get("id");
    return id ? `/person/${encodeURIComponent(id)}` : "/directory";
  }
  if (path.endsWith("/directory.html")) return "/directory";
  if (path.endsWith("/index.html")) return "/";
  if (path === "/parties" || path === "/elections") return "/directory";
  if (path === "/sources" || path.startsWith("/sources/") || path.endsWith("/sources.html")) return "/directory";
  return null;
}

/* ==========================================================================
   Navigation
   ========================================================================== */

const ROUTE_EVENT = "javora:routechange";

/** Navigate client-side. `replace` swaps the entry instead of pushing one. */
export function navigate(href: string, { replace = false } = {}): void {
  const url = new URL(href, window.location.origin);
  const current = window.location.pathname + window.location.search;
  const next = url.pathname + url.search;

  if (next === current && !url.hash) return;

  if (replace) window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  else window.history.pushState(null, "", url.pathname + url.search + url.hash);

  window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
}

/**
 * Update the query string without adding a history entry.
 * Used for filter state, which should not create a back-button trap where every
 * keystroke is its own entry.
 */
export function replaceSearch(search: string): void {
  const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
}

/** Push a query-string change so back/forward step through filter states. */
export function pushSearch(search: string): void {
  const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
  window.history.pushState(null, "", url);
  window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
}

/** Whether a click should be left to the browser. */
function isModifiedClick(event: MouseEvent): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * Delegated handler that upgrades internal links to client-side navigation.
 * Anything it declines to handle falls through to normal browser behaviour.
 */
function onDocumentClick(event: MouseEvent): void {
  if (isModifiedClick(event)) return;

  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (!href) return;

  // Leave external links, downloads, new-tab links and explicit opt-outs alone.
  if (anchor.hasAttribute("download")) return;
  if (anchor.hasAttribute("data-native-link")) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href)) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
  }

  // Resolved against the full current URL, not just the origin — a bare
  // `href="#section-id"` (every same-page jump link on this site: SectionNav,
  // the skip link, PortfolioProfile's internal `#hds-*` references) is a
  // relative reference and must resolve against the current PATH too.
  // Resolving it against `window.location.origin` alone silently drops that
  // path, so `url.pathname` came out as "/" for every one of them regardless
  // of which page the reader was actually on — the check below then saw a
  // pathname mismatch, fell through to `navigate()`, and every in-page jump
  // link on any non-home route sent the reader to the homepage instead of
  // scrolling.
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;

  // In-page anchors keep native behaviour so that #main and #search still jump.
  if (url.pathname === window.location.pathname && url.hash) return;

  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

/* ==========================================================================
   Hook
   ========================================================================== */

/**
 * Current route, kept in sync with the address bar.
 *
 * Subscribes to both `popstate` (back/forward) and the internal route event
 * (programmatic navigation), so the two can never drift apart.
 */
export function useRoute(ssrRoute?: Route): Route {
  const read = React.useCallback(
    () =>
      // During prerendering there is no address bar to read. The build passes
      // the route it is rendering, and every effect below is skipped on the
      // server, so the static HTML matches what the browser will hydrate to.
      typeof window === "undefined"
        ? ssrRoute ?? { name: "home", params: {}, path: "/", search: "" }
        : matchRoute(window.location.pathname, window.location.search),
    [ssrRoute],
  );
  const [route, setRoute] = React.useState<Route>(read);

  React.useEffect(() => {
    /*
     * `flushSync` forces the route-state commit to happen synchronously
     * inside the view-transition callback, which is what lets the browser
     * capture a real "before" and "after" screenshot to crossfade between —
     * without it, React would defer the re-render and the transition would
     * have nothing to animate from. Reduced motion and browsers without the
     * API both fall through to a plain, un-transitioned commit.
     *
     * Navigating INTO /directory is exempted from the pool above: it
     * synchronously commits ~12 full ProfileResult cards plus roughly 1,611
     * cheap ProfileResultLink anchors (see DirectoryPage.jsx and the render
     * cost comment on ProfileResultLink) while the transition is holding a
     * snapshot. Measured with document.startViewTransition's callback
     * instrumented directly (this tool's environment has no DevTools CPU
     * throttling; a `Long Task` observer was used instead of a stopwatch):
     * on the production build (serve:dist) the flushSync commit itself
     * measured 14-42ms unthrottled — under the ~100ms budget on this
     * machine — but the *dev server* (unminified React) measured ~108-110ms
     * for the identical navigation, and DevTools' own 4x CPU-slowdown preset
     * is a reasonable proxy for a mid/low-end phone, which would put even
     * the production number over budget (33-42ms x4 ~= 130-170ms). Given a
     * public-record site cannot assume a fast device, and a hard cut here
     * costs nothing but a 160ms crossfade, this route skips the transition
     * rather than risk the stall on real hardware this could not measure.
     */
    const update = () => {
      const next = read();
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const heavy = next.name === "directory";
      if (document.startViewTransition && !reduceMotion && !heavy) {
        const transition = document.startViewTransition(() => { flushSync(() => setRoute(next)); });
        // The browser aborts a transition outright (an InvalidStateError,
        // surfacing as an unhandled rejection) whenever it decides one isn't
        // valid right now — e.g. the tab went to the background mid-navigation.
        // That's a plain hard cut, not a bug: swallow it rather than let it
        // reach the console.
        transition.ready.catch(() => {});
        transition.updateCallbackDone.catch(() => {});
        transition.finished.catch(() => {});
      } else {
        setRoute(next);
      }
    };
    window.addEventListener("popstate", update);
    window.addEventListener(ROUTE_EVENT, update);
    document.addEventListener("click", onDocumentClick);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(ROUTE_EVENT, update);
      document.removeEventListener("click", onDocumentClick);
    };
  }, [read]);

  // Migrate legacy URLs before anything renders against them.
  React.useEffect(() => {
    const redirect = legacyRedirect(window.location.pathname, window.location.search);
    if (redirect) navigate(redirect, { replace: true });
  }, [route.path]);

  return route;
}

/*
 * `useLayoutEffect` in the browser (runs synchronously before the next
 * paint), `useEffect` under SSR — react-dom/server has no concept of layout
 * effects and warns if one is used. `useRouteTransition` below needs the
 * synchronous version: PROVISIONAL section 5b's view transition captures its
 * "after" screenshot right after the route-state commit flushes, and an
 * ordinary passive effect runs too late for that — the scroll-to-top and
 * focus move would land after the screenshot, so the crossfade would show
 * whatever was at the OLD scroll offset instead of the new page's top.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Move focus and scroll position on navigation.
 *
 * Skipped on the initial render — moving focus before the user has interacted
 * would be disorienting and would fight the browser's own restoration on a
 * back navigation.
 */
export function useRouteTransition(route: Route): void {
  const firstRender = React.useRef(true);
  const key = `${route.name}:${JSON.stringify(route.params)}`;

  useIsomorphicLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    window.scrollTo({ top: 0, behavior: "auto" });
    const main = document.getElementById("main");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
      // Remove the tabindex again so main is not a lingering tab stop.
      const clear = () => main.removeAttribute("tabindex");
      main.addEventListener("blur", clear, { once: true });
    }
  }, [key]);
}
