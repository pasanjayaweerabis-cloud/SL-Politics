# Harsha de Silva — researched content out of scope for the portfolio page

`/person/harsha-de-silva` now documents exactly one office: **Non-Cabinet
Minister of Economic Reforms & Public Distribution**, 21 Dec 2018 – 21 Nov
2019 (combining two back-to-back appointments — see
`src/data/harshaDeSilva.ts`'s `focusPosition`).

Nothing below was deleted from the research. It was cut from the page under
the inclusion rule in `src/pages/PortfolioProfile.jsx`'s doc comment: an item
stays only if it defines the office, happened during the term and concerns
the office's subjects/institutions, or is a later sourced result of
something the term started. Everything here failed all three, and is kept
verbatim, with its original citation ids, so the record is not lost — only
out of scope for *this* page. His full documented career remains reachable
from `/person/harsha-de-silva`'s "Other offices held" (derived from the
canonical record) and from the tabbed layout for any other person.

Citation ids below are exactly as they appeared in the pre-rewrite
`src/data/harshaDeSilva.ts`: lowercase `sN` ids are real, listed sources;
capital `SN` ids are unlisted placeholder references whose bibliographic
record was never transcribed (see the S-reference table in the final
report).

---

## Whole-career content (career facts, positions, education)

**Reason cut:** not scoped to any one office; the new page derives office
facts, term and "Today" from the canonical record instead, and "Other
offices held" gives full-career context without repeating it here.

### Career facts (`careerDetail.facts`, ids `cf1`–`cf9`)

| id | label | value | citeIds |
|---|---|---|---|
| cf1 | Current position | Member of Parliament, Colombo District (Tenth Parliament) | — |
| cf2 | Committee role | Chair, Committee on Public Finance | S2 |
| cf3 | Political party | Samagi Jana Balawegaya (SJB) | S1 |
| cf4 | Profession | Economist | S1 |
| cf5 | Date of birth | 30 August 1964 | S1 |
| cf6 | Previous ministerial positions | Deputy Minister of Policy Planning / Economic Affairs (2015); Deputy Minister of Foreign Affairs (2015–2017); State Minister of National Policies & Economic Affairs (2017–2018); Non-Cabinet Minister of Economic Reforms & Public Distribution (2018–2019) | S1 |
| cf7 | Parliamentary service | Seventh, Eighth, Ninth and Tenth Parliaments (per official profile) | S1 |
| cf8 | Major policy areas (derived) | Economic policy & reform · Foreign affairs · Food supply & public distribution · Public finance oversight | S1 |
| cf9 | Years in office (combined tenure) | *(not shown)* — "the reviewed source lists parliaments served but not an exact Seventh-Parliament start date, so a single derived tenure figure is not calculated here." | — |

Note: cf9's own reasoning was already stale — the bundled record
(`src/data/imported/parliamentMembers.json`, parliamentId 3201) has
`startDate: "2010-04-21"` for the Seventh Parliament. Not corrected here
(read-only for this pass); flagged in the final report's data-conflicts
section.

### Positions table (`careerDetail.positions`, ids `pos1`–`pos6`)

| id | title | institution | period | citeId |
|---|---|---|---|---|
| pos1 | Chair, Committee on Public Finance | Parliament of Sri Lanka | Current (recent Parliament record) | S2 |
| pos2 | Member of Parliament, Colombo District | Parliament of Sri Lanka — Tenth Parliament | Current | S1 |
| pos3 | Non-Cabinet Minister of Economic Reforms & Public Distribution | Government of Sri Lanka | 2018 – 2019 | S1 |
| pos4 | State Minister of National Policies & Economic Affairs | Government of Sri Lanka | 2017 – 2018 | S1 |
| pos5 | Deputy Minister of Foreign Affairs | Government of Sri Lanka | 2015 – 2017 | S1 |
| pos6 | Deputy Minister of Policy Planning / Economic Affairs | Government of Sri Lanka | 2015 | S1 |

Note: Parliament's own wording for pos6 is longer than shown here —
"Deputy Minister of Policy Planning, Economic Affairs, Child, Youth and
Cultural Affairs" (`parliamentMembers.json`, `portfoliosHeld`, startDate
2015-01-12) — the old page's shortened form was not Parliament's verbatim
title.

### `documentedResponsibilities`

