import { describe, it, expect } from "vitest";
import { detectChange, isDuplicateImport, detectFieldConflict } from "./pipeline.ts";
import type { SourceSnapshot } from "../types/models.ts";

const snapshot = (over: Partial<SourceSnapshot> = {}): SourceSnapshot => ({
  id: "SNAP-1",
  sourceId: "S001",
  retrievedAt: "2026-01-01T00:00:00.000Z",
  url: "https://www.parliament.lk/members",
  contentHash: "hash-a",
  storageReference: "blob://snap-1",
  parserVersion: "v1",
  ...over,
});

describe("detectChange", () => {
  it("treats the first fetch of a source as a change", () => {
    expect(detectChange(null, { contentHash: "hash-a" })).toEqual({
      changed: true,
      reason: "first-fetch",
    });
  });

  it("reports UNCHANGED when the content hash is identical to the last snapshot", () => {
    const previous = snapshot({ contentHash: "hash-a" });
    expect(detectChange(previous, { contentHash: "hash-a" })).toEqual({
      changed: false,
      reason: "unchanged",
    });
  });

  it("reports a change when the content hash differs", () => {
    const previous = snapshot({ contentHash: "hash-a" });
    expect(detectChange(previous, { contentHash: "hash-b" })).toEqual({
      changed: true,
      reason: "content-changed",
    });
  });
});

describe("isDuplicateImport", () => {
  it("prevents re-importing the same content from the same source", () => {
    const imported = [snapshot({ sourceId: "S001", contentHash: "hash-a" })];
    expect(isDuplicateImport(imported, { sourceId: "S001", contentHash: "hash-a" })).toBe(true);
  });

  it("does not flag new content from the same source as a duplicate", () => {
    const imported = [snapshot({ sourceId: "S001", contentHash: "hash-a" })];
    expect(isDuplicateImport(imported, { sourceId: "S001", contentHash: "hash-b" })).toBe(false);
  });

  it("does not flag the same content hash from a DIFFERENT source as a duplicate", () => {
    // Coincidentally identical bytes from two different institutions are not
    // the same import.
    const imported = [snapshot({ sourceId: "S001", contentHash: "hash-a" })];
    expect(isDuplicateImport(imported, { sourceId: "S002", contentHash: "hash-a" })).toBe(false);
  });

  it("treats an empty import history as having no duplicates", () => {
    expect(isDuplicateImport([], { sourceId: "S001", contentHash: "hash-a" })).toBe(false);
  });
});

describe("detectFieldConflict", () => {
  it("is not a conflict when only one source has reported a value", () => {
    expect(detectFieldConflict([{ value: "Minister of Finance", sourceId: "S003" }])).toBe(false);
  });

  it("is not a conflict when every source agrees", () => {
    expect(
      detectFieldConflict([
        { value: "Minister of Finance", sourceId: "S003" },
        { value: "Minister of Finance", sourceId: "S005" },
      ]),
    ).toBe(false);
  });

  it("IS a conflict when sources disagree", () => {
    expect(
      detectFieldConflict([
        { value: "Minister of Finance", sourceId: "S003" },
        { value: "Minister of Trade", sourceId: "S005" },
      ]),
    ).toBe(true);
  });

  it("compares structurally, not by reference, for object values", () => {
    expect(
      detectFieldConflict([
        { value: { year: 1968 }, sourceId: "S001" },
        { value: { year: 1968 }, sourceId: "S002" },
      ]),
    ).toBe(false);
  });
});
