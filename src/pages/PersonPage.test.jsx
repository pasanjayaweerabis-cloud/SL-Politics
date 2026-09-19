import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import PersonPage from "./PersonPage.jsx";
import { getPersonBySlug } from "../services/repository.ts";
import { formatDate } from "../lib/date.ts";
import { HARSHA_DE_SILVA } from "../data/harshaDeSilva.ts";

/**
 * Javora — which layout /person/:slug renders.
 *
 * PersonPage dispatches on src/data/profileContent.ts: a slug with portfolio
 * content renders PortfolioProfile (the "hds-profile" markup); every other
 * slug keeps the tabbed layout unchanged. This is the regression these tests
 * guard: Harsha de Silva's profile used to render either the tabbed layout
 * (the original bug report) or, briefly in development, a third, differently
 * wired "decision-first" layout — see git history around profileContent.ts.
 * Only ONE slug is mapped today, so only ONE slug's rendering should differ.
 */

describe("PersonPage layout dispatch", () => {
  it("renders the portfolio profile for /person/harsha-de-silva", () => {
    const html = renderToString(<PersonPage slug="harsha-de-silva" />);
    expect(html).toContain("hds-profile");
    expect(html).toContain("What was done");
    expect(html).toContain("The office");
  });

  it("still keeps the site's 'Back to Directory' affordance on the portfolio profile", () => {
    const html = renderToString(<PersonPage slug="harsha-de-silva" />);
    expect(html).toContain("profile-header__nav");
    expect(html).toContain('href="/directory"');
  });

  it("renders the ordinary tabbed layout for a different, real slug", () => {
    // A real, currently-imported member unrelated to the portfolio content
    // map — see src/services/__golden__/slugs.tsv.
    const html = renderToString(<PersonPage slug="karu-jayasuriya" route={{ search: "" }} />);
    expect(html).not.toContain("hds-profile");
    expect(html).toContain("section-card");
  });

  it("does not affect an unrelated slug even though it renders after harsha-de-silva", () => {
    // Guards against the resolver leaking state across renders (e.g. a
    // module-level cache keyed wrong) rather than being a pure per-slug map.
    renderToString(<PersonPage slug="harsha-de-silva" />);
    const html = renderToString(<PersonPage slug="karu-jayasuriya" route={{ search: "" }} />);
    expect(html).not.toContain("hds-profile");
  });
});

/**
 * The portfolio profile's structure: one office, one guided scroll, no tabs.
 * These pin the section order, the "on this page" nav, and the honesty
 * rules the voter-clarity pass exists to enforce — that nothing here can
 * show "Verified" without real evidence and a check date, that an unlisted
 * reference never masquerades as a real citation, and that every fact still
 * in the prerendered HTML even where it starts collapsed.
 *
 * What these tests DELIBERATELY do not pin: exact column widths, exact
 * copy wording (covered by PortfolioProfile.copy.test.jsx and the banned-
 * phrase check below), or anything about `TabbedPersonPage` — this page no
 * longer uses `Tabs`/`TabPanel` at all.
 */
