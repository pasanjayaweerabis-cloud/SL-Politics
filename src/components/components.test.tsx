import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { Avatar, Drawer, StatusTag, VerifiedBadge, FilterSidebar, ActiveFilters } from "./Primitives.jsx";
import { Tabs } from "./Tabs.jsx";

/**
 * Javora — component-level coverage, within an honest limit.
 *
 * The README records "no component-level UI tests" as a known gap, mitigated by
 * extracting interaction logic into pure functions (lib/typeahead.ts,
 * lib/profileTabs.ts) and testing it there. This file closes the part of that
 * gap which can be closed WITHOUT adding a DOM environment.
 *
 * WHAT IS NOT TESTED HERE, AND WHY. `renderToString` produces markup; it does
 * not run effects, dispatch events, or move focus. So three behaviours the
 * audit named remain verified by hand only:
 *
 *   - Drawer's focus trap and Escape handling. Both live in a useEffect that
 *     reads document.activeElement and binds a keydown listener, so there is
 *     nothing to assert without a document.
 *   - Tabs' ArrowLeft/ArrowRight/Home/End focus movement. The handler calls
 *     ref.focus() on sibling buttons.
 *   - Avatar's onError fallback, which needs a real image load to fail.
 *
 * Testing those means adding jsdom or happy-dom. That is deliberately not done:
 * this project's dependency list is a documented position, and the audit is
 * explicit that a heavy testing framework should not be introduced for this.
 * What IS asserted below is the rendered contract each component publishes -
 * the ARIA wiring, the roving tabindex, and the portrait/monogram branch - all
 * of which are real regressions if they change and none of which needs a DOM.
 */

const html = (element: React.ReactElement) => renderToString(element);

const NAME = "Anura Kumara Dissanayake";
const PORTRAIT_URL = "https://www.parliament.lk/p.jpg";

describe("Avatar falls back to a monogram", () => {
  it("renders initials, not an image, when no portrait is recorded", () => {
    const out = html(<Avatar name={NAME} portraitUrl={null} />);
    expect(out).toContain("avatar__initials");
    expect(out).not.toContain("<img");
  });

  it("labels the empty state so it is not mistaken for a loading image", () => {
    const out = html(<Avatar name={NAME} portraitUrl={null} />);
    expect(out).toContain("No portrait on record");
  });

  it("hides the monogram from assistive tech", () => {
    // It is a visual stand-in for a portrait, not content. The accessible name
    // comes from the container's aria-label when the avatar is not decorative.
    expect(html(<Avatar name={NAME} portraitUrl={null} />)).toContain('aria-hidden="true"');
  });

  it("renders an image when a portrait IS recorded", () => {
    const out = html(<Avatar name={NAME} portraitUrl={PORTRAIT_URL} />);
    expect(out).toContain("<img");
    expect(out).toContain(PORTRAIT_URL);
  });

  it("does not prefix an absolute portrait URL with a slash", () => {
    // The bug portraitSrc exists to prevent: prepending "/" unconditionally
    // turned every official portrait into "/https://..." - a 404 that fell
    // back to the monogram and looked like a design choice.
    const out = html(<Avatar name={NAME} portraitUrl={PORTRAIT_URL} />);
    expect(out).not.toContain('src="/https://');
  });

  it("does not tell the publishing institution which profile is being viewed", () => {
    const out = html(<Avatar name={NAME} portraitUrl={PORTRAIT_URL} />);
    // React serialises this attribute camelCased, unlike tabIndex.
    expect(out).toContain('referrerPolicy="no-referrer"');
  });

  it("is presentational by default and labelled when asked to be", () => {
    expect(html(<Avatar name={NAME} portraitUrl={null} />)).toContain('role="presentation"');
    const labelled = html(<Avatar name={NAME} portraitUrl={null} decorative={false} />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain("Portrait of Anura Kumara Dissanayake");
  });
});

describe("Tabs publishes a correct ARIA tablist", () => {
  const TABS = [
    { id: "education", label: "Education & Career" },
    { id: "political", label: "Political Career" },
  ];
  const render = (active: string) =>
    html(<Tabs tabs={TABS} active={active} onChange={() => {}} label="Profile sections" />);

  it("is a tablist with an accessible name", () => {
    const out = render("education");
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Profile sections"');
  });

  it("renders every tab, not only the active one", () => {
    const out = render("education");
    expect(out).toContain("Education &amp; Career");
    expect(out).toContain("Political Career");
    expect((out.match(/role="tab"/g) ?? []).length).toBe(2);
  });

  it("marks exactly one tab selected", () => {
    const out = render("political");
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((out.match(/aria-selected="false"/g) ?? []).length).toBe(1);
  });

  it("uses a roving tabindex so Tab reaches the tablist once", () => {
    // Only the active tab is in the tab order; the rest are reached with the
    // arrow keys. Two tabIndex=0 buttons would make Tab walk every tab.
    const out = render("education");
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="-1"/g) ?? []).length).toBe(1);
  });

  it("points each tab at the panel it controls", () => {
    const out = render("education");
    expect(out).toContain('id="javora-tab-education"');
    expect(out).toContain('aria-controls="javora-tab-panel-education"');
    expect(out).toContain('aria-controls="javora-tab-panel-political"');
  });
});

