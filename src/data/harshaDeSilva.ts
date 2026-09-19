/**
 * Researched content for Harsha de Silva's portfolio page
 * (src/pages/PortfolioProfile.jsx), reached at the canonical
 * /person/harsha-de-silva via the src/data/profileContent.ts resolver.
 *
 * Documents exactly one office: Non-Cabinet Minister of Economic Reforms &
 * Public Distribution (see `focusPosition` below) — his lowest-precedence,
 * i.e. highest-ranking, office by `precedenceFor(roleType)` in
 * src/data/roles.ts, chosen by that rule rather than by hand. See
 * src/data/harshaDeSilva.focusPosition.test.ts for the check that keeps it
 * honest if his bundled record ever changes.
 *
 * A `PortfolioProfileContent`, checked against that contract by the
 * `satisfies` at the bottom of this file: this file's SHAPE generalises to
 * any office-holder, it is only the data inside it that is Harsha de Silva's.
 * It still does not call `getPersonBySlug` itself — name, this office's full
 * term, "Today", every other office he has held and every sourcing badge are
 * derived by PortfolioProfile.jsx at render time from the canonical record,
 * so this file supplies only what the site does not already know: the
 * researched record of this one office.
 *
 * `s2`/`s4`/`s5` cover every Food Commissioner's Department action below as a
 * group, not a per-action citation: the underlying news articles (s4, s5)
 * are not available to check which specific action each one covers, so all
 * three are attached to every action inside the department's remit rather
 * than split between actions on a guess. If the original research that
 * produced these sources recorded a finer mapping, replace this with it — do
 * not tighten it further without that evidence.
 *
 * Cut for being outside the term (21 Dec 2018 – 21 Nov 2019) or otherwise out
 * of scope for this one office — the 1990 Suwa Seriya proposal, Enterprise
 * Sri Lanka, the one-million-jobs pledge, every vote and public position,
 * the full career-facts grid, education, research notes and the
 * responsibility-attribution essay: docs/research/harsha-de-silva-out-of-scope.md,
 * verbatim, with citations and a one-line reason for each.
 */

import type { RoleTypeValue } from "../types/models.ts";
import { RoleType } from "../types/models.ts";
import type { PortfolioProfileContent } from "./profileContent.ts";

export type AttributionKind = "documented-personal-action" | "office-institution" | "government-wide";

export type ActionStatus =
  | "completed"
  | "partly-completed"
  | "delayed"
  | "not-completed"
  | "intended-outcome-not-established"
  | "outcome-not-established"
  | "sources-conflict";

export type SourceType =
  | "Official institutional source"
  | "Government report"
  | "Parliamentary record"
  | "News report"
  | "Research publication"
  | "Other documented source";

export interface SourceEntry {
  id: string;
  organization: string;
  title?: string;
  date?: string;
  type: SourceType;
  /** Real canonical URL only. Absent (not "#") when no verified URL exists. */
  href?: string | null;
}

/**
 * A date at the precision a source actually recorded it. `date` is always a
 * plain ISO year (`"2019"`) or date (`"2019-03-30"`) — never padded with an
 * invented day or month. `display` is set only when a source's own wording
 * carries something `date` alone can't (e.g. "Initiated 30 Mar 2019").
 */
export interface StructuredDate {
  date: string;
  display?: string;
}

export interface DateRange {
  start: StructuredDate;
  end?: StructuredDate;
  /** True only when a source states the period is still ongoing. */
  ongoing?: boolean;
}

export interface Appointment {
  title: string;
  start: StructuredDate;
  end?: StructuredDate;
  /** True only when a source states this appointment is still held. */
  ongoing?: boolean;
}

/** Back-to-back appointments to the SAME office, oldest first — displayed as
    one continuous term, never merged into a single hand-typed date range. */
export interface FocusPosition {
  roleType: RoleTypeValue;
  appointments: Appointment[];
}

export interface CitedText {
  text: string;
  citeIds: string[];
}

export interface Institution {
  name: string;
  citeIds: string[];
}

