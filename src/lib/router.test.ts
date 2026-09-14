import { describe, it, expect } from "vitest";
import { matchRoute, legacyRedirect } from "./router.tsx";

describe("matchRoute", () => {
  it("matches the homepage", () => {
    expect(matchRoute("/").name).toBe("home");
    expect(matchRoute("").name).toBe("home");
  });

  it("matches static routes", () => {
    expect(matchRoute("/directory").name).toBe("directory");
    expect(matchRoute("/corrections").name).toBe("corrections");
  });

  it("captures a person slug", () => {
    const route = matchRoute("/person/anura-kumara-dissanayake");
    expect(route.name).toBe("person");
    expect(route.params.slug).toBe("anura-kumara-dissanayake");
  });

  it("keeps the route table to the core Home / Directory / Person / Corrections loop", () => {
    // Javora deliberately does not have standalone Parties, Elections or
    // Sources pages — that information lives inside the directory filters and
    // each person's profile instead.
    expect(matchRoute("/parties").name).toBe("not-found");
    expect(matchRoute("/elections").name).toBe("not-found");
    expect(matchRoute("/sources").name).toBe("not-found");
    expect(matchRoute("/sources/S001").name).toBe("not-found");
  });

  it("decodes percent-encoded parameters", () => {
    expect(matchRoute("/person/a%2Fb").params.slug).toBe("a/b");
  });

  it("tolerates trailing slashes", () => {
    expect(matchRoute("/directory/").name).toBe("directory");
  });

  it("resolves an unknown path to not-found, never to the homepage", () => {
    expect(matchRoute("/nope").name).toBe("not-found");
    expect(matchRoute("/person").name).toBe("not-found");
    expect(matchRoute("/a/b/c/d").name).toBe("not-found");
  });

  it("preserves the query string on the route", () => {
    expect(matchRoute("/directory", "?party=npp").search).toBe("?party=npp");
  });
});

describe("legacyRedirect", () => {
  it("migrates a legacy profile URL to the canonical person URL", () => {
    expect(legacyRedirect("/profile", "?id=sajith-premadasa"))
      .toBe("/person/sajith-premadasa");
  });

  it("sends a profile URL with no id to the directory rather than 404", () => {
    expect(legacyRedirect("/profile", "")).toBe("/directory");
  });

  it("migrates legacy .html paths", () => {
    expect(legacyRedirect("/directory.html", "")).toBe("/directory");
    expect(legacyRedirect("/index.html", "")).toBe("/");
  });

  it("sends the removed Parties/Elections/Sources pages to the directory instead of a dead link", () => {
    expect(legacyRedirect("/parties", "")).toBe("/directory");
    expect(legacyRedirect("/elections", "")).toBe("/directory");
    expect(legacyRedirect("/sources", "")).toBe("/directory");
    expect(legacyRedirect("/sources/S001", "")).toBe("/directory");
    expect(legacyRedirect("/sources.html", "")).toBe("/directory");
  });

  it("leaves canonical URLs alone", () => {
    expect(legacyRedirect("/person/x", "")).toBeNull();
    expect(legacyRedirect("/directory", "?q=a")).toBeNull();
    expect(legacyRedirect("/", "")).toBeNull();
    expect(legacyRedirect("/corrections", "")).toBeNull();
  });
});
