import { describe, it, expect } from "vitest";
import en from "./en.js";
import si from "./si.js";
import ta from "./ta.js";

/**
 * Javora — `resolve()` in lib/i18n.jsx falls back English-ward on a missing
 * key, so a gap in si.js or ta.js never blanks a label or throws. That is
 * exactly why a gap can go unnoticed: the interface silently reads in
 * English for that one string, in the middle of a page a Sinhala or Tamil
 * reader chose. This test makes the gap visible instead, by requiring the
 * locale files to declare the same set of dotted key paths — scoped to the
 * namespaces below.
 *
 * NOT scoped to every namespace. `government`, `directory`, `person` and
 * `toast` still carry a large, pre-existing gap — si.js and ta.js are
 * missing roughly eighty keys each in those sections alone, none of them
 * touched by the homepage or About-page UX work this test was written for
 * (homepage-ux-fixes-prompt.md, about-page-ux-fixes-prompt.md). Asserting
 * parity across the whole dictionary would make this test fail on
 * unrelated, long-standing translation debt from the moment it is added,
 * which would either block unrelated work or get the test silenced — worse
 * than the gap it exists to catch. `common` has the same problem (missing
 * status-label keys). Widening this list further is a translation project
 * of its own, not a side effect of a page-copy change.
 *
 * `about` and `corrections` were added once the About-page cleanup closed
 * their own gap (about.* was previously 100% untranslated in si/ta;
 * corrections.* was missing one key in each) — see the About-page prompt's
 * Task 8.
 */
const SYNCED_NAMESPACES = ["nav", "footer", "home", "dataset", "about", "corrections"];

function collectKeyPaths(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeyPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n locale files share one key set (nav, footer, home)", () => {
  const enKeys = new Set(SYNCED_NAMESPACES.flatMap((ns) => collectKeyPaths(en[ns as keyof typeof en], ns)));

  for (const [name, dict] of [
    ["si", si],
    ["ta", ta],
  ] as const) {
    it(`${name}.js is missing no key en.js has`, () => {
      const keys = new Set(SYNCED_NAMESPACES.flatMap((ns) => collectKeyPaths(dict[ns as keyof typeof dict], ns)));
      const missing = [...enKeys].filter((key) => !keys.has(key));
      expect(missing).toEqual([]);
    });

    it(`${name}.js carries no key en.js lacks`, () => {
      const keys = SYNCED_NAMESPACES.flatMap((ns) => collectKeyPaths(dict[ns as keyof typeof dict], ns));
      const extra = keys.filter((key) => !enKeys.has(key));
      expect(extra).toEqual([]);
    });
  }
});
