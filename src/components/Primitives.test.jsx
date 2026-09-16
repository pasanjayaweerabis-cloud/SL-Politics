import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { StatsCard } from "./Primitives.jsx";

/**
 * Javora — `StatsCard` used to print `value` with a bare `String(value)`,
 * so About showed "1623" next to Home's own "1,623" for the identical
 * figure (About-page cleanup audit). It now groups numbers through the same
 * `n()`/`formatCount` the rest of the interface uses (see `lib/i18n.jsx`) —
 * except a value already handed to it as a string, which must pass through
 * untouched: a year run through `n()` would become "1,931", which is wrong.
 * No `I18nProvider` wrapper needed — `useI18n()`'s default context value
 * already resolves to English, same pattern `CorrectionsPage.test.jsx` uses.
 */
describe("StatsCard number formatting", () => {
  const render = (props) => renderToString(React.createElement(StatsCard, props));

  it("groups a numeric value with thousands separators", () => {
    expect(render({ value: 1623, label: "Public figures" })).toContain("1,623");
  });

  it("does not group a value already passed as a string — a year stays a year", () => {
    const out = render({ value: "1931", label: "Oldest office on record" });
    expect(out).toContain("1931");
    expect(out).not.toContain("1,931");
  });

  it("leaves a non-numeric placeholder like '—' untouched", () => {
    expect(render({ value: "—", label: "Oldest office on record" })).toContain("—");
  });
});
