/**
 * Javora — slug -> hand-built "portfolio" profile content.
 *
 * A small number of profiles carry a hand-built layout (PortfolioProfile.jsx)
 * instead of the site's default tabbed one. This is the ONLY place that
 * mapping is made: PersonPage.jsx asks `getProfileContent(slug)` before
 * falling back to its own tabbed layout, so adding a profile here is the only
 * thing a slug needs to change which layout it renders. Every slug not
 * listed here is completely unaffected.
 *
 * To add another person: write a `PortfolioProfileContent`-shaped object in
 * its own file (see harshaDeSilva.ts for the shape) and add an entry below,
 * keyed by that person's real, published slug.
 */

import {
  HARSHA_DE_SILVA,
  type ProgrammeRow,
  type SourceEntry,
  type OutcomeIndicatorRow,
  type VotingRecordRow,
  type PromiseCard,
  type ProgrammeInterventionRow,
  type PolicyPositionRow,
  type CareerFact,
  type PositionRecord,
  type AttributionLevel,
  type ResearchNote,
} from "./harshaDeSilva.ts";

export interface PortfolioProfileContent {
  name: string;
  portraitUrl: string;
  hero: {
    eyebrow: string;
    focusRole: string;
    tenure: string;
    focusNote: string;
    focusExplainer: string;
  };
  portfolioAreas: string[];
  /** Degrees only — omit the field entirely for a profile with none verified,
      rather than rendering an empty "Education" glance item. */
  education?: string[];
  responsibilities: {
    roleSummary: string;
    institutions: string[];
    scope: string;
    authorityNote: string;
  };
  programmesIntro: string;
  evidenceNote: {
    term: string;
    body: string;
  };
  programmes: ProgrammeRow[];
  outcomeIndicators: {
    intro: string;
    rows: OutcomeIndicatorRow[];
  };
  votingRecord: {
    intro: string;
    scopeNote: string;
    rows: VotingRecordRow[];
  };
  promises: {
    intro: string;
    cards: PromiseCard[];
  };
  detailedAnalysis: {
    programmeInterventions: {
      intro: string;
      rows: ProgrammeInterventionRow[];
    };
    policyPositions: {
      intro: string;
      rows: PolicyPositionRow[];
    };
    careerDetail: {
      intro: string;
      summaryHeading: string;
      summaryNote: string;
      facts: CareerFact[];
      positionsHeading: string;
      positions: PositionRecord[];
      documentedResponsibilities: {
        body: string;
        note: string;
      };
      institutionsReferenced: string[];
    };
    responsibilityAttribution: {
      intro: string;
      levels: AttributionLevel[];
    };
    researchNotes: {
      intro: string;
      notes: ResearchNote[];
    };
  };
  sources: SourceEntry[];
  recordStatus: {
    label: string;
  };
}

const PROFILE_CONTENT: Record<string, PortfolioProfileContent> = {
  "harsha-de-silva": HARSHA_DE_SILVA,
};

export function getProfileContent(slug: string): PortfolioProfileContent | undefined {
  return PROFILE_CONTENT[slug];
}
