import { describe, it, expect } from "vitest";
import { liftPreloads, PRELOAD } from "./preloads.mjs";

/**
 * Javora — preloads must leave the body.
 *
 * React 19 emits `<link rel="preload">` inline in the body where
 * `renderToString` first meets an image, but hoists the same links into <head>
 * on the client. Left in the body they are extra nodes the client render does
 * not produce, hydration fails with React #418, and React discards the whole
 * prerendered tree and re-renders from scratch — losing the entire benefit of
 * prerendering while still looking perfectly correct in a browser.
 *
 * That failure mode is invisible to every other test in this repository: the
 * HTML is present, the page renders, the route exists. Only the hydration path
 * breaks. The audit listed this step as guarded by nothing.
 */

describe("liftPreloads", () => {
  it("removes a preload link from the body", () => {
    const html = '<div><link rel="preload" as="image" href="/a.png"/><p>hi</p></div>';
    const { body } = liftPreloads(html);
    expect(body).not.toContain("rel=\"preload\"");
    expect(body).toContain("<p>hi</p>");
  });

  it("returns the removed link so it can be placed in <head>", () => {
    const html = '<div><link rel="preload" as="image" href="/a.png"/></div>';
    const { preloads } = liftPreloads(html);
    expect(preloads).toContain('href="/a.png"');
  });

  it("lifts every preload, not just the first", () => {
    const html =
      '<div><link rel="preload" as="image" href="/a.png"/>' +
      '<link rel="preload" as="image" href="/b.png"/>x</div>';
    const { body, preloads } = liftPreloads(html);
    expect(body).toBe("<div>x</div>");
    expect(preloads).toContain("/a.png");
    expect(preloads).toContain("/b.png");
  });

  it("leaves body content untouched when there are no preloads", () => {
    const html = "<div><p>nothing to lift</p></div>";
    const { body, preloads } = liftPreloads(html);
    expect(body).toBe(html);
    expect(preloads).toBe("");
  });

  it("does NOT touch stylesheets, modulepreloads or icons", () => {
    // The regex is deliberately narrow. Lifting a stylesheet out of the body
    // would be a different change with different consequences.
    const html =
      '<link rel="stylesheet" href="/a.css"/>' +
      '<link rel="modulepreload" href="/a.js"/>' +
      '<link rel="icon" href="/f.png"/>';
    const { body, preloads } = liftPreloads(html);
    expect(body).toBe(html);
    expect(preloads).toBe("");
  });

  it("handles both self-closing and unclosed link syntax", () => {
    const selfClosing = '<link rel="preload" as="image" href="/a.png"/>';
    const unclosed = '<link rel="preload" as="image" href="/b.png">';
    expect(liftPreloads(selfClosing).body).toBe("");
    expect(liftPreloads(unclosed).body).toBe("");
  });

  it("uses a global regex, so repeated matching does not skip alternate tags", () => {
    // A /g regex carries lastIndex. Reusing it across .match() and .replace()
    // is safe, but a future .test() call on the same object would not be.
    expect(PRELOAD.global).toBe(true);
  });
});
