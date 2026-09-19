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
 * A portfolio page documents ONE office — the person's highest-ranking
 * position, by `precedenceFor(roleType)` in src/data/roles.ts (lowest number
 * wins; a tie breaks on total time held in that role type, then recency). It
 * is not a whole-career page. Everything else about the person — name, the
 * office's full term, "Today", every other office they have held, and every
 * sourcing badge — is derived by PortfolioProfile.jsx from
 * `getPersonBySlug(slug)` at render time, never authored here.
 *
 * To add another person:
 *   1. Find the focus office with `precedenceFor` (src/data/roles.ts) against
 *      their real bundled positions, combining back-to-back appointments to
 *      the same office into one continuous term. Declare it as
 *      `focusPosition` below and add a test asserting it matches the rule's
 *      result — see src/data/harshaDeSilva.focusPosition.test.ts.
 *   2. Write a `PortfolioProfileContent`-shaped object in its own file (see
 *      harshaDeSilva.ts) covering ONLY that office: its appointments,
 *      gazetted duties (or omit the field entirely — never invent one),
 *      institutions a source actually ties to the office, and actions/
 *      decisions that either happened during the term and concern the
 *      office's subjects, or are a later, sourced result of something the
 *      term started (see PortfolioProfile.jsx's inclusion rule).
 *   3. Every citeIds entry needs a real citation. An id that exists in this
 *      file's own `sources` array renders as a linked, numbered source; any
 *      other id renders as plain "Source not yet listed" text and is never a
 *      link.
 *   4. Anything researched but out of scope for this one office goes to
 *      docs/research/<slug>-out-of-scope.md, verbatim, with its citations and
 *      a one-line reason — nothing researched is simply deleted.
 *   5. Add the entry below, keyed by the person's real, published slug.
 */

import {
  HARSHA_DE_SILVA,
  type AttributionKind,
  type ActionStatus,
  type StructuredDate,
  type DateRange,
  type Appointment,
  type FocusPosition,
  type CitedText,
  type Institution,
  type ActionRow,
  type DecisionRow,
  type SourceType,
  type SourceEntry,
} from "./harshaDeSilva.ts";

export type {
  AttributionKind,
  ActionStatus,
  StructuredDate,
  DateRange,
  Appointment,
  FocusPosition,
  CitedText,
  Institution,
  ActionRow,
  DecisionRow,
  SourceType,
  SourceEntry,
};

export interface PortfolioProfileContent {
  slug: string;
  portraitUrl: string;
  /** The office(s) this page documents — see focusPosition.test.ts. */
  focusPosition: FocusPosition;
  portfolioAreas: string[];
  office: {
    /** Omit entirely when no gazetted duty statement for THIS office is on
        record — never fall back to a duty statement gazetted under a
        different office the person held before or after this term. */
    duties?: CitedText;
    /** Only institutions a source ties to this specific office. */
    institutions: Institution[];
  };
  /** What was done under this office during the term, or later as a sourced
      result of something the term started. Empty renders one honest line —
      never an empty table. */
  actions: ActionRow[];
  /** Term-bounded decisions and votes. Empty renders one honest line. */
  decisions: DecisionRow[];
  sources: SourceEntry[];
}

const PROFILE_CONTENT: Record<string, PortfolioProfileContent> = {
  "harsha-de-silva": HARSHA_DE_SILVA,
};

export function getProfileContent(slug: string): PortfolioProfileContent | undefined {
  return PROFILE_CONTENT[slug];
}