> "The most detailed gazetted duties available in the reviewed record relate
> to the food supply & distribution portfolio (Government Gazette
> Extraordinary No. 2066/09, 9 Apr 2018): formulation of policies and
> programmes, and monitoring & evaluation, for food supply and distribution —
> with the Department of Food Commissioner and the Data Analytics Unit
> listed under the role."
>
> Note: "Gazetted duty statements for the other three ministerial portfolios
> were not located in the reviewed source material for this prototype; only
> the portfolio titles and dates are documented (Source: S1)."

**Reason this specific text is cut, beyond being whole-career:** the Gazette
it cites (9 Apr 2018) was issued while he held a *different* office — State
Minister of National Policies & Economic Affairs (31 May 2017 – 26 Oct
2018) — six weeks before the focus term even starts. See `office.duties` in
the rewritten `harshaDeSilva.ts`, which is deliberately absent rather than
presenting this text as the focus office's duties.

### `institutionsReferenced`

`["Department of Food Commissioner", "Data Analytics Unit", "1990 Suwa Seriya Foundation (proposal, not a formal portfolio institution)", "Committee on Public Finance, Parliament of Sri Lanka"]`

### `education`

> "Ph.D (Economics), University of Missouri, USA"
> "MA (Economics), University of Missouri, USA"
> "BS, Truman State University, USA"

(Verified 10 Sep 2026 against `parliamentMembers.json`'s
`detail.qualifications.academic` for parliamentId 3201 — the degrees
themselves are not in dispute, only their fit for a page scoped to one
office.)

### Old `responsibilities` block (superseded by the new `office`)

- `roleSummary`: "Harsha de Silva was Non-Cabinet Minister of Economic
  Reforms & Public Distribution. In that role, he was responsible for
  formulating, implementing, monitoring and evaluating government policies,
  programmes and projects related to economic reforms and public
  distribution." — restated the office title in gazette boilerplate; the new
  hero's derived scope sentence replaces it.