export interface ActionRow {
  id: string;
  title: string;
  /** Absent when no source records when this action happened — renders
      Unavailable rather than an invented date. */
  period?: DateRange;
  attribution: AttributionKind;
  /** One neutral sentence elaborating the attribution — never a judgement on
      whether the attribution is good or bad. */
  attributionDetail?: string;
  /** What a source says was intended. Framed as intent ("aims to", "intended
      to"), never as a forecast of success. */
  statedAim?: CitedText;
  /** What is actually recorded as having happened, with the date of the
      source that reports it. */
  recordedResult: CitedText & { asOf?: StructuredDate };
  status: ActionStatus;
  /** True when this action is a later, sourced result of something begun
      during the term (inclusion rule 3) rather than something that itself
      happened inside the term. */
  isLaterResult?: boolean;
}

export interface DecisionRow {
  id: string;
  date: StructuredDate;
  matter: string;
  action: CitedText;
  /** True when this is a reported public position, not a recorded roll-call
      vote — changes what the row means, so it renders as a visible label. */
  isPublicPosition: boolean;
  result: string;
}

export const HARSHA_DE_SILVA = {
  slug: "harsha-de-silva",
  portraitUrl: "/portraits/harsha-de-silva.png",

  // Both appointments are the Non-Cabinet-Minister office, precedence 12 in
  // src/data/roles.ts — the lowest (highest-ranking) precedence anywhere in
  // his record, ahead of State Minister (15) and Deputy Minister (16), so no
  // tiebreak is needed. Parliament records the title in both word orders
  // back-to-back; the term is one continuous 21 Dec 2018 – 21 Nov 2019, not
  // the 11 Jan 2019 start this page used to show (that was only the second
  // appointment) or the vague "2018 – 2019" the old career card showed.
  focusPosition: {
    roleType: RoleType.NON_CABINET_MINISTER,
    appointments: [
      {
        title: "Non Cabinet Minister of Public Distribution and Economic Reforms",
        start: { date: "2018-12-21" },
        end: { date: "2019-01-11" },
      },
      {
        title: "Non Cabinet Minister of Economic Reforms and Public Distribution",
        start: { date: "2019-01-11" },
        end: { date: "2019-11-21" },
      },
    ],
  },

  portfolioAreas: ["Economic reforms", "Public distribution", "Food supply"],

  office: {
    // No `duties`: the only gazetted duty statement in the reviewed record
    // (Gazette Extraordinary No. 2066/09, 9 Apr 2018 — food supply &
    // distribution policy formulation, naming the Department of Food
    // Commissioner and a Data Analytics Unit) was issued while he held a
    // DIFFERENT office — State Minister of National Policies & Economic
    // Affairs (31 May 2017 – 26 Oct 2018) — six weeks before this term even
    // starts. Presenting it as this office's duties would misattribute it.
    // See docs/research/harsha-de-silva-out-of-scope.md.
    institutions: [
      {
        name: "Food Commissioner's Department",
        // s2 is the department's own 2019 Performance Report — the only
        // source tying an institution to this office within its term.
        citeIds: ["s2"],
      },
    ],
  },

  actions: [
    {
      id: "rice-miller-financing",
      title: "Rice miller financing programme",
      attribution: "office-institution",
      attributionDetail: "The Food Commissioner's Department.",
      statedAim: { text: "Helps rice millers operate and purchase paddy.", citeIds: ["s2", "s4", "s5"] },
      recordedResult: {
        text: "No outcome is established in the sources reviewed.",
        citeIds: ["s2", "s4", "s5"],
        asOf: { date: "2019" },
      },
      status: "intended-outcome-not-established",
    },
    {
      id: "paddy-purchasing-distribution",
      title: "Paddy purchasing & rice distribution",
      attribution: "office-institution",
      attributionDetail: "The Food Commissioner's Department.",
      statedAim: { text: "Improves paddy purchasing and rice availability.", citeIds: ["s2", "s4", "s5"] },
      recordedResult: {
        text: "No outcome is established in the sources reviewed.",
        citeIds: ["s2", "s4", "s5"],
        asOf: { date: "2019" },
      },
      status: "intended-outcome-not-established",
    },
    {
      id: "rice-price-stabilization",
      title: "Rice price / supply stabilization",
      attribution: "office-institution",
      attributionDetail: "The Food Commissioner's Department.",
      statedAim: { text: "Aims to reduce shortages and price fluctuations.", citeIds: ["s2", "s4", "s5"] },
      recordedResult: {
        text: "No outcome is established in the sources reviewed.",
        citeIds: ["s2", "s4", "s5"],
        asOf: { date: "2019" },
      },
      status: "intended-outcome-not-established",
    },
    {
      id: "storage-infrastructure",
      title: "Storage infrastructure development",
      attribution: "office-institution",
      attributionDetail: "The Food Commissioner's Department.",
      statedAim: {
        text: "Intended to reduce food losses and improve stock management through storage investment.",
        citeIds: ["s2", "s4", "s5"],
      },
      recordedResult: {
        text: "No outcome is established in the sources reviewed.",
        citeIds: ["s2", "s4", "s5"],
        asOf: { date: "2019" },
      },
      status: "intended-outcome-not-established",
    },
    {
      id: "chilling-house-project",
      title: "Chilling-house project",
      attribution: "office-institution",
      attributionDetail: "The Food Commissioner's Department.",
      statedAim: {
        text: "Intended to reduce post-harvest losses and improve supply through capital investment in a chilling-house.",
        citeIds: ["s2", "s4", "s5"],
      },
      recordedResult: {
        text: "No outcome is established in the sources reviewed.",
        citeIds: ["s2", "s4", "s5"],
        asOf: { date: "2019" },
      },
      status: "intended-outcome-not-established",
    },
    {
      id: "dambulla-cold-storage",
      title: 'Dambulla temperature-controlled cold storage ("Prabhashwara")',
      period: { start: { date: "2019-03-30", display: "Initiated 30 Mar 2019" } },
      attribution: "office-institution",
      attributionDetail: "Day-to-day delivery is institutional; the minister's portfolio presented the initiative.",
      statedAim: {
        text: "Reduce post-harvest losses and improve storage of excess fruit and vegetables. Initiated 30 March 2019 with 5,000 MT of planned capacity and an Rs. 300m Indian grant.",
        // S17/S18 are references from the research file whose source records
        // have not been transcribed into `sources` yet — not the same
        // identifier space as the lowercase s-ids above, and never a link
        // until a real SourceEntry replaces them.
        citeIds: ["S17", "S18"],
      },
      recordedResult: {
        text: "Described as incomplete, at near 90% completion, with intended benefits not fully realised.",
        citeIds: ["S17", "S18"],
        asOf: { date: "2024" },
      },
      status: "delayed",
      isLaterResult: true,
    },
  ],

  // All four researched votes/positions (23 Mar 2018, Apr 2018, 14 Nov 2018,
  // and a 2022 committee-stage matter) fall outside 21 Dec 2018 – 21 Nov
  // 2019 — see docs/research/harsha-de-silva-out-of-scope.md. Nothing here
  // widens the term to fill this.
  decisions: [],

  sources: [
    {
      id: "s2",
      organization: "Food Commissioner's Department",
      title: "Performance Report 2019",
      type: "Government report",
      // Verified 10 Sep 2026: the department's own 2019 performance report,
      // tabled in Parliament under its standard papers-presented naming
      // pattern (matches every other department's report in that archive).
      href: "https://www.parliament.lk/uploads/documents/paperspresented/performance-report-food-commissioners-department-2019.pdf",
    },
    {
      id: "s4",
      organization: "Sunday Times (Business Times)",
      date: "18 May 2019",
      type: "News report",
      href: null,
    },
    {
      id: "s5",
      organization: "EconomyNext",
      date: "26 May 2020",
      type: "News report",
      href: null,
    },
  ] satisfies SourceEntry[],
} satisfies PortfolioProfileContent;
