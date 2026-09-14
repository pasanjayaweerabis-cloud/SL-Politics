import { describe, it, expect, vi } from "vitest";
import { decodeEntities, stripTags, clean, sleep } from "./html.ts";

/**
 * Javora — locking in the consolidated scraping primitives.
 *
 * Four independent, byte-identical copies of decodeEntities/stripTags/clean/
 * sleep existed with no test at all. This pins the behaviour they must keep,
 * plus the one deliberate union documented in html.ts: decodeEntities uses
 * String.fromCodePoint, a strict superset of the String.fromCharCode three of
 * the four copies used, verified to agree on every BMP codepoint and to only
 * differ where fromCharCode was already producing wrong output.
 */

describe("decodeEntities", () => {
  it("decodes the six named entities these sources use", () => {
    expect(decodeEntities("A &amp; B")).toBe("A & B");
    expect(decodeEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeEntities("&#39;s")).toBe("'s");
    expect(decodeEntities("&apos;s")).toBe("'s");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("decodes decimal numeric references", () => {
    expect(decodeEntities("&#233;clair")).toBe("éclair");
  });

  it("decodes a decimal reference outside the BMP correctly", () => {
    // The case fromCharCode gets wrong. Not realistic for these sources'
    // Sinhala/Tamil/Latin text, but proves the union is genuinely a superset.
    expect(decodeEntities("&#128512;")).toBe("\u{1F600}");
  });

  it("leaves plain text untouched", () => {
    expect(decodeEntities("Anura Kumara Dissanayake")).toBe("Anura Kumara Dissanayake");
  });
});

describe("stripTags", () => {
  it("removes tags and decodes entities", () => {
    expect(stripTags("<b>A &amp; B</b>")).toBe("A & B");
  });

  it("collapses the source's generous whitespace", () => {
    expect(stripTags("<p>  a  \n\n  b  </p>")).toBe("a b");
  });

  it("trims the result", () => {
    expect(stripTags("  <p>text</p>  ")).toBe("text");
  });
});

describe("clean", () => {
  it("passes real text through unchanged", () => {
    expect(clean("Colombo")).toBe("Colombo");
  });

  it("trims surrounding whitespace", () => {
    expect(clean("  Colombo  ")).toBe("Colombo");
  });

  it('treats the source\'s "---" placeholder as no value', () => {
    expect(clean("---")).toBeNull();
    expect(clean("-")).toBeNull();
  });

  it("treats empty and nullish input as no value", () => {
    expect(clean("")).toBeNull();
    expect(clean(null)).toBeNull();
    expect(clean(undefined)).toBeNull();
  });
});

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    sleep(1000).then(spy);
    await vi.advanceTimersByTimeAsync(999);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
