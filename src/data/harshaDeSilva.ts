/**
 * Hardcoded content for Harsha de Silva's portfolio profile
 * (src/pages/PortfolioProfile.jsx), reached at the canonical
 * /person/harsha-de-silva via the src/data/profileContent.ts resolver.
 *
 * Not a `repository.ts` consumer: it does not call `getPersonBySlug` and does
 * not generalise to anyone else. Kept as a typed data object, separate from
 * the JSX, purely to keep the component file readable.
 *
 * `sourceIds` on each programme is a domain-level grouping, not a per-claim
 * verified citation: the underlying news articles (S4, S5) are not available
 * to check which specific row each one covers, so both are attached to every
 * row inside the Food Commissioner's Department's remit rather than split
 * between rows on a guess. Row 6 (Census & Statistics) is the one row with an
 * exact institutional match, so it stands alone. If the original research
 * that produced these five sources recorded a finer mapping, replace this
 * with it — do not tighten it further without that evidence.
 */

export type EvidenceStatus =
  | "source-linked"
  | "established"
  | "not-established"
  | "conflicting"
  | "intended-only";

export type SourceType =
  | "Official institutional source"
  | "Government report"
  | "Parliamentary record"
  | "News report"
  | "Research publication"
  | "Other documented source";

export interface ProgrammeRow {
  id: string;
  title: string;
  type: string;
  purpose: string;
  outcome: string;
  evidenceStatus: EvidenceStatus;
  financialEvidence: string;
  peopleEffect: string;
  sourceIds: string[];
}

export interface SourceEntry {
  id: string;
  organization: string;
  title?: string;
  date?: string;
  type: SourceType;
  /** Real canonical URL only. Absent (not "#") when no verified URL exists. */
  href?: string | null;
}

export type VerificationStatus = "verified" | "partially-verified" | "claim" | "derived" | "unverified";

/**
 * citeIds below (S1..S21) are placeholders: the research pass that produced
 * sections 04-06 numbered its sources but the bibliographic record for each
 * one (organization, title, URL, date) has not been transcribed into `sources`
 * yet. Rendered as plain unlinked tokens (PendingCitations in
 * PortfolioProfile.jsx), never as a link to a source that doesn't exist in
 * this file — do not wire these into SourceRefs/hds-source-* anchors until
 * real SourceEntry records replace them.
 */
export interface OutcomeIndicatorRow {
  id: string;
  indicator: string;
  verification: VerificationStatus;
  baseline: string;
  laterReference: string;
  voterTakeaway: string;
  attributionCaution: string;
  citeIds: string[];
}

export interface VotingRecordRow {
  id: string;
  date: string;
  /** Sort/filter key — kept separate from the free-text `date` above, which
      carries phrasing ("Apr 2018", "2022 (committee stage)") a plain year
      can't. */
  year: number;
  matter: string;
  documentedAction: string;
  /** The italic caveat under documentedAction on a "claim" row — absent for
      a "verified" row, which needs no such caveat. */
  actionCaveat?: string;
  result: string;
  evidence: VerificationStatus;
  citeIds: string[];
}

export interface PromiseCard {
  id: string;
  title: string;
  date: string;
  expectedOutcome: string;
  actionTaken: string;
  status: string;
  documentedOutcome: string;
  citeIds: string[];
  /** Plain-text stand-in for a citation list, e.g. "Not independently
      sourced in dossier" — used instead of citeIds when there is nothing to
      even placeholder-cite. */
  citeNote?: string;
}

/**
 * Sections 07-11 (the "detailed analysis" layer, expanded from the toggle in
 * PortfolioProfile.jsx) — a deeper research pass than sections 01-06's
 * single-portfolio record: it covers de Silva's full documented career, not
 * just the Economic Reforms & Public Distribution tenure. Its citations
 * (S1..S22) are the same kind of placeholder as OutcomeIndicatorRow's above,
 * not yet backed by SourceEntry records.
 */
