import { describe, it, expect } from "vitest";
import { portraitSrc } from "./portrait.ts";

/**
 * Regression tests for portrait URL resolution.
 *
 * The bug these pin: the resolver prepended "/" unconditionally, turning
 * every official portrait into "/https://www.parliament.lk/..." — a 404 that
 * silently fell back to the monogram. No portrait had ever rendered, and the
 * failure was invisible because the fallback looked deliberate.
 */
describe("portraitSrc", () => {
  it("leaves an absolute https URL untouched", () => {
    const url = "https://www.parliament.lk/uploads/images/members/profile_images/thumbs/3449.jpg";
    expect(portraitSrc(url)).toBe(url);
  });

  it("leaves an absolute http URL untouched", () => {
    expect(portraitSrc("http://example.gov.lk/p.jpg")).toBe("http://example.gov.lk/p.jpg");
  });

  it("leaves a protocol-relative URL untouched", () => {
    expect(portraitSrc("//cdn.gov.lk/p.jpg")).toBe("//cdn.gov.lk/p.jpg");
  });

  it("leaves a root-relative path untouched", () => {
    expect(portraitSrc("/assets/portraits/x.jpg")).toBe("/assets/portraits/x.jpg");
  });

  it("makes a bare relative path root-relative", () => {
    // The one case the original code was written for.
    expect(portraitSrc("assets/portraits/x.jpg")).toBe("/assets/portraits/x.jpg");
  });

  it("returns null when there is no portrait, so the monogram shows", () => {
    expect(portraitSrc(null)).toBeNull();
    expect(portraitSrc(undefined)).toBeNull();
    expect(portraitSrc("")).toBeNull();
  });

  it("never produces the doubled-scheme path that caused the bug", () => {
    const url = "https://www.parliament.lk/uploads/images/members/profile_images/thumbs/3560.jpg";
    expect(portraitSrc(url)).not.toMatch(/^\/https?:/);
  });
});
