import { describe, it, expect } from "vitest";
import {
  tabFromSearch,
  searchForTab,
  nextTabIndex,
  DEFAULT_TAB,
  PROFILE_TABS,
} from "./profileTabs.ts";

describe("profile tabs", () => {
  it("has exactly two tabs — education first", () => {
    // "Do not create additional profile tabs."
    expect(PROFILE_TABS).toEqual(["education", "political"]);
  });

  it("defaults to Education & Career", () => {
    expect(DEFAULT_TAB).toBe("education");
    expect(tabFromSearch("")).toBe("education");
    expect(tabFromSearch(null)).toBe("education");
    expect(tabFromSearch(undefined)).toBe("education");
  });

  it("reads the requested tab from the URL, so a tab can be linked", () => {
    expect(tabFromSearch("?tab=political")).toBe("political");
    expect(tabFromSearch("?tab=education")).toBe("education");
  });

  it("falls back to the default for an unrecognised tab rather than showing nothing", () => {
    expect(tabFromSearch("?tab=nonsense")).toBe("education");
    expect(tabFromSearch("?tab=")).toBe("education");
  });

  it("keeps other query parameters from confusing it", () => {
    expect(tabFromSearch("?q=anura&tab=political&x=1")).toBe("political");
  });
});

describe("searchForTab", () => {
  it("gives the default tab an EMPTY query, keeping the canonical URL clean", () => {
    expect(searchForTab("education")).toBe("");
  });

  it("names the non-default tab", () => {
    expect(searchForTab("political")).toBe("tab=political");
  });

  it("round-trips", () => {
    for (const tab of PROFILE_TABS) {
      expect(tabFromSearch(`?${searchForTab(tab)}`)).toBe(tab);
    }
  });
});

describe("nextTabIndex — arrow-key focus movement", () => {
  it("moves right and left", () => {
    expect(nextTabIndex(0, "ArrowRight", 2)).toBe(1);
    expect(nextTabIndex(1, "ArrowLeft", 2)).toBe(0);
  });

  it("wraps at both ends", () => {
    expect(nextTabIndex(1, "ArrowRight", 2)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 2)).toBe(1);
  });

  it("jumps to first and last", () => {
    expect(nextTabIndex(1, "Home", 2)).toBe(0);
    expect(nextTabIndex(0, "End", 2)).toBe(1);
  });

  it("ignores keys that are not navigation", () => {
    expect(nextTabIndex(0, "a", 2)).toBeNull();
    expect(nextTabIndex(0, "Enter", 2)).toBeNull();
    // Enter/Space ACTIVATE; they are handled separately from focus movement,
    // which is what makes this a manual-activation tab set.
    expect(nextTabIndex(0, " ", 2)).toBeNull();
  });

  it("handles an empty tab set", () => {
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
  });
});