export interface ProgrammeInterventionRow {
  id: string;
  title: string;
  period: string;
  documentedRole: string;
  statusOutcome: string;
  evidence: VerificationStatus;
  citeIds: string[];
  /** false renders "No further detail" instead of a Details control — no
      indicator-level breakdown exists for a pure policy-direction row like
      the export-led reform agenda. */
  hasDetails: boolean;
  /** Structural link only — ids into outcomeIndicators.rows this row's
      Details control expands inline, from exact title matches between the
      two research passes. Absent (even when hasDetails is true) means no
      indicator-level breakdown has been matched yet: render as "No further
      detail" rather than a Details control with nothing to show. */
  indicatorIds?: string[];
}

export interface PolicyPositionRow {
  id: string;
  issue: string;
  position: string;
  date: string;
  evidenceType: string;
  evidence: VerificationStatus;
  citeIds: string[];
  citeNote?: string;
}

/** One item in section 09's full-career summary grid. `list` (rather than
    `value`) renders as a bullet list — used only by Previous ministerial
    positions. `note` replaces the value entirely for a fact the record
    can't establish (Years in office). */
export interface CareerFact {
  id: string;
  label: string;
  verification: VerificationStatus;
  value?: string;
  list?: string[];
  citeIds?: string[];
  note?: string;
}

export interface PositionRecord {
  id: string;
  title: string;
  institution: string;
  period: string;
  citeId: string;
}

export interface AttributionLevel {
  id: string;
  label: string;
  body: string;
}

export interface ResearchNote {
  id: string;
  label: string;
  body: string;
}