describe("PortfolioProfile — single-scroll structure", () => {
  const html = () => renderToString(<PersonPage slug="harsha-de-silva" />);
  const SECTION_IDS = ["hds-office", "hds-actions", "hds-decisions", "hds-not-recorded", "hds-other-offices", "hds-sources"];

  it("renders no tablist, and orders every section the reader's-path table asks for", () => {
    const out = html();
    expect(out).not.toContain('role="tablist"');

    const positions = SECTION_IDS.map(id => {
      const marker = `<h2 id="${id}"`;
      const count = out.split(marker).length - 1;
      expect(count, `expected exactly one heading with id "${id}"`).toBe(1);
      return out.indexOf(marker);
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("gives the sticky nav a real anchor to every section that rendered", () => {
    const out = html();
    for (const id of SECTION_IDS) {
      expect(out).toContain(`href="#${id}"`);
    }
  });

  it("derives the hero term and appointments from the canonical record, not string literals", () => {
    const view = getPersonBySlug("harsha-de-silva");
    const focusPositions = view.positions.filter(p => p.roleType === HARSHA_DE_SILVA.focusPosition.roleType);
    expect(focusPositions.length).toBe(HARSHA_DE_SILVA.focusPosition.appointments.length);

    const out = html();
    for (const position of focusPositions) {
      expect(out).toContain(position.title);
      expect(out).toContain(formatDate(position.startDate));
      expect(out).toContain(formatDate(position.endDate));
    }
  });

  it("keeps every action and decision inside the term, or marks it a later sourced result", () => {
    const termStart = HARSHA_DE_SILVA.focusPosition.appointments[0].start.date;
    const termEnd = HARSHA_DE_SILVA.focusPosition.appointments.at(-1).end.date;
    for (const row of HARSHA_DE_SILVA.actions) {
      if (!row.period) continue; // no date recorded at all — nothing to check against the term
      const inTerm = row.period.start.date >= termStart && (!row.period.end || row.period.end.date <= termEnd);
      expect(inTerm || row.isLaterResult, `${row.id} is dated outside the term and not marked as a later result`).toBe(true);
    }
    // All four researched votes/positions fell outside the term (see
    // docs/research/harsha-de-silva-out-of-scope.md) — the section renders
    // its honest empty line instead of any of them.
    expect(HARSHA_DE_SILVA.decisions).toEqual([]);
  });

  it("never shows a Verified badge — nothing in this hand-researched file carries a check date", () => {
    const out = html();
    expect(out).not.toContain("badge--verified");
  });

  it("never prints removed editorial language or internal jargon", () => {
    const out = html();
    for (const banned of [
      "What it tells the voter", "Effect on people", "Potentially positive",
      "strengths", "should still verify", "dossier", "prototype", "research file",
      "transcribed", "Tier", "See in 01", "2015 / Baseline", "records shown",
    ]) {
      expect(out).not.toContain(banned);
    }
  });

  it("never links an unlisted reference, and never prints one as a bare visible token", () => {
    const out = html();
    const hrefs = [...out.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    expect(hrefs.some(h => h.includes("S17") || h.includes("S18"))).toBe(false);
    expect(out).not.toMatch(/>S1[0-9]</);
    expect(out).toContain('data-unlisted-ids="S17,S18"');
    expect(out).toContain("Source not yet listed");
  });

  it("keeps content inside closed <details> and hidden detail rows in the prerendered HTML", () => {
    const out = html();
    expect(out).toContain("State Minister of National Policies"); // closed "Other offices held"
    expect(out).toContain("Sunday Times (Business Times)"); // closed "Sources"
    expect(out).toContain("Helps rice millers operate and purchase paddy"); // hidden action detail row
  });

  it("renders What was done as a real table, and never an empty table for the empty Decisions & votes", () => {
    const out = html();
    const tableCount = (out.match(/<table\b/g) ?? []).length;
    // Decisions & votes is empty for Harsha de Silva — an honest empty line,
    // never an empty <table>. Only "What was done"'s six rows render one.
    expect(tableCount).toBe(1);
  });
});

describe("harshaDeSilva.focusPosition matches the precedence rule", () => {
  it("is the role type with the lowest precedenceFor() among his real positions", async () => {
    const { precedenceFor } = await import("../data/roles.ts");
    const view = getPersonBySlug("harsha-de-silva");
    const byType = new Map();
    for (const position of view.positions) {
      if (!byType.has(position.roleType)) byType.set(position.roleType, []);
      byType.get(position.roleType).push(position);
    }
    let winner = null;
    for (const [roleType, positions] of byType) {
      const precedence = precedenceFor(roleType);
      if (!winner || precedence < winner.precedence) winner = { roleType, precedence, positions };
    }
    expect(HARSHA_DE_SILVA.focusPosition.roleType).toBe(winner.roleType);

    // Every real position of the winning role type is declared, and nothing
    // extra is — this is what "back-to-back appointments count as one
    // continuous term" means in practice: both spells, not a hand-merged one.
    const declared = HARSHA_DE_SILVA.focusPosition.appointments;
    expect(declared.length).toBe(winner.positions.length);
    for (const position of winner.positions) {
      const match = declared.find(a => a.title === position.title && a.start.date === position.startDate);
      expect(match, `no declared appointment matches "${position.title}" (${position.startDate})`).toBeTruthy();
      expect(match.end?.date).toBe(position.endDate ?? undefined);
    }
  });
});
