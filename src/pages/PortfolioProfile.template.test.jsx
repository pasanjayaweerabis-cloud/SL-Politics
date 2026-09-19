import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import PortfolioProfile from "./PortfolioProfile.jsx";
import { RoleType } from "../types/models.ts";

/**
 * Javora — proves PortfolioProfile.jsx is a real template, not a
 * Harsha-de-Silva-shaped component with the data swapped out.
 *
 * `a-h-m-h-abayarathna` is a real, currently-serving Cabinet Minister in the
 * bundle (Minister of Public Administration, Provincial Councils and Local
 * Government, appointed 2024-11-18, ongoing) — chosen because his focus
 * office is still open, exercising the `ongoing` path Harsha de Silva's own
 * content never touches. This fixture is intentionally NOT registered in
 * src/data/profileContent.ts and reaches no route: it exists only so this
 * test can render the component with content that has no researched
 * material at all and confirm nothing breaks and no table renders empty.
 */
const EMPTY_CONTENT = {
  slug: "a-h-m-h-abayarathna",
  portraitUrl: "/portraits/a-h-m-h-abayarathna.png",
  focusPosition: {
    roleType: RoleType.CABINET_MINISTER,
    appointments: [
      {
        title: "Minister of Public Administration, Provincial Councils and Local Government",
        start: { date: "2024-11-18" },
        ongoing: true,
      },
    ],
  },
  portfolioAreas: [],
  office: { institutions: [] },
  actions: [],
  decisions: [],
  sources: [],
};

describe("PortfolioProfile renders cleanly with no researched content", () => {
  const html = () => renderToString(<PortfolioProfile content={EMPTY_CONTENT} />);

  it("renders without throwing", () => {
    expect(() => html()).not.toThrow();
  });

  it("never renders an empty <table>", () => {
    const out = html();
    expect(out).not.toMatch(/<table\b/);
  });

  it("shows an honest empty line for The office, What was done and Decisions & votes", () => {
    const out = html();
    expect(out).toContain("No gazetted duty statement for this office is on record here.");
    expect(out).toContain("No institution is tied to this office by a source on record here.");
    expect(out).toContain("No action tied to this office during its term has been located.");
    expect(out).toContain("No recorded votes or decisions on this office’s subjects during the term have been located.");
  });

  it("does not render Sources or the labels explanation when the content has nothing to show", () => {
    const out = html();
    expect(out).not.toContain('id="hds-sources"');
    expect(out).not.toContain('id="hds-labels"');
  });

  it("still renders Other offices held from the canonical record — it doesn't depend on `content` at all", () => {
    // Unlike Sources/labels, this section is derived entirely from
    // getPersonBySlug(content.slug), so it renders his real MP seat even
    // though the hand-authored content object above has nothing in it.
    const out = html();
    expect(out).toContain('id="hds-other-offices"');
    expect(out).toContain("Member of Parliament");
  });

  it("still derives name and term from the canonical record", () => {
    const out = html();
    expect(out).toContain("A.H.M.H. Abayarathna");
    expect(out).toContain("Minister of Public Administration, Provincial Councils and Local Government");
    expect(out).toContain("Present");
  });
});