describe("Drawer", () => {
  it("renders nothing at all when closed", () => {
    expect(html(<Drawer open={false} onClose={() => {}} id="d" label="Filters">
      <p>filter content</p>
    </Drawer>)).toBe("");
  });

  it("renders its children and a modal dialog when open", () => {
    const out = html(<Drawer open onClose={() => {}} id="filters-drawer" label="Filters">
      <p>filter content</p>
    </Drawer>);
    expect(out).toContain("filter content");
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('aria-label="Filters"');
  });

  it("makes the panel programmatically focusable for the focus trap", () => {
    // The effect focuses the first focusable child, or the panel itself when
    // there is none. That fallback only works if the panel can hold focus.
    const out = html(<Drawer open onClose={() => {}} id="d" label="Filters">
      <p>no focusable children</p>
    </Drawer>);
    expect(out).toContain('tabindex="-1"');
  });
});

/**
 * The status vocabulary.
 *
 * A political register's first question is "is this person in this job now?".
 * It used to be answered by a `Chip` reading "Currently serving" sitting in a
 * row of identical chips for party, district and role type. These pin the two
 * properties that make the replacement worth having: each state has its own
 * WORDS (so the distinction survives for anyone who cannot see the colour),
 * and the four states stay four — "historical" and "status not recorded" are
 * different claims from "no longer serving" and must not collapse into it.
 */
describe("StatusTag", () => {
  const label = (status: string) => html(<StatusTag status={status} />);

  it("gives each state its own wording, not just its own colour", () => {
    const words = ["current", "former", "historical", "unknown"].map(label);
    const texts = words.map((out) => out.replace(/<[^>]+>/g, "").trim());
    expect(new Set(texts).size).toBe(4);
    for (const text of texts) expect(text.length).toBeGreaterThan(0);
  });

  it("never renders the current and former states with the same class", () => {
    expect(label("current")).toContain("status-tag--current");
    expect(label("former")).toContain("status-tag--former");
  });

  it("falls back to the explicit unknown state rather than inventing one", () => {
    // An unrecognised status must read as "not recorded", never as "former":
    // the second is a claim about the person, the first about the record.
    const out = html(<StatusTag status={"something-else"} />);
    expect(out).toContain("status-tag--unknown");
  });
});

describe("VerifiedBadge", () => {
  it("keeps its label in compact form — the icon alone carried the claim", () => {
    // The regression: `compact` used to drop the word, leaving a bare glyph
    // in the corner of every directory card as the only statement of where
    // the record came from, with no hover on touch to explain it.
    const out = html(<VerifiedBadge state="source-linked" compact />);
    expect(out).toContain("Source-linked");
    expect(out).toContain("badge--compact");
  });
});

/**
 * The directory's filter panel. `renderToString` cannot click "Show all", so
 * what is asserted is the contract that matters at first paint: the reader is
 * not handed thirty parties at once, the ones they DO get are the populated
 * ones, and a filter that is already applied is always visible — a checkbox
 * that is on but hidden is the one state this pattern must never produce.
 */
describe("FilterSidebar progressive disclosure", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `party-${i}`,
    name: `Party ${i}`,
    count: 12 - i,
  }));
  const options = {
    parties: many,
    districts: [],
    roles: [],
    statuses: [{ id: "serving", name: "Currently serving", count: 5 }],
    verification: [{ id: "source-linked", name: "Source-linked", count: 5 }],
  };
  const facets = { parties: [], districts: [], roles: [], statuses: [], verification: [] };

  it("shows only the first few options of a long group", () => {
    const out = html(<FilterSidebar facets={facets} options={options} onToggle={() => {}} onReset={() => {}} />);
    expect(out).toContain("Party 0");
    expect(out).toContain("Party 5");
    expect(out).not.toContain("Party 11");
    expect(out).toContain("Show all 12");
  });

  it("keeps a selected option visible however far down the list it ranks", () => {
    const selected = { ...facets, parties: ["party-11"] };
    const out = html(<FilterSidebar facets={selected} options={options} onToggle={() => {}} onReset={() => {}} />);
    expect(out).toContain("Party 11");
  });

  it("puts the record-state group behind one disclosure, without removing it", () => {
    const out = html(<FilterSidebar facets={facets} options={options} onToggle={() => {}} onReset={() => {}} />);
    expect(out).toContain("More filters");
    expect(out).toContain("Source-linked");
  });
});

describe("ActiveFilters", () => {
  it("names the dimension as well as the value", () => {
    // "Colombo" is a district; "President" is both a role type and an office.
    // A bare value does not tell a reader which control produced it.
    const facets = { parties: ["p1"], districts: [], roles: [], statuses: [], verification: [] };
    const options = {
      parties: [{ id: "p1", name: "Jathika Jana balawegaya", count: 162 }],
      districts: [], roles: [], statuses: [], verification: [],
    };
    const out = html(<ActiveFilters facets={facets} options={options} onToggle={() => {}} onReset={() => {}} />);
    expect(out).toContain("Political Party");
    expect(out).toContain("Jathika Jana balawegaya");
  });
});
