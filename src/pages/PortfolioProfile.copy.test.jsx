import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildCitation, copyPlainText, copyWithFeedback } from "./PortfolioProfile.jsx";
import { toast, getSnapshot } from "../components/Toast.jsx";

/**
 * Javora — "Copy link" / "Copy citation" (PortfolioProfile.jsx), tested at
 * the pure-function layer rather than by rendering the page and clicking a
 * button: this project runs vitest under plain Node with no jsdom (see
 * CLAUDE.md's "Current gaps"), so there is no real DOM to dispatch a click
 * into. `buildCitation` and `copyWithFeedback` are exported from
 * PortfolioProfile.jsx specifically so this logic is reachable without one.
 */

describe("buildCitation", () => {
  it("never invents a field the source entry doesn't have", () => {
    // s4-shaped: organization, date, type — no title, no href (real shape in
    // harshaDeSilva.ts's sources array).
    const citation = buildCitation({
      id: "s4",
      organization: "Sunday Times (Business Times)",
      date: "18 May 2019",
      type: "News report",
      href: null,
    });
    expect(citation).toBe("Sunday Times (Business Times). 18 May 2019. News report.");
    expect(citation).not.toMatch(/https?:\/\//);
    expect(citation).not.toMatch(/undefined|null/i);
  });

  it("includes title and href when the source entry has them", () => {
    const citation = buildCitation({
      id: "s1",
      organization: "Parliament of Sri Lanka",
      title: "MP Profile",
      type: "Official institutional source",
      href: "https://www.parliament.lk/en/members-of-parliament/mp-profile/3201",
    });
    expect(citation).toBe(
      "Parliament of Sri Lanka. MP Profile. Official institutional source. https://www.parliament.lk/en/members-of-parliament/mp-profile/3201",
    );
  });

  it("omits a missing title rather than rendering a placeholder for it", () => {
    const citation = buildCitation({
      id: "s3",
      organization: "Department of Census & Statistics",
      title: "Performance Report 2019",
      type: "Government report",
      href: "https://example.gov/report.pdf",
    });
    // No blank/placeholder segment where an absent field would have gone —
    // every '. '-joined part is a real value.
    expect(citation.split(". ").every((part) => part.trim().length > 0)).toBe(true);
  });

  it("never adds an accessed-on or publication date the entry doesn't carry", () => {
    const citation = buildCitation({
      id: "sX",
      organization: "Example Institution",
      type: "Government report",
    });
    expect(citation).toBe("Example Institution. Government report.");
    expect(citation.toLowerCase()).not.toContain("accessed");
  });
});

describe("copyPlainText", () => {
  // Node ships its own read-only `navigator` global (Node 21+), so a plain
  // `globalThis.navigator = ...` throws — `vi.stubGlobal` replaces it for
  // the duration of the test regardless, and `vi.unstubAllGlobals` restores
  // the original afterwards.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects when navigator.clipboard is unavailable (non-secure origin)", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyPlainText("https://javora.lk/person/harsha-de-silva#hds-votes")).rejects.toThrow();
  });

  it("rejects when navigator.clipboard.writeText itself rejects (permission denied)", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    await expect(copyPlainText("some text")).rejects.toThrow("denied");
  });

  it("resolves when navigator.clipboard.writeText succeeds", async () => {
    let written = null;
    vi.stubGlobal("navigator", { clipboard: { writeText: (text) => { written = text; return Promise.resolve(); } } });
    await copyPlainText("hello");
    expect(written).toBe("hello");
  });
});

describe("copyWithFeedback", () => {
  beforeEach(() => {
    toast.dismiss();
  });

  it("on success, shows the success toast and never the failure one", async () => {
    await copyWithFeedback("https://javora.lk/person/harsha-de-silva#hds-votes", {
      toastId: "copy-link-hds-votes",
      successMessage: "Link copied",
      failureMessage: "Could not copy",
      copy: () => Promise.resolve(),
    });
    const list = getSnapshot();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ message: "Link copied", variant: "success" });
  });

  it("on failure, shows an error toast and NEVER claims success", async () => {
    const text = "https://javora.lk/person/harsha-de-silva#hds-votes";
    await copyWithFeedback(text, {
      toastId: "copy-link-hds-votes",
      successMessage: "Link copied",
      failureMessage: "Could not copy — select the text below and copy it manually",
      copy: () => Promise.reject(new Error("Clipboard API unavailable")),
    });
    const list = getSnapshot();
    expect(list).toHaveLength(1);
    expect(list[0].variant).toBe("error");
    expect(list[0].message).not.toBe("Link copied");
    // The manual-copy fallback: the actual text is carried on the toast so a
    // reader can select and copy it by hand.
    expect(list[0].description).toBe(text);
  });

  it("repeated failures on the same button update one toast, never piling up", async () => {
    const failing = () => Promise.reject(new Error("denied"));
    for (let i = 0; i < 3; i++) {
      await copyWithFeedback("citation text", {
        toastId: "copy-citation-s1",
        successMessage: "Citation copied",
        failureMessage: "Could not copy",
        copy: failing,
      });
    }
    expect(getSnapshot()).toHaveLength(1);
  });
});
