import { describe, it, expect, beforeEach } from "vitest";
import { toast, getSnapshot } from "./Toast.jsx";

/**
 * Javora — the toast store's state machine, tested directly against its
 * exported functions rather than through a rendered `<Toaster/>`: this
 * project runs vitest under plain Node (no jsdom — see CLAUDE.md's "Current
 * gaps" on why that was considered and rejected), so nothing here can
 * dispatch a real click or observe a real DOM node. `toast()`/`getSnapshot()`
 * are plain, DOM-free state, which is exactly what's being guarded: id
 * dedupe, the MAX_VISIBLE cap, and dismiss.
 */

describe("toast store", () => {
  // The store is one module-level singleton (by design — see Toast.jsx's own
  // header comment on why it isn't a context), so every test starts from a
  // clean slate rather than whatever the previous test left behind.
  beforeEach(() => {
    toast.dismiss();
  });

  it("shows a fresh toast", () => {
    toast("Link copied");
    expect(getSnapshot().map((entry) => entry.message)).toEqual(["Link copied"]);
  });

  it("a repeated stable id updates the existing toast instead of adding a new one", () => {
    toast("Copying…", { id: "copy-link-hds-votes" });
    toast("Link copied", { id: "copy-link-hds-votes" });

    const list = getSnapshot();
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe("Link copied");
  });

  it("clicking the same button 5x quickly still leaves exactly one toast", () => {
    for (let i = 0; i < 5; i++) toast("Link copied", { id: "copy-link-hds-votes" });
    expect(getSnapshot()).toHaveLength(1);
  });

  it("caps the visible list at 3, dropping the oldest first", () => {
    toast("a");
    toast("b");
    toast("c");
    toast("d");

    const list = getSnapshot();
    expect(list).toHaveLength(3);
    // Newest first.
    expect(list.map((entry) => entry.message)).toEqual(["d", "c", "b"]);
  });

  it("dismiss(id) removes exactly that toast, leaving the others", () => {
    toast("a", { id: "a" });
    toast("b", { id: "b" });
    toast.dismiss("a");
    expect(getSnapshot().map((entry) => entry.id)).toEqual(["b"]);
  });

  it("dismiss() with no id clears every toast", () => {
    toast("a");
    toast("b");
    toast.dismiss();
    expect(getSnapshot()).toEqual([]);
  });

  it("toast.success and toast.error tag the entry with a variant", () => {
    toast.success("ok", { id: "s" });
    toast.error("bad", { id: "e" });
    const list = getSnapshot();
    expect(list.find((entry) => entry.id === "s").variant).toBe("success");
    expect(list.find((entry) => entry.id === "e").variant).toBe("error");
  });

  it("an unmatched id is a plain default-variant toast", () => {
    toast("plain", { id: "p" });
    expect(getSnapshot().find((entry) => entry.id === "p").variant).toBe("default");
  });
});
