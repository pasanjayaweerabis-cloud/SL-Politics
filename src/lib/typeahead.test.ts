import { describe, it, expect } from "vitest";
import { moveActiveIndex, resolveKeyAction, shouldAutoJump, didYouMean } from "./typeahead.ts";

describe("moveActiveIndex", () => {
  it("moves forward and backward within bounds", () => {
    expect(moveActiveIndex(1, 1, 5)).toBe(2);
    expect(moveActiveIndex(1, -1, 5)).toBe(0);
  });

  it("wraps from the last item to the first, and back", () => {
    expect(moveActiveIndex(4, 1, 5)).toBe(0);
    expect(moveActiveIndex(0, -1, 5)).toBe(4);
  });

  it("starts at the first item when nothing is highlighted and the user presses down", () => {
    expect(moveActiveIndex(-1, 1, 5)).toBe(0);
  });

  it("starts at the last item when nothing is highlighted and the user presses up", () => {
    expect(moveActiveIndex(-1, -1, 5)).toBe(4);
  });

  it("has nothing to move to in an empty list", () => {
    expect(moveActiveIndex(-1, 1, 0)).toBe(-1);
    expect(moveActiveIndex(0, 1, 0)).toBe(-1);
  });
});

describe("resolveKeyAction", () => {
  const state = (over: Partial<{ open: boolean; activeIndex: number; resultCount: number }> = {}) => ({
    open: true,
    activeIndex: -1,
    resultCount: 3,
    ...over,
  });

  it("moves down and up when there are results", () => {
    expect(resolveKeyAction("ArrowDown", state())).toEqual({ type: "move", direction: 1 });
    expect(resolveKeyAction("ArrowUp", state())).toEqual({ type: "move", direction: -1 });
  });

  it("does nothing on arrow keys when there are no results to move through", () => {
    expect(resolveKeyAction("ArrowDown", state({ resultCount: 0 }))).toEqual({ type: "none" });
  });

  it("selects the highlighted suggestion on Enter", () => {
    expect(resolveKeyAction("Enter", state({ activeIndex: 1 }))).toEqual({ type: "select", index: 1 });
  });

  it("does NOT select on Enter when nothing is highlighted — falls through to submit", () => {
    expect(resolveKeyAction("Enter", state({ activeIndex: -1 }))).toEqual({ type: "none" });
  });

  it("does not select on Enter when the panel is closed, even with a stale index", () => {
    expect(resolveKeyAction("Enter", state({ open: false, activeIndex: 1 }))).toEqual({ type: "none" });
  });

  it("refuses to select an index that has fallen out of range", () => {
    // Guards against a highlighted index surviving a result-set shrink.
    expect(resolveKeyAction("Enter", state({ activeIndex: 5, resultCount: 3 }))).toEqual({ type: "none" });
  });

  it("closes the panel on Escape only when it is open", () => {
    expect(resolveKeyAction("Escape", state({ open: true }))).toEqual({ type: "close" });
    expect(resolveKeyAction("Escape", state({ open: false }))).toEqual({ type: "none" });
  });

  it("ignores keys it doesn't handle", () => {
    expect(resolveKeyAction("a", state())).toEqual({ type: "none" });
    expect(resolveKeyAction("Tab", state())).toEqual({ type: "none" });
  });
});

describe("shouldAutoJump", () => {
  it("jumps on an unambiguous direct name match", () => {
    expect(shouldAutoJump([0])).toBe(true);
    expect(shouldAutoJump([0, 1])).toBe(true);
    expect(shouldAutoJump([0, 3])).toBe(true);
  });

  it("does not jump when the top result isn't a direct name hit", () => {
    expect(shouldAutoJump([1])).toBe(false);
    expect(shouldAutoJump([2, 3])).toBe(false);
    expect(shouldAutoJump([3])).toBe(false);
  });

  it("does not jump when two results are both direct name hits — genuinely ambiguous", () => {
    expect(shouldAutoJump([0, 0])).toBe(false);
  });

  it("does not jump with no results", () => {
    expect(shouldAutoJump([])).toBe(false);
  });
});

describe("didYouMean", () => {
  const names = [
    "Ranil Wickremesinghe",
    "Maithripala Sirisena",
    "Anura Kumara Dissanayaka",
    "Mahinda Rajapaksa",
  ];

  it("suggests a name one token-edit away from a misspelled surname", () => {
    expect(didYouMean("wickramasinghe", names)).toEqual(["Ranil Wickremesinghe"]);
  });

  it("returns nothing for an exact match — nothing to suggest instead of itself", () => {
    expect(didYouMean("wickremesinghe", names)).toEqual([]);
  });

  it("returns nothing for a query too short to suggest safely", () => {
    expect(didYouMean("an", names)).toEqual([]);
  });

  it("returns nothing when no candidate is close", () => {
    expect(didYouMean("xyzabc", names)).toEqual([]);
  });

  it("never returns more than the requested limit", () => {
    const closeNames = ["Kamal Perera", "Kamal Perera Jr", "Kamal Perara", "Kamel Perera"];
    expect(didYouMean("kamel perera", closeNames, 2).length).toBeLessThanOrEqual(2);
  });
});