- `institutions` (7 items): "Food Commissioner's Department", "Department of
  Census & Statistics", "Family Economic Unit", "Data Analysis Unit", "1990
  Suwaseriya Foundation", "Task Force for Public Distribution", "Institute of
  Policy Studies" — only the first has a source tying it to the focus term
  (`s2`, the department's 2019 Performance Report). The other six have no
  citation anywhere in the reviewed record connecting them to *this* office
  specifically; the new `office.institutions` list is one item.
- `scope`: "In practical terms, the role gave him responsibility for helping
  direct and oversee economic-policy and public-distribution programmes.
  This included areas such as food supply, paddy/rice interventions and
  related public programmes." — uncited restatement.
- `authorityNote`: "Specific expenditure authority should be assessed
  against the relevant decision and institutional records." — an
  instruction to the reader (Task 9 bans this).

---

## Out-of-term programmes, promises and interventions

**Reason cut:** every item below is dated, or fact-checked against the
canonical record as having occurred, outside 21 Dec 2018 – 21 Nov 2019.

### `p6` — Census & Statistics administration
> Type: Public-service investment. Purpose: "Government spends on
> statistical operations." Outcome: "Better data can improve planning and
> policy decisions." Evidence status: intended-only. citeIds: `s3`.

**Reason:** routine agency running, not an action tied to this office — no
source ties the Department of Census & Statistics to the Economic Reforms &
Public Distribution portfolio specifically (unlike the Food Commissioner's
Department, which the office title itself names).

### `pi1` + `oi4` + `oi5` — 1990 Suwa Seriya
> `pi1` documentedRole: "In 2015, as Deputy Minister of National Policies and
> Economic Affairs, de Silva presented the Prime Minister a proposal for a
> modern emergency medical service with an ambulance network." statusOutcome:
> "Institutional continuity is strong: the service later expanded to 322
> ambulances by 2023; Ministry of Health reporting records a large volume of
> calls and incidents." citeIds: `S3, S4, S5, S6`.
>
> `oi4` (1990 Suwa Seriya fleet): baseline "88 ambulances at 2016 launch",
> later reference "322 ambulances by July 2023". citeIds: `S3, S5`.
>
> `oi5` (1990 Suwa Seriya cumulative service): later reference "5.47m calls;
> 1.24m incidents handled by 2022". citeIds: `S6`.

**Reason:** the proposal was made in 2015 while he held a different office
(Deputy Minister), three years before the focus term begins.

### `pi2` + `oi3` — Enterprise Sri Lanka
> `pi2` documentedRole: "The 2018 'Blue-Green Budget: the Launch of
> Enterprise Sri Lanka' was presented as a government programme under the
> finance/economic policy agenda. De Silva publicly promoted the reform
> direction while holding economic-policy portfolios." statusOutcome: "CBSL
> reports 34,476 loans worth Rs. 65.364bn in 2018 and 44,841 loans worth Rs.
> 84.882bn in 2019." citeIds: `S11, S12, S13, S14`.
>
> `oi3` (Enterprise Sri Lanka loans): later reference "34,476 loans /
> Rs.65.364bn (2018); 44,841 / Rs.84.882bn (2019)". citeIds: `S11, S12`.

**Reason:** launched under the national finance/economic agenda; the only
stated link to him is that he "publicly promoted" it, not that it ran under
this ministerial office.

### `oi1`, `oi2`, `pr1` — Employment, one million jobs
> `oi1` (Employed population, DCS): baseline 7,830,976 (2015), later
> reference 8,180,693 (2019). citeIds: `S19, S20`.
> `oi2` (Unemployment rate, DCS): baseline 4.7% (2015), later reference 4.8%
> (2019). citeIds: `S19`.
> `pr1` promise: "Create one million new jobs through an economic reform
> package." Status: Partially completed. documentedOutcome: "DCS reweighted
> series: employed population rose from 7,830,976 (2015) to 8,180,693 (2019)
> — about 349,717 more people employed. Unemployment moved from 4.7% (2015)
> to 4.8% (2019). The documented increase falls well short of one million by
> 2019. This was a government-wide objective and cannot be attributed
> solely to de Silva." citeIds: `S19, S20, S21`.

**Reason:** 2015 election-era baseline, government-wide in scope, and the
data's own text says it is not attributable to one minister.

### `pr2`, `pp1`, `pi5` — Social-market economy
> `pr2` promise: "Build a competitive, knowledge-based social-market
> economy." Date: 2015–2017 public statements. Status: Unable to verify.
> citeIds: `S21`.
> `pp1` policy position: "Advocated a knowledge-based, competitive
> social-market economy, publicly stated while holding economic-policy
> portfolios." Date: 2015 – 2017. citeIds: `S22`.
> `pi5` intervention: "Export-led / competitive social-market reform
> agenda." Period: 2015 – 2017 public statements. citeIds: `S21, S22`.
> hasDetails: false.

**Reason:** 2015–2017, entirely before the focus term.

### `pr3`, `pp2` — Export orientation
> `pr3` promise: "Strengthen export orientation." Date: 2015 public
> statements. Status: Unable to verify. citeIds: none;
> citeNote: "Not independently sourced in dossier".
> `pp2` policy position: "Stated goal of substantially increasing exports
> relative to GDP." Date: 2015. citeIds: none; citeNote: "Referenced in
> dossier §4; not assigned a numbered source in the reviewed material."

**Reason:** 2015, before the focus term.

### `vr1`–`vr4` — Votes and public positions

| id | date | matter | evidence | citeIds |
|---|---|---|---|---|
| vr1 | 23 Mar 2018 | Active Liability Management Bill — Second Reading | verified | S7 |
| vr2 | Apr 2018 | No-confidence motion against PM Ranil Wickremesinghe | claim | S8 |
| vr3 | 14 Nov 2018 | No-confidence motion against Mahinda Rajapaksa government | claim | S9 |
| vr4 | 2022 (committee stage) | Port City Economic Commission — committee-stage provisions | verified | S10 |

Full row text preserved: vr1 — "Official Hansard records an electronic
division. Harsha De Silva: YES." Result: "Ayes 50; Noes 32; Abstain 0. Bill
then read a second time." vr2 — "Contemporaneous reporting records de Silva
publicly supporting the government position to defeat the motion." (caveat:
"Public-position evidence; individual roll-call not independently
established in sources reviewed.") Result: "National result: 122 against;
76 for; 26 abstentions." vr3 — "De Silva publicly stated that the Rajapaksa
government had lost the motion." (caveat: "Public-position evidence; do not
convert into an individual vote without a roll-call source.") Result:
"Reporting records 122 votes against the government." vr4 — "De Silva
personally proposed amendments concerning appointment of commission members
and capital funding; several proposals were negated." Result: "One recorded
division: Ayes 46, Noes 147, Abstain 1; De Silva's vote is listed YES on the
amendment proposed in the electronic roll-call."

**Reason:** all four fall outside 21 Dec 2018 – 21 Nov 2019 — three before
the term starts, one (vr4) after it ends. **vr4's date needs an independent
check against Hansard before it is used anywhere** (Task 1f): "2022
(committee stage)" is the only date recorded for it here, and the Colombo
Port City Economic Commission Act is usually cited as Act No. 11 of 2021 —
no web research was permitted in this pass to resolve the discrepancy.

### `oi7`, `oi8` — Attendance, questions asked
> `oi7` (Parliament attendance): baseline "Eighth Parliament: 196 present /
> 56 absent", later reference "Ninth: 345 / 45; Tenth: 146 / 31 (official
> profile snapshot)". citeIds: `S1`.
> `oi8` (Questions asked in Parliament): baseline "Seventh Parliament: 40
> listed", later reference "Ninth: 14; Tenth: 7 (official profile
> snapshot)". citeIds: `S1`.

**Reason:** whole-MP activity across four Parliaments, not specific to this
ministerial office.

---

## Editorial and methodology content (removed outright, not merely
out-of-term)

