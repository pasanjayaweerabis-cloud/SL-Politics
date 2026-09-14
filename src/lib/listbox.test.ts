import { describe, it, expect } from "vitest";
import { resolveListboxKeyAction } from "./listbox.ts";

describe("resolveListboxKeyAction", () => {
  const state = (over: Partial<{ open: boolean; activeIndex: number; length: number }> = {}) => ({
    open: false,
    activeIndex: -1,
    length: 3,
    ...over,
  });

  it("opens a closed control on ArrowDown, ArrowUp, Enter or Space", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      expect(resolveListboxKeyAction(key, state({ open: false }))).toEqual({ type: "open" });
    }
  });

  it("ignores other keys while closed", () => {
    expect(resolveListboxKeyAction("a", state({ open: false }))).toEqual({ type: "none" });
    expect(resolveListboxKeyAction("Escape", state({ open: false }))).toEqual({ type: "none" });
  });

  it("moves down and up within bounds while open", () => {
    expect(resolveListboxKeyAction("ArrowDown", state({ open: true, activeIndex: 0 }))).toEqual({ type: "move", index: 1 });
    expect(resolveListboxKeyAction("ArrowUp", state({ open: true, activeIndex: 1 }))).toEqual({ type: "move", index: 0 });
  });

  it("wraps from the last option to the first, and back", () => {
    expect(resolveListboxKeyAction("ArrowDown", state({ open: true, activeIndex: 2 }))).toEqual({ type: "move", index: 0 });
    expect(resolveListboxKeyAction("ArrowUp", state({ open: true, activeIndex: 0 }))).toEqual({ type: "move", index: 2 });
  });

  it("lands on the first option going down, and the last going up, when nothing is highlighted", () => {
    expect(resolveListboxKeyAction("ArrowDown", state({ open: true, activeIndex: -1 }))).toEqual({ type: "move", index: 0 });
    expect(resolveListboxKeyAction("ArrowUp", state({ open: true, activeIndex: -1 }))).toEqual({ type: "move", index: 2 });
  });

  it("has nothing to move to in an empty list", () => {
    expect(resolveListboxKeyAction("ArrowDown", state({ open: true, length: 0 }))).toEqual({ type: "none" });
  });

  it("jumps to the first and last option on Home and End", () => {
    expect(resolveListboxKeyAction("Home", state({ open: true, activeIndex: 1 }))).toEqual({ type: "move", index: 0 });
    expect(resolveListboxKeyAction("End", state({ open: true, activeIndex: 1 }))).toEqual({ type: "move", index: 2 });
  });

  it("does nothing on Home/End in an empty list", () => {
    expect(resolveListboxKeyAction("Home", state({ open: true, length: 0 }))).toEqual({ type: "none" });
    expect(resolveListboxKeyAction("End", state({ open: true, length: 0 }))).toEqual({ type: "none" });
  });

  it("selects the highlighted option on Enter or Space", () => {
    expect(resolveListboxKeyAction("Enter", state({ open: true, activeIndex: 1 }))).toEqual({ type: "select", index: 1 });
    expect(resolveListboxKeyAction(" ", state({ open: true, activeIndex: 2 }))).toEqual({ type: "select", index: 2 });
  });

  it("closes without selecting on Enter/Space when nothing is highlighted", () => {
    expect(resolveListboxKeyAction("Enter", state({ open: true, activeIndex: -1 }))).toEqual({ type: "close", keepFocus: true });
  });

  it("refuses to select an index that has fallen out of range", () => {
    expect(resolveListboxKeyAction("Enter", state({ open: true, activeIndex: 5, length: 3 }))).toEqual({ type: "close", keepFocus: true });
  });

  it("closes and keeps focus on Escape", () => {
    expect(resolveListboxKeyAction("Escape", state({ open: true }))).toEqual({ type: "close", keepFocus: true });
  });

  it("closes without claiming the keystroke on Tab", () => {
    expect(resolveListboxKeyAction("Tab", state({ open: true }))).toEqual({ type: "close", keepFocus: false });
  });

  it("ignores keys it doesn't handle while open", () => {
    expect(resolveListboxKeyAction("a", state({ open: true }))).toEqual({ type: "none" });
  });
});