export const HARSHA_DE_SILVA = {
  name: "Harsha de Silva",
  portraitUrl: "/portraits/harsha-de-silva.png",

  hero: {
    eyebrow: "Ministerial portfolio",
    focusRole: "Non-Cabinet Minister of Economic Reforms & Public Distribution",
    tenure: "11 Jan 2019 - 21 Nov 2019",
    focusNote:
      "This page documents one ministerial portfolio from the public record below. It does not cover this person's full political career.",
    focusExplainer:
      "SL Politics publishes two kinds of profile: a general record of every position a person has held, and (for a smaller set of people) a portfolio page documenting one ministerial office in more depth. That office carried institutional scope and a budget a general listing does not capture. This page is the second kind: it covers the tenure shown here, not a ranking of this person's most important office.",
  },

  portfolioAreas: ["Economic reforms", "Public distribution", "Food supply"],

  // Verified 10 Sep 2026 against Parliament's own MP profile (parliamentId
  // 3201, the same record source s1 below cites) — src/data/imported/
  // parliamentMembers.json's detail.qualifications.academic for this member,
  // not independently researched or inferred.
  education: [
    "Ph.D (Economics), University of Missouri, USA",
    "MA (Economics), University of Missouri, USA",
    "BS, Truman State University, USA",
  ],

  responsibilities: {
    roleSummary:
      "Harsha de Silva was Non-Cabinet Minister of Economic Reforms & Public Distribution. In that role, he was responsible for formulating, implementing, monitoring and evaluating government policies, programmes and projects related to economic reforms and public distribution.",
    institutions: [
      "Food Commissioner's Department",
      "Department of Census & Statistics",
      "Family Economic Unit",
      "Data Analysis Unit",
      "1990 Suwaseriya Foundation",
      "Task Force for Public Distribution",
      "Institute of Policy Studies",
    ],
    scope:
      "In practical terms, the role gave him responsibility for helping direct and oversee economic-policy and public-distribution programmes. This included areas such as food supply, paddy/rice interventions and related public programmes.",
    authorityNote:
      "Specific expenditure authority should be assessed against the relevant decision and institutional records.",
  },

  programmesIntro:
    "These are the major programmes and interventions documented during this tenure and within the recorded portfolio. Where the available evidence does not establish an outcome, the outcome is marked “Not established” rather than inferred.",

  evidenceNote: {
    term: "Not established",
    body: "means the available sources did not establish the stated outcome. It does not mean the event did not occur.",
  },

  programmes: [
    {
      id: "p1",
      title: "Rice miller financing programme",
      type: "Investment / support spending",
      purpose: "Helps rice millers operate and purchase paddy",
      outcome: "Could strengthen rice production and supply",
      evidenceStatus: "intended-only",
      financialEvidence: "Not established",
      peopleEffect: "Potentially positive for millers and farmers; overall consumer benefit not yet proven",
      sourceIds: ["s2", "s4", "s5"],
    },
    {
      id: "p2",
      title: "Paddy purchasing & rice distribution",
      type: "Public investment / market intervention",
      purpose: "Improves paddy purchasing and rice availability",
      outcome: "Could support stable rice supply and farmer markets",
      evidenceStatus: "intended-only",
      financialEvidence: "Not established",
      peopleEffect: "Potentially positive if supply improves and prices become more stable",
      sourceIds: ["s2", "s4", "s5"],
    },
    {
      id: "p3",
      title: "Rice price / supply stabilization",
      type: "Government intervention spending",
      purpose: "Aims to reduce shortages and price fluctuations",
      outcome: "Could improve food-price stability",
      evidenceStatus: "intended-only",
      financialEvidence: "Not established",
      peopleEffect: "Potentially positive for consumers; actual effectiveness not established",
      sourceIds: ["s2", "s4", "s5"],
    },
    {
      id: "p4",
      title: "Storage infrastructure development",
      type: "Long-term investment",
      purpose: "Requires spending to build/improve storage",
      outcome: "Can reduce food losses and improve stock management",
      evidenceStatus: "intended-only",
      financialEvidence: "Not established",
      peopleEffect: "Potentially positive through more reliable food supply",
      sourceIds: ["s2", "s4", "s5"],
    },
    {
      id: "p5",
      title: "Chilling-house project",
      type: "Long-term infrastructure investment",
      purpose: "Requires capital spending",
      outcome: "Intended to reduce post-harvest losses and improve supply",
      evidenceStatus: "intended-only",
      financialEvidence: "Not established",
      peopleEffect: "Potentially positive if food losses decrease and supply improves",
      sourceIds: ["s2", "s4", "s5"],
    },
    {
      id: "p6",
      title: "Census & Statistics administration",
      type: "Public-service investment",
      purpose: "Government spends on statistical operations",
      outcome: "Better data can improve planning and policy decisions",
      evidenceStatus: "intended-only",
      financialEvidence: "Not established",
      peopleEffect: "Indirect benefit through better government decision-making",
      sourceIds: ["s3"],
    },
  ] satisfies ProgrammeRow[],

  outcomeIndicators: {
    intro:
      "What measurable results can actually be observed. Distinct from programme activity: this asks what result can be demonstrated, not what was launched. No indicator is collapsed into a subjective “politician score,” and results are shown whether they are positive, mixed, or incomplete.",
    rows: [
      {
        id: "oi1",
        indicator: "Employed population (DCS)",
        verification: "verified",
        baseline: "7,830,976 (2015)",
        laterReference: "8,180,693 (2019)",
        voterTakeaway: "Overall employment increased by about 349,717 across the period.",
        attributionCaution: "Macroeconomic outcome; not an individual minister metric.",
        citeIds: ["S19", "S20"],
      },
      {
        id: "oi2",
        indicator: "Unemployment rate (DCS)",
        verification: "verified",
        baseline: "4.7% (2015)",
        laterReference: "4.8% (2019)",
        voterTakeaway: "Unemployment was slightly higher in 2019 than 2015 despite employment growth.",
        attributionCaution: "Affected by many policies and macro factors.",
        citeIds: ["S19"],
      },
      {
        id: "oi3",
        indicator: "Enterprise Sri Lanka loans",
        verification: "verified",
        baseline: "—",
        laterReference: "34,476 loans / Rs.65.364bn (2018); 44,841 / Rs.84.882bn (2019)",
        voterTakeaway: "Shows substantial programme scale and increased disbursement.",
        attributionCaution: "Government and participating-bank programme; not solely attributable to one minister.",
        citeIds: ["S11", "S12"],
      },
      {
        id: "oi4",
        indicator: "1990 Suwa Seriya fleet",
        verification: "verified",
        baseline: "88 ambulances at 2016 launch",
        laterReference: "322 ambulances by July 2023",
        voterTakeaway: "Shows durable scale-up of a service first proposed by de Silva in 2015.",
        attributionCaution: "Later expansion reflects institutional and government continuity.",
        citeIds: ["S3", "S5"],
      },
      {
        id: "oi5",
        indicator: "1990 Suwa Seriya cumulative service",
        verification: "verified",
        baseline: "—",
        laterReference: "5.47m calls; 1.24m incidents handled by 2022",
        voterTakeaway: "Shows real-world utilisation and service reach.",
        attributionCaution: "Institutional outcome; use for programme durability, not personal scoring.",
        citeIds: ["S6"],
      },
      {
        id: "oi6",
        indicator: "Dambulla cold-storage capacity",
        verification: "partially-verified",
        baseline: "Project not yet operational in 2018",
        laterReference: "5,000 MT planned; later reported near-90% but incomplete in 2024",
        voterTakeaway: "Illustrates the difference between project initiation and realised outcome.",
        attributionCaution: "Completion and utilisation require primary verification.",
        citeIds: ["S17", "S18"],
      },
      {
        id: "oi7",
        indicator: "Parliament attendance",
        verification: "verified",
        baseline: "Eighth Parliament: 196 present / 56 absent",
        laterReference: "Ninth: 345 / 45; Tenth: 146 / 31 (official profile snapshot)",
        voterTakeaway: "Useful legislative-engagement metric.",
        attributionCaution: "Attendance does not equal policy quality or effectiveness.",
        citeIds: ["S1"],
      },
      {
        id: "oi8",
        indicator: "Questions asked in Parliament",
        verification: "verified",
        baseline: "Seventh Parliament: 40 listed",
        laterReference: "Ninth: 14; Tenth: 7 (official profile snapshot)",
        voterTakeaway: "Shows one dimension of parliamentary activity.",
        attributionCaution: "Question counts depend on parliamentary rules, sessions and role.",
        citeIds: ["S1"],
      },
    ],
  } satisfies { intro: string; rows: OutcomeIndicatorRow[] },

  votingRecord: {
    intro:
      "What documented decisions or votes this politician made. Distinguishes an individually verified parliamentary roll-call from a public political position where an individual vote was not independently established. Never converted into an individual vote without a roll-call source.",
    scopeNote:
      "Record scope: this is a researched sample of individually located parliamentary decisions, not a complete lifetime voting history.",
    rows: [
      {
        id: "vr1",
        date: "23 Mar 2018",
        year: 2018,
        matter: "Active Liability Management Bill — Second Reading",
        documentedAction: "Official Hansard records an electronic division. Harsha De Silva: YES.",
        result: "Ayes 50; Noes 32; Abstain 0. Bill then read a second time.",
        evidence: "verified",
        citeIds: ["S7"],
      },
      {
        id: "vr2",
        date: "Apr 2018",
        year: 2018,
        matter: "No-confidence motion against PM Ranil Wickremesinghe",
        documentedAction: "Contemporaneous reporting records de Silva publicly supporting the government position to defeat the motion.",
        actionCaveat: "Public-position evidence; individual roll-call not independently established in sources reviewed.",
        result: "National result: 122 against; 76 for; 26 abstentions.",
        evidence: "claim",
        citeIds: ["S8"],
      },
      {
        id: "vr3",
        date: "14 Nov 2018",
        year: 2018,
        matter: "No-confidence motion against Mahinda Rajapaksa government",
        documentedAction: "De Silva publicly stated that the Rajapaksa government had lost the motion.",
        actionCaveat: "Public-position evidence; do not convert into an individual vote without a roll-call source.",
        result: "Reporting records 122 votes against the government.",
        evidence: "claim",
        citeIds: ["S9"],
      },
      {
        id: "vr4",
        date: "2022 (committee stage)",
        year: 2022,
        matter: "Port City Economic Commission — committee-stage provisions",
        documentedAction: "De Silva personally proposed amendments concerning appointment of commission members and capital funding; several proposals were negated.",
        result: "One recorded division: Ayes 46, Noes 147, Abstain 1; De Silva's vote is listed YES on the amendment proposed in the electronic roll-call.",
        evidence: "verified",
        citeIds: ["S10"],
      },
    ],
  } satisfies { intro: string; scopeNote: string; rows: VotingRecordRow[] },

  promises: {
    intro:
      "What was promised or publicly committed to, and what happened afterward. No “promise fulfilment percentage” is calculated — status is shown transparently instead, and personal causation is not implied for government-wide commitments.",
    cards: [
      {
        id: "pr1",
        title: "Create one million new jobs through an economic reform package",
        date: "2015 election-era reform agenda; World Bank documentation 2016",
        expectedOutcome: "A large increase in total employment attributable to the reform package.",
        actionTaken: "Government-wide economic reform programme implemented, supported by World Bank financing.",
        status: "Partially completed",
        documentedOutcome:
          "DCS reweighted series: employed population rose from 7,830,976 (2015) to 8,180,693 (2019) — about 349,717 more people employed. Unemployment moved from 4.7% (2015) to 4.8% (2019). The documented increase falls well short of one million by 2019. This was a government-wide objective and cannot be attributed solely to de Silva.",
        citeIds: ["S19", "S20", "S21"],
      },
      {
        id: "pr2",
        title: "Build a competitive, knowledge-based social-market economy",
        date: "2015–2017 public statements",
        expectedOutcome: "Improved competitiveness, exports, productivity and private-sector growth.",
        actionTaken: "Reform programme supported by World Bank financing aimed at competitiveness, transparency, fiscal sustainability and jobs.",
        status: "Unable to verify",
        documentedOutcome: "Policy direction is clearly documented, but a single personal outcome metric is not established in the reviewed sources.",
        citeIds: ["S21"],
      },
      {
        id: "pr3",
        title: "Strengthen export orientation",
        date: "2015 public statements",
        expectedOutcome: "A dramatic increase in the exports-to-GDP ratio.",
        actionTaken: "Public statements of policy ambition; no distinct programme record located.",
        status: "Unable to verify",
        documentedOutcome:
          "The reviewed sources confirm the policy goal; this dossier does not treat the stated long-run export target as achieved without a directly comparable final-year measure.",
        citeIds: [],
        citeNote: "Not independently sourced in dossier",
      },
      {
        id: "pr4",
        title: "Improve food-market resilience and reduce post-harvest waste through storage",
        date: "2019 Dambulla cold-storage initiative",
        expectedOutcome: "Completion, capacity, utilisation, farmer uptake and reduced spoilage/waste.",
        actionTaken: "Project initiated 30 March 2019 with 5,000 MT planned capacity and an Rs. 300m Indian grant.",
        status: "Delayed",
        documentedOutcome: "2024 reporting describes the facility as incomplete/near 90% completion, with intended benefits not fully realised.",
        citeIds: ["S17", "S18"],
      },
    ],
  } satisfies { intro: string; cards: PromiseCard[] },

  detailedAnalysis: {
    programmeInterventions: {
      intro:
        "Programmes and interventions that can be linked to Harsha de Silva's ministerial portfolios. This documents what was initiated or administered and what evidence exists about delivery — a programme is not labelled \"successful\" merely because it existed or was launched. Select Details on a row for indicator-level evidence.",
      rows: [
        {
          id: "pi1",
          title: "1990 Suwa Seriya",
          period: "Proposed 2015 · Launched 2016",
          documentedRole:
            "In 2015, as Deputy Minister of National Policies and Economic Affairs, de Silva presented the Prime Minister a proposal for a modern emergency medical service with an ambulance network.",
          statusOutcome:
            "Institutional continuity is strong: the service later expanded to 322 ambulances by 2023; Ministry of Health reporting records a large volume of calls and incidents.",
          evidence: "verified",
          citeIds: ["S3", "S4", "S5", "S6"],
          hasDetails: true,
          indicatorIds: ["oi4", "oi5"],
        },
        {
          id: "pi2",
          title: "Enterprise Sri Lanka",
          period: "Launched 2018",
          documentedRole:
            "The 2018 \"Blue-Green Budget: the Launch of Enterprise Sri Lanka\" was presented as a government programme under the finance/economic policy agenda. De Silva publicly promoted the reform direction while holding economic-policy portfolios.",
          statusOutcome:
            "CBSL reports 34,476 loans worth Rs. 65.364bn in 2018 and 44,841 loans worth Rs. 84.882bn in 2019.",
          evidence: "verified",
          citeIds: ["S11", "S12", "S13", "S14"],
          hasDetails: true,
          indicatorIds: ["oi3"],
        },
        {
          id: "pi3",
          title: "Food supply & distribution policy",
          period: "Gazetted Apr 2018 – End 2019",
          documentedRole:
            "The April 2018 Gazette assigned de Silva responsibility for formulation of policies and programmes, and monitoring/evaluation, regarding food supply and distribution; the Department of Food Commissioner and Data Analytics Unit were listed under that role.",
          statusOutcome:
            "2019 performance reporting records store renovation and construction activity associated with better stock management and a planned chilling-house complex.",
          evidence: "verified",
          citeIds: ["S15", "S16"],
          hasDetails: true,
        },
        {
          id: "pi4",
          title: "Dambulla temperature-controlled cold storage (\"Prabhashwara\")",
          period: "Initiated 30 Mar 2019",
          documentedRole:
            "The 2019 initiative was presented under de Silva's economic-reform/public-distribution portfolio to reduce post-harvest losses and improve storage of excess fruit and vegetables.",
          statusOutcome:
            "Later reporting in 2024 described the facility as incomplete/near 90% and said intended benefits had not been fully realised.",
          evidence: "partially-verified",
          citeIds: ["S17", "S18"],
          hasDetails: true,
          indicatorIds: ["oi6"],
        },
        {
          id: "pi5",
          title: "Export-led / competitive social-market reform agenda",
          period: "2015 – 2017 public statements",
          documentedRole:
            "De Silva repeatedly advocated a knowledge-based, competitive social-market economy and stronger exports in public statements during 2015–2017.",
          statusOutcome:
            "This is a policy direction rather than a single project with one measurable delivery owner.",
          evidence: "claim",
          citeIds: ["S21", "S22"],
          hasDetails: false,
        },
      ],
    } satisfies { intro: string; rows: ProgrammeInterventionRow[] },

    policyPositions: {
      intro:
        "Public statements of policy direction, distinguished from official documented positions. Interpretation is not converted into fact.",
      rows: [
        {
          id: "pp1",
          issue: "Economic reform direction",
          position:
            "Advocated a knowledge-based, competitive social-market economy, publicly stated while holding economic-policy portfolios.",
          date: "2015 – 2017",
          evidenceType: "Public statement",
          evidence: "claim",
          citeIds: ["S22"],
        },
        {
          id: "pp2",
          issue: "Export orientation",
          position: "Stated goal of substantially increasing exports relative to GDP.",
          date: "2015",
          evidenceType: "Public statement",
          evidence: "claim",
          citeIds: [],
          citeNote: "Referenced in dossier §4; not assigned a numbered source in the reviewed material.",
        },
      ],
    } satisfies { intro: string; rows: PolicyPositionRow[] },

    careerDetail: {
      intro:
        "Full current and historical positions, each tied to a source, ordered most recent first — plus the gazetted duties and institutions referenced in the reviewed record.",
      summaryHeading: "Full-career portfolio summary",
      summaryNote:
        "Distinct from the \"Portfolio at a glance\" panel above, which is scoped to the single Economic Reforms & Public Distribution portfolio — this covers his full documented career across all roles.",
      facts: [
        {
          id: "cf1",
          label: "Current position",
          verification: "verified",
          value: "Member of Parliament, Colombo District (Tenth Parliament)",
        },
        {
          id: "cf2",
          label: "Committee role",
          verification: "verified",
          value: "Chair, Committee on Public Finance",
          citeIds: ["S2"],
        },
        {
          id: "cf3",
          label: "Political party",
          verification: "verified",
          value: "Samagi Jana Balawegaya (SJB)",
          citeIds: ["S1"],
        },
        {
          id: "cf4",
          label: "Profession",
          verification: "verified",
          value: "Economist",
          citeIds: ["S1"],
        },
        {
          id: "cf5",
          label: "Date of birth",
          verification: "verified",
          value: "30 August 1964",
          citeIds: ["S1"],
        },
        {
          id: "cf6",
          label: "Previous ministerial positions",
          verification: "verified",
          list: [
            "Deputy Minister of Policy Planning / Economic Affairs (2015)",
            "Deputy Minister of Foreign Affairs (2015–2017)",
            "State Minister of National Policies & Economic Affairs (2017–2018)",
            "Non-Cabinet Minister of Economic Reforms & Public Distribution (2018–2019)",
          ],
          citeIds: ["S1"],
        },
        {
          id: "cf7",
          label: "Parliamentary service",
          verification: "verified",
          value: "Seventh, Eighth, Ninth and Tenth Parliaments (per official profile)",
          citeIds: ["S1"],
        },
        {
          id: "cf8",
          label: "Major policy areas (derived)",
          verification: "derived",
          value: "Economic policy & reform · Foreign affairs · Food supply & public distribution · Public finance oversight",
          citeIds: ["S1"],
        },
        {
          id: "cf9",
          label: "Years in office (combined tenure)",
          verification: "unverified",
          note: "Not shown — the reviewed source lists parliaments served but not an exact Seventh-Parliament start date, so a single derived tenure figure is not calculated here.",
        },
      ] satisfies CareerFact[],
      positionsHeading: "Current & historical positions",
      positions: [
        { id: "pos1", title: "Chair, Committee on Public Finance", institution: "Parliament of Sri Lanka", period: "Current (recent Parliament record)", citeId: "S2" },
        { id: "pos2", title: "Member of Parliament, Colombo District", institution: "Parliament of Sri Lanka — Tenth Parliament", period: "Current", citeId: "S1" },
        { id: "pos3", title: "Non-Cabinet Minister of Economic Reforms & Public Distribution", institution: "Government of Sri Lanka", period: "2018 – 2019", citeId: "S1" },
        { id: "pos4", title: "State Minister of National Policies & Economic Affairs", institution: "Government of Sri Lanka", period: "2017 – 2018", citeId: "S1" },
        { id: "pos5", title: "Deputy Minister of Foreign Affairs", institution: "Government of Sri Lanka", period: "2015 – 2017", citeId: "S1" },
        { id: "pos6", title: "Deputy Minister of Policy Planning / Economic Affairs", institution: "Government of Sri Lanka", period: "2015", citeId: "S1" },
      ] satisfies PositionRecord[],
      documentedResponsibilities: {
        body:
          "The most detailed gazetted duties available in the reviewed record relate to the food supply & distribution portfolio (Government Gazette Extraordinary No. 2066/09, 9 Apr 2018): formulation of policies and programmes, and monitoring & evaluation, for food supply and distribution — with the Department of Food Commissioner and the Data Analytics Unit listed under the role.",
        note:
          "Gazetted duty statements for the other three ministerial portfolios were not located in the reviewed source material for this prototype; only the portfolio titles and dates are documented (Source: S1).",
      },
      institutionsReferenced: [
        "Department of Food Commissioner",
        "Data Analytics Unit",
        "1990 Suwa Seriya Foundation (proposal, not a formal portfolio institution)",
        "Committee on Public Finance, Parliament of Sri Lanka",
      ],
    },

    responsibilityAttribution: {
      intro:
        "A programme occurring during a minister's tenure is not, by itself, proof that the minister personally caused the outcome. This dossier separates political, institutional and implementation responsibility wherever the record allows.",
      levels: [
        {
          id: "political",
          label: "Political responsibility",
          body: "Setting policy direction and proposing or overseeing a programme — e.g. presenting the original 1990 Suwa Seriya proposal in 2015, or gazetted policy-formulation duties for food distribution.",
        },
        {
          id: "institutional",
          label: "Institutional responsibility",
          body: "The ministry, department or agency formally accountable for a programme's operation — e.g. the Food Commissioner's Department, the Ministry of Health, or the Central Bank / participating banks for Enterprise Sri Lanka.",
        },
        {
          id: "implementation",
          label: "Implementation responsibility",
          body: "The body that actually carried out day-to-day delivery — often distinct from both the minister and the parent ministry, e.g. the 1990 Suwa Seriya Foundation's operational staff, or the Food Commissioner's Department's field operations.",
        },
      ] satisfies AttributionLevel[],
    },

    researchNotes: {
      intro: "Evidence-supported background to help interpret the record. Not an opinion section.",
      notes: [
        {
          id: "strengths",
          label: "Evidence-backed strengths to investigate further",
          body: "The strongest documented case for direct personal initiation is 1990 Suwa Seriya: the official service history states de Silva presented the proposal in 2015, followed by a 2016 launch and later island-wide scale. Enterprise Sri Lanka and the food-distribution portfolio show substantial programme activity, but the causal chain is more institutional and multi-actor.",
        },
        {
          id: "mixed",
          label: "Mixed / incomplete outcome signals",
          body: "The one-million-jobs objective is not supported by the 2019 employment figures as a literal one-million-job result. The Dambulla cold-storage initiative has strong evidence of initiation but later evidence indicates the expected outcome was not fully realised.",
        },
        {
          id: "verify",
          label: "What the voter should still verify",
          body: "Compare this dossier with the person's current position, current party/platform, latest parliamentary activity, current financial/disclosure information, and the records of other candidates. Historical ministerial performance should not substitute for current policy choices.",
        },
      ] satisfies ResearchNote[],
    },
  },

  sources: [
    {
      id: "s1",
      organization: "Parliament of Sri Lanka",
      title: "MP Profile",
      type: "Official institutional source",
      // Real per-member profile URL, same pattern src/sync/connectors/parliament.ts
      // and src/data/adapters/pastMembersDataset.ts use for every member — built
      // from his real parliamentId (3201) in src/data/imported/parliamentMembers.json,
      // not invented for this page.
      href: "https://www.parliament.lk/en/members-of-parliament/mp-profile/3201",
    },
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
      id: "s3",
      organization: "Department of Census & Statistics",
      title: "Performance Report 2019",
      type: "Government report",
      // Verified 10 Sep 2026 by fetching the document itself: the
      // department's own 2019 performance report, tabled in Parliament.
      href: "https://www.parliament.lk/uploads/documents/paperspresented/performance-report-department-of-census-and-statistics-2019.pdf",
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

  recordStatus: {
    label: "Source-linked",
  },
};