These never had a clean home under the inclusion rule regardless of date —
Task 3/D-series of the brief this rewrite follows.

### `responsibilityAttribution`
> intro: "A programme occurring during a minister's tenure is not, by
> itself, proof that the minister personally caused the outcome. This
> dossier separates political, institutional and implementation
> responsibility wherever the record allows."
>
> - Political responsibility: "Setting policy direction and proposing or
>   overseeing a programme — e.g. presenting the original 1990 Suwa Seriya
>   proposal in 2015, or gazetted policy-formulation duties for food
>   distribution."
> - Institutional responsibility: "The ministry, department or agency
>   formally accountable for a programme's operation — e.g. the Food
>   Commissioner's Department, the Ministry of Health, or the Central Bank /
>   participating banks for Enterprise Sri Lanka."
> - Implementation responsibility: "The body that actually carried out
>   day-to-day delivery — often distinct from both the minister and the
>   parent ministry, e.g. the 1990 Suwa Seriya Foundation's operational
>   staff, or the Food Commissioner's Department's field operations."

Replaced by the fixed three-value attribution enum on each surviving action
row (`documented-personal-action` / `office-institution` / `government-wide`).

### `researchNotes`
> intro: "Evidence-supported background to help interpret the record. Not an
> opinion section."
>
> - Evidence-backed strengths to investigate further: "The strongest
>   documented case for direct personal initiation is 1990 Suwa Seriya: the
>   official service history states de Silva presented the proposal in 2015,
>   followed by a 2016 launch and later island-wide scale. Enterprise Sri
>   Lanka and the food-distribution portfolio show substantial programme
>   activity, but the causal chain is more institutional and multi-actor."
> - Mixed / incomplete outcome signals: "The one-million-jobs objective is
>   not supported by the 2019 employment figures as a literal one-million-job
>   result. The Dambulla cold-storage initiative has strong evidence of
>   initiation but later evidence indicates the expected outcome was not
>   fully realised."
> - What the voter should still verify: "Compare this dossier with the
>   person's current position, current party/platform, latest parliamentary
>   activity, current financial/disclosure information, and the records of
>   other candidates. Historical ministerial performance should not
>   substitute for current policy choices."

**Reason:** evaluation framed as findings ("strengths"), plus direct
instructions to the reader — exactly what a page that "shows facts... and
the reader decides" cannot carry.

### `voterTakeaway` / `peopleEffect` (per-row, across `outcomeIndicators` and `programmes`)

Every outcome indicator (`oi1`–`oi8`) carried a `voterTakeaway` and
`attributionCaution`; every programme (`p1`–`p6`) carried a `peopleEffect`.
Representative examples: "Shows substantial programme scale and increased
disbursement." (oi3); "Potentially positive for millers and farmers; overall
consumer benefit not yet proven" (p1's peopleEffect). Removed wholesale —
predictive/evaluative language banned by Task 3, independent of whether the
row's underlying fact survived elsewhere.

---

## Sources no longer cited on this page

`s1` (Parliament of Sri Lanka, "MP Profile",
`https://www.parliament.lk/en/members-of-parliament/mp-profile/3201`) and
`s3` (Department of Census & Statistics, "Performance Report 2019") are not
dropped from the record — they remain real, valid documents — but nothing
that survives on this office-scoped page cites them any longer (their
citing facts, above, are all out of scope). They are not listed in the new
`harshaDeSilva.ts`'s `sources[]`, since Task 4h's "Used for:" line would
otherwise show nothing for either. `s1`'s content (party, profession, date
of birth, Parliaments served) reaches the reader anyway, through the
site-wide canonical record ("Today" line, "Other offices held"), which cites
the same Parliament of Sri Lanka source independently.
