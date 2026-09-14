import React from 'react';
import { Icon } from '../lib/icons.jsx';
import {
  Avatar, VerifiedBadge, Chip, CurrentBadge, EvidencePill, Notice, EmptyState,
  ActionLink, Unavailable, Unrecorded, NotVerified, TenureValue,
} from '../components/Primitives.jsx';
import {
  DATASET, getPersonBySlug, getSource, evidenceFor, sourcesCitedBy, getParty,
} from '../services/repository.ts';
import { SYNC_PRESENTATION } from '../data/sources.ts';
import { formatDate, deriveAge, toSortKey, toLatestKey } from '../lib/date.ts';
import { isCurrent, isFuture, sortPositions } from '../lib/positions.ts';
import { roleTypeName } from '../data/roles.ts';
import { RoleType } from '../types/models.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { personMeta } from '../lib/pageMeta.ts';
import { PORTRAIT_DISPLAY_POLICY } from '../data/portraitPolicy.ts';
import { safeExternalHref } from '../lib/externalUrl.ts';
import { useI18n } from '../lib/i18n.jsx';
import '../styles/profile-decision.css';

/**
 * Javora — a person's public record, laid out decision-first.
 *
 * Scoped to a single profile (Harsha de Silva, slug "harsha-de-silva") by its
 * only caller, PersonPage.jsx — see the slug check there. This is NOT the
 * site's default person layout; every other profile keeps the tabbed one in
 * PersonPage.jsx. Do not wire this up as a general replacement without
 * checking with whoever owns that decision, since the tabbed layout, its
 * Tabs/TabPanel components and `src/lib/profileTabs.ts` are still the
 * documented default in CLAUDE.md.
 *
 * The page answers four questions in order, rather than filing facts by which
 * database table they came from: what did they do before we gave them power,
 * what were they responsible for once they had it, what does nobody publish
 * about them, and where can a researcher go next.
 *
 * ONE COLUMN, NO TABS — every fact is in the document on first paint, same
 * reasoning as PersonPage's own `TabPanel` invariant, just applied by not
 * using tabs at all rather than by rendering-and-hiding.
 *
 * The section-02 accountability tiles are deliberately empty. Ministry
 * budgets, spend and audit findings are real questions with no connected
 * source — see `docs/accountability-data-roadmap.md` — so they render through
 * `Unrecorded` rather than being quietly dropped. An absent measure that says
 * so is a fact; an absent measure left out entirely reads as a clean record.
 */

/* ==========================================================================
   Shared building blocks
   ========================================================================== */

function SectionCard({ icon, title, action = null, children }) {
  return <section className="section-card">
    <div className="section-card__head">
      <h3><Icon name={icon}/><span>{title}</span></h3>
      {action}
    </div>
    {children}
  </section>;
}

/**
 * A dated range rendered only at the precision the source recorded.
 *
 * "Present" is printed ONLY when a source actually said the role is ongoing.
 * A missing end date is not evidence of continuing — a research file that
 * records "End: NOT PUBLICLY VERIFIED" is saying it does not know, and
 * rendering that as "Present" would turn an admitted gap into a claim that
 * someone still holds a job they may have left decades ago.
 */
function Period({ start, end, ongoing = false }) {
  const { t } = useI18n();
  if (!start && !end) return <Unavailable>{t('common.datesNotRecorded')}</Unavailable>;
  const from = start ? formatDate(start) : t('person.unknown');
  const to = end ? formatDate(end) : ongoing ? t('person.present') : t('person.endNotRecorded');
  return <span className="entry__meta">{`${from} – ${to}`}</span>;
}

/**
 * The numbered section heading: a gold monospace number, the question the
 * section answers, and the plain-language version of that question.
 */
function SectionHeading({ number, title, question }) {
  return <div className="pf-sec__head">
    <span className="pf-sec__no" aria-hidden="true">{number}</span>
    <h2 className="pf-sec__title">{title}</h2>
    <p className="pf-sec__q">{question}</p>
  </div>;
}

/** A label on the left, whatever is known on the right — never a blank. */
function Row({ label, children }) {
  return <div className="pf-row">
    <dt className="pf-row__label">{label}</dt>
    <dd className="pf-row__value">{children}</dd>
  </div>;
}

/* ==========================================================================
   Role groupings
   ========================================================================== */

/**
 * Offices that carry a ministry, and therefore a budget somebody could audit.
 *
 * Wider than the old PORTFOLIO_ROLES set, which listed only four ranks and so
 * filed a Non-Cabinet Minister or a District Minister as though they had held
 * no portfolio at all. Each rank is still its own role type — see the notes on
 * RoleType — this set only asks the narrower question "was there a ministry".
 */
const EXECUTIVE_ROLES = new Set([
  RoleType.PRESIDENT, RoleType.PRIME_MINISTER, RoleType.CABINET_MINISTER,
  RoleType.STATE_MINISTER, RoleType.NON_CABINET_MINISTER, RoleType.DISTRICT_MINISTER,
  RoleType.PARLIAMENTARY_SECRETARY, RoleType.DEPUTY_MINISTER,
]);

/** The parliamentary seat itself — no ministry, so nothing to audit. */
const SEAT_ROLES = new Set([RoleType.MEMBER_OF_PARLIAMENT]);

/** Offices held inside the chamber, which count towards time in Parliament. */
const CHAMBER_ROLES = new Set([
  RoleType.MEMBER_OF_PARLIAMENT, RoleType.SPEAKER, RoleType.DEPUTY_SPEAKER,
  RoleType.OPPOSITION_LEADER, RoleType.PARLIAMENTARY_OFFICE,
]);

const AFFILIATION_ROLE_KEY = {
  member: 'affiliationMember', leader: 'affiliationLeader', 'deputy-leader': 'affiliationDeputyLeader',
  'general-secretary': 'affiliationGeneralSecretary', chairperson: 'affiliationChairperson',
  founder: 'affiliationFounder', other: 'affiliationOther',
};

/* ==========================================================================
   Derivations
   ========================================================================== */

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

/**
 * Whole years spent in the chamber, with overlapping terms merged.
 *
 * Summing each term independently double-counts, and does so badly: a member
 * who sat continuously while also holding a ministry has two overlapping
 * positions, and consecutive terms frequently abut. Merging the intervals
 * first is the difference between "15 yrs" and "40 yrs" for the same person.
 *
 * A term whose end nobody recorded is NOT treated as running to today — that
 * is the same mistake as printing "Present" for a missing end date. It is
 * excluded from the total and reported separately, so the figure understates
 * rather than invents.
 */
function chamberService(positions, today) {
  const seats = positions.filter(p => CHAMBER_ROLES.has(p.roleType));
  const spans = [];
  let unmeasured = 0;

  for (const position of seats) {
    const start = toSortKey(position.startDate);
    if (!Number.isFinite(start)) { unmeasured += 1; continue; }
    const end = position.endDate
      ? toLatestKey(position.endDate)
      : isCurrent(position, today) ? today.getTime() : null;
    if (end === null || !Number.isFinite(end) || end < start) { unmeasured += 1; continue; }
    spans.push([start, end]);
  }

  if (!spans.length) return { years: null, terms: seats.length, unmeasured, since: null };

  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [openStart, openEnd] = spans[0];
  for (const [start, end] of spans.slice(1)) {
    if (start <= openEnd) { openEnd = Math.max(openEnd, end); continue; }
    total += openEnd - openStart;
    [openStart, openEnd] = [start, end];
  }
  total += openEnd - openStart;

  const earliest = seats
    .map(p => p.startDate)
    .filter(Boolean)
    .sort((a, b) => toSortKey(a) - toSortKey(b))[0] ?? null;

  return {
    years: Math.max(0, Math.floor(total / MS_PER_YEAR)),
    terms: seats.length,
    unmeasured,
    since: earliest,
  };
}

/** The bare number for the fact strip — precision honest, never rounded up. */
function ageFigure(age) {
  if (!age) return null;
  if (age.duration.kind === 'exact') return String(age.duration.years);
  if (age.duration.kind === 'range') return `${age.duration.min}–${age.duration.max}`;
  return null;
}

/** "A", "A and B", "A, B and C" — for naming the sources a record cites. */
function formatList(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ==========================================================================
   Hero + fact strip
   ========================================================================== */

function ProfileHero({ view }) {
  const { t } = useI18n();
  const person = view.person;
  const headline = view.headline;
  const portrait = person.portrait;

  return <div className="profile-header__inner">
    <div className="profile-portrait">
      <Avatar name={person.canonicalName} portraitUrl={person.portrait?.url} size="lg" decorative={false}/>
      {/* Credit sits with the image, not buried in a sources list — an
          official portrait shown without attribution is the thing to avoid. */}
      {portrait?.credit && PORTRAIT_DISPLAY_POLICY.displayPortraits && PORTRAIT_DISPLAY_POLICY.showCredit ? (
        <p className="profile-portrait__credit">
          Portrait: {portrait.sourceId && safeExternalHref(getSource(portrait.sourceId)?.url)
            ? <a href={safeExternalHref(getSource(portrait.sourceId)?.url)} target="_blank" rel="noopener noreferrer">{portrait.credit}</a>
            : portrait.credit}
        </p>
      ) : null}
    </div>
    <div className="profile-header__text">
      <VerifiedBadge state={view.verification}/>
      <h1>{person.canonicalName}</h1>
      <p className="profile-header__role">
        {headline ? headline.title : <Unavailable>{t('common.officeNotRecorded')}</Unavailable>}
      </p>
      {/* The source's own spellings. Dropping them would lose the only clue
          that two differently-spelled records are the same person. */}
      {person.aliases.length
        ? <p className="pf-hero__aliases">{t('person.alsoRecordedAs', { names: person.aliases.join(' · ') })}</p>
        : null}
      <div className="chip-row">
        <Chip text={view.partyLabel} iconName="document"/>
        <Chip text={view.districtLabel} iconName="mapPin"/>
        {/* A former office-holder and a sitting member who happens to hold no
            portfolio are different things; one label for both would say neither. */}
        <Chip
          text={view.status === 'current' ? t('common.currentlyServing') : t('person.formerOfficeHolder')}
          iconName="clock"
          variant={view.status === 'current' ? null : 'muted'}
        />
      </div>
    </div>
  </div>;
}

function FactCell({ label, value, note, title = null }) {
  return <div className="pf-fact">
    <dt className="pf-fact__label">{label}</dt>
    <dd className="pf-fact__value" title={title ?? undefined}>
      {value}
      {note ? <small className="pf-fact__note">{note}</small> : null}
    </dd>
  </div>;
}

function FactStrip({ view, today }) {
  const { t } = useI18n();
  const person = view.person;
  const age = person.dateOfBirth ? deriveAge(person.dateOfBirth, person.dateOfDeath) : null;
  const ageText = ageFigure(age);
  const service = chamberService(view.positions, today);
  const executive = view.positions.filter(p => EXECUTIVE_ROLES.has(p.roleType));
  const currentCount = view.positions.filter(p => isCurrent(p, today)).length;

  const termsNote = [
    service.since ? t('person.factSince', { year: String(service.since).slice(0, 4) }) : null,
    service.terms
      ? t(service.terms === 1 ? 'person.factTerm' : 'person.factTerms', { count: service.terms })
      : null,
    service.unmeasured ? t('person.factUnmeasuredTerms', { count: service.unmeasured }) : null,
  ].filter(Boolean).join(' · ');

  return <dl className="pf-facts">
    <FactCell
      label={t('person.factAge')}
      value={ageText ?? <Unavailable/>}
      note={person.dateOfBirth ? t('person.factBorn', { date: formatDate(person.dateOfBirth) }) : null}
      // An age shown as a span is a precision statement, not a hedge — say so
      // rather than letting "45–46" look like sloppiness.
      title={age?.duration.kind === 'range'
        ? 'Approximate, because only part of the birth date is recorded'
        : null}
    />
    <FactCell
      label={t('person.factInParliament')}
      value={service.years === null ? <Unavailable/> : t('person.factYears', { count: service.years })}
      note={termsNote || null}
    />
    <FactCell
      label={t('person.factBeforePolitics')}
      value={person.profession ?? <Unavailable/>}
      note={person.profession ? null : t('person.factProfessionNote')}
    />
    <FactCell
      label={t('person.factPositionsOfPower')}
      value={String(view.positions.length)}
      note={t('person.factOfficeMix', { ministerial: executive.length, current: currentCount })}
    />
  </dl>;
}

/* ==========================================================================
   Record entries — shared by education, employment and service
   ========================================================================== */

/**
 * The <article class="entry"> shell shared by EducationEntry, EmploymentEntry
 * and ServiceEntry.
 *
 * Deliberately dumb: it takes already-rendered content (title, badge, org,
 * period, children), never raw row data or an `ongoing` boolean. Each entry
 * type keeps deciding for itself whether to pass Period an `ongoing` prop at
 * all - Education may legitimately be ongoing (row.completion === 'ongoing');
 * Employment and Service deliberately never pass it, because their source
 * does not say whether the role continues.
 */
function RecordEntry({ title, badge, org, period, children }) {
  return <article className="entry">
    <div className="entry__head">
      <h4 className="entry__title">{title}</h4>
      {badge}
    </div>
    {org}
    {period}
    {children}
  </article>;
}

function EducationEntry({ row }) {
  const { t } = useI18n();
  return <RecordEntry
    title={row.qualification ?? row.institution}
    badge={<VerifiedBadge state={row.claim.verification} compact/>}
    org={<>
      {row.institution ? <p className="entry__org">{row.institution}</p> : null}
      {row.field ? <p className="entry__org">{row.field}</p> : null}
      {row.stream ? <p className="entry__meta">{t('person.stream', { stream: row.stream })}</p> : null}
    </>}
    period={<Period start={row.startDate} end={row.endDate} ongoing={row.completion === 'ongoing'}/>}
  >
    {/* The source's exact words, kept beside Javora's reading of them. Shown
        only when they differ, so it informs rather than repeats. */}
    {row.sourceText && row.sourceText !== row.qualification
      ? <p className="entry__source-text">{t('person.recordedAs', { text: row.sourceText })}</p>
      : null}
  </RecordEntry>;
}

function EmploymentEntry({ row }) {
  return <RecordEntry
    title={row.role ?? row.organisation}
    badge={<VerifiedBadge state={row.claim.verification} compact/>}
    org={row.role ? <p className="entry__org">{row.organisation}</p> : null}
    // No `ongoing`: this source does not state whether the role continues.
    period={<Period start={row.startDate} end={row.endDate}/>}
  >
    {row.description ? <p className="entry__desc">{row.description}</p> : null}
  </RecordEntry>;
}

function ServiceEntry({ row }) {
  return <RecordEntry
    title={row.role ?? row.organisation}
    badge={<VerifiedBadge state={row.claim.verification} compact/>}
    org={row.role ? <p className="entry__org">{row.organisation}</p> : null}
    // No `ongoing`: this source does not state whether the role continues.
    period={<Period start={row.startDate} end={row.endDate}/>}
  />;
}

function GradeList({ results }) {
  return <div className="grade-list">
    {results.map(row => (
      <div className="grade-row" key={row.id}>
        <span className="grade-row__subject">{row.subject}</span>
        <span className="grade-row__grade">{row.grade}</span>
      </div>
    ))}
  </div>;
}

/**
 * A challenge to this person's mandate.
 *
 * Every word here is load-bearing. The heading says "under review", the body
 * says what the petition ASKS rather than what is true, and the outcome line
 * states plainly that no decision has been recorded. A reader skimming must
 * not be able to come away thinking a court has ruled.
 */
function LegalChallengeEntry({ row }) {
  const { t } = useI18n();
  const pending = row.outcome === 'pending';
  return <article className="entry entry--review">
    <div className="entry__head">
      <h4 className="entry__title">
        {row.challengeType === 'quo-warranto' ? t('person.writOfQuoWarranto') : row.challengeType}
      </h4>
      <span className="badge badge--review">
        <Icon name="clock"/><span>{pending ? t('person.underReview') : row.outcome}</span>
      </span>
    </div>
    {row.forum ? <p className="entry__org">{row.forum}</p> : null}
    {/* A filing is a point in time, not a range — "January 2025 – end not
        recorded" would imply the case has a duration nobody has stated. */}
    {row.filedOn ? <span className="entry__meta">{t('person.filed', { date: formatDate(row.filedOn) })}</span> : null}
    <p className="entry__desc">{row.claimSummary}</p>
    <p className="entry__desc">
      <strong>
        {pending
          ? t('person.noDecisionRecorded')
          : t('person.recordedOutcome', { outcome: row.outcome })}
      </strong>
    </p>
    {row.petitioner ? <p className="entry__meta">{t('person.broughtBy', { petitioner: row.petitioner })}</p> : null}
    <VerifiedBadge state={row.claim.verification} compact/>
  </article>;
}

/* ==========================================================================
   01 — Before politics
   ========================================================================== */

function BeforePolitics({ view }) {
  const { t } = useI18n();
  const person = view.person;
  const education = view.education ?? [];
  const exams = view.examResults ?? [];
  const employment = view.employment ?? [];
  const service = view.publicService ?? [];

  // An examination row is filed under school education by type, but belongs in
  // its own row - otherwise "G.C.E. A/L" renders as though it were a school.
  const byType = type => education.filter(e => e.educationType === type && !e.examLevel);
  const olExams = education.filter(e => e.examLevel === 'ol');
  const alExams = education.filter(e => e.examLevel === 'al');
  const olResults = exams.filter(e => e.examType === 'ol');
  const alResults = exams.filter(e => e.examType === 'al');
  const rows = list => list.map(row => <EducationEntry key={row.id} row={row}/>);

  return <div className="pf-cards">
    <section className="pf-card">
      <h3 className="pf-card__title">{t('person.education')}</h3>
      <dl className="pf-rows">
        <Row label={t('person.schoolEducation')}>
          {byType('school').length
            ? rows(byType('school'))
            : <Unrecorded why={t('person.noSchoolWhy')}>{t('person.noSchoolNamed')}</Unrecorded>}
        </Row>
        {/* Two different facts, never conflated: THAT the qualification is
            held, and WHAT was scored. Parliament states the first for some
            members; nobody publishes the second for anyone. */}
        <Row label={t('person.olHeading')}>
          {olExams.length ? <>
            {rows(olExams)}
            {olResults.length ? <GradeList results={olResults}/> : <NotVerified>{t('person.olNoResults')}</NotVerified>}
          </> : <NotVerified>{t('person.olNoQualification')}</NotVerified>}
        </Row>
        <Row label={t('person.alHeading')}>
          {alExams.length ? <>
            {rows(alExams)}
            {alResults.length ? <GradeList results={alResults}/> : <NotVerified>{t('person.alNoResults')}</NotVerified>}
          </> : <NotVerified>{t('person.alNoQualification')}</NotVerified>}
        </Row>
        <Row label={t('person.universityEducation')}>
          {byType('university').length
            ? rows(byType('university'))
            : <Unrecorded why={t('person.noUniversityWhy')}>{t('person.noUniversityDegree')}</Unrecorded>}
        </Row>
        <Row label={t('person.postgraduateEducation')}>
          {byType('postgraduate').length
            ? rows(byType('postgraduate'))
            : <Unrecorded>{t('person.noPostgraduate')}</Unrecorded>}
        </Row>
      </dl>
    </section>

    <section className="pf-card">
      <h3 className="pf-card__title">{t('person.workAndProfession')}</h3>
      <dl className="pf-rows">
        <Row label={t('person.profession')}>
          {person.profession ?? <Unrecorded why={t('person.factProfessionNote')}>{t('common.notRecorded')}</Unrecorded>}
        </Row>
        <Row label={t('person.professionalExperience')}>
          {employment.length
            ? employment.map(row => <EmploymentEntry key={row.id} row={row}/>)
            : <NotVerified>
                {t('person.noEmployment')}
                {person.profession ? t('person.noEmploymentWithProfession', { profession: person.profession }) : ''}
                {t('person.noEmploymentPoliticalNote')}
              </NotVerified>}
        </Row>
        <Row label={t('person.certifications')}>
          {byType('professional').length
            ? rows(byType('professional'))
            : <NotVerified>
                {t('person.noCredential')}
                {person.profession ? t('person.noCredentialWithProfession', { profession: person.profession }) : ''}
              </NotVerified>}
        </Row>
        <Row label={t('person.publicInstitutionalService')}>
          {service.length
            ? service.map(row => <ServiceEntry key={row.id} row={row}/>)
            : <NotVerified>{t('person.noServiceRecord')}</NotVerified>}
        </Row>
      </dl>
    </section>

    <section className="pf-card">
      <h3 className="pf-card__title">{t('person.politicalPartyHistory')}</h3>
      {view.affiliations.length
        ? <>
            {view.affiliations.map(affiliation => {
              const party = getParty(affiliation.partyId);
              return <article className="entry" key={affiliation.id}>
                <div className="entry__head">
                  <h4 className="entry__title">{party ? party.name : affiliation.partyId}</h4>
                  <EvidencePill evidence={evidenceFor(affiliation.claim)}/>
                </div>
                <p className="entry__org">
                  {t(`person.${AFFILIATION_ROLE_KEY[affiliation.role] ?? 'affiliationOther'}`)}
                  {party?.abbreviation ? ` · ${party.abbreviation}` : ''}
                </p>
                <Period start={affiliation.startDate} end={affiliation.endDate} ongoing/>
              </article>;
            })}
            <p className="entry__desc u-mt-4">{t('person.currentPartyNoJoinDate')}</p>
          </>
        : <NotVerified>{t('person.noPartyAffiliation')}</NotVerified>}
    </section>
  </div>;
}

/* ==========================================================================
   02 — What they were responsible for
   ========================================================================== */

function OfficeCard({ position, today, executive }) {
  const { t } = useI18n();
  const current = isCurrent(position, today);
  const future = !current && !position.endDate && isFuture(position.startDate, today);

  return <article className={executive ? 'pf-office pf-office--executive' : 'pf-office'}>
    <div className="pf-office__head">
      <h3 className="pf-office__name">
        {position.title}
        {current ? <> <CurrentBadge/></> : null}
        {future ? <> <span className="badge badge--review">{t('person.notYetAssumed')}</span></> : null}
      </h3>
      <span className="pf-office__tenure"><TenureValue position={position} today={today}/></span>
    </div>
    <p className="entry__org">{position.institution}</p>
    {position.ministry
      ? <p className="pf-office__scope">{t('person.scope', { ministry: position.ministry })}</p>
      : null}
    <div className="pf-office__foot">
      <span className="entry__meta">{roleTypeName(position.roleType)}</span>
      <EvidencePill evidence={evidenceFor(position.claim)}/>
    </div>
  </article>;
}

/**
 * Every parliamentary seat the person held, as ONE card.
 *
 * A re-elected member has four or five identical "Member of Parliament" rows,
 * and rendering each as its own card buries the ministries underneath a wall
 * of repetition. The tenures are all still listed — only the heading is
 * shared.
 */
function SeatCard({ positions, today }) {
  const { t } = useI18n();
  const anyCurrent = positions.some(p => isCurrent(p, today));

  return <article className="pf-office pf-office--seat">
    <div className="pf-office__head">
      <h3 className="pf-office__name">
        {positions[0].title}
        {anyCurrent ? <> <CurrentBadge/></> : null}
        <span className="pf-office__suffix">{t('person.noMinistrySuffix')}</span>
      </h3>
    </div>
    <p className="pf-office__scope">{t('person.seatScope')}</p>
    <ul className="pf-office__terms">
      {positions.map(position => <li key={position.id}>
        <TenureValue position={position} today={today}/>
        <EvidencePill evidence={evidenceFor(position.claim)}/>
      </li>)}
    </ul>
    <div className="pf-caveat">
      {t('person.seatCaveat')} <strong>{t('person.seatCaveatPending')}</strong>
    </div>
  </article>;
}

/**
 * The accountability measures, rendered exactly once and only for people who
 * actually ran a ministry.
 *
 * Per office would mean fourteen identical "not published" boxes on a career
 * minister's page — repetition that reads as an accusation rather than as the
 * gap it is. And a backbencher never controlled a ministry budget, so saying
 * "budget not published" on their page would answer a question nobody asked.
 */
function AccountabilityTiles() {
  const { t } = useI18n();
  const tiles = ['tileBudget', 'tileSpent', 'tileAudit'];
  return <section className="pf-measures">
    <h3 className="pf-card__title">{t('person.measuresTitle')}</h3>
    <div className="pf-tiles">
      {tiles.map(key => <div className="pf-tile" key={key}>
        <p className="pf-tile__label">{t(`person.${key}`)}</p>
        <p className="pf-tile__value"><Unrecorded>{t('person.tileNotPublished')}</Unrecorded></p>
      </div>)}
    </div>
    <NotVerified>{t('person.measuresWhy')}</NotVerified>
    <div className="pf-caveat">
      <strong>{t('person.measuresCaveatTitle')}</strong> {t('person.measuresCaveatBody')}
    </div>
  </section>;
}

function Responsibilities({ view, today }) {
  const { t } = useI18n();
  const challenges = view.legalChallenges ?? [];
  const ordered = sortPositions(view.positions, today);
  const seats = ordered.filter(p => SEAT_ROLES.has(p.roleType));
  const others = ordered.filter(p => !SEAT_ROLES.has(p.roleType));
  const hasExecutive = others.some(p => EXECUTIVE_ROLES.has(p.roleType));

  if (!view.positions.length) {
    return <NotVerified>{t('person.noCurrentOfficeRecorded')}</NotVerified>;
  }

  return <>
    <div className="pf-offices">
      {others.map(position => (
        <OfficeCard
          key={position.id}
          position={position}
          today={today}
          executive={EXECUTIVE_ROLES.has(position.roleType)}
        />
      ))}
      {seats.length ? <SeatCard positions={seats} today={today}/> : null}
    </div>

    {hasExecutive ? <AccountabilityTiles/> : null}
    {hasExecutive ? <p className="pf-note">{t('person.portfolioNote')}</p> : null}

    {challenges.length ? (
      <div className="u-mt-8">
        <SectionCard icon="alert" title={t('person.mandateUnderChallenge')}>
          {challenges.map(row => <LegalChallengeEntry key={row.id} row={row}/>)}
        </SectionCard>
      </div>
    ) : null}
  </>;
}

/* ==========================================================================
   03 — What nobody publishes
   ========================================================================== */

/**
 * The absences, stated as absences.
 *
 * Identical for every person on the site, and that is the point: these are
 * gaps in what Sri Lanka publishes, not gaps in one politician's record. A
 * reader who sees nothing here would reasonably conclude there was nothing to
 * find.
 */
function NotPublished({ view }) {
  const { t } = useI18n();
  const person = view.person;
  const items = [
    { key: 'discAssets', reason: 'discAssetsWhy' },
    { key: 'discFunding', reason: 'discFundingWhy' },
    { key: 'discElections', reason: 'discElectionsWhy', why: t('person.noElectionRecords') },
    { key: 'discCourt', reason: 'discCourtWhy' },
    { key: 'discGrades', reason: 'discGradesWhy', why: t('person.olNoResults') },
    { key: 'discEvents', reason: 'discEventsWhy', why: t('person.noTimelineEvents') },
    { key: 'discPlaceOfBirth', reason: 'discPlaceOfBirthWhy' },
  ];

  // Only claimed as missing when it actually is: a record that carries a
  // Sinhala or Tamil name must not appear in a list of things nobody publishes.
  if (!person.names.si && !person.names.ta) {
    items.push({ key: 'discNames', reason: 'discNamesWhy' });
  }

  return <>
    <dl className="pf-card pf-disclosure">
      {items.map(item => <div className="pf-disclosure__row" key={item.key}>
        <dt title={item.why ?? undefined}>{t(`person.${item.key}`)}</dt>
        <dd>{t(`person.${item.reason}`)}</dd>
      </div>)}
    </dl>
    <p className="pf-note">{t('person.disclosureNotePre')} <strong>{t('person.disclosureNoteBold')}</strong> {t('person.disclosureNotePost')}</p>
  </>;
}

/* ==========================================================================
   04 — Go deeper
   ========================================================================== */

function SourcesCard({ view }) {
  const { t } = useI18n();
  const cited = sourcesCitedBy(view);
  return <SectionCard icon="shield" title={t('person.sourcesAndVerification')}>
    {cited.length
      ? <>
          {cited.map(({ sourceId, count }) => {
            const source = getSource(sourceId);
            if (!source) return null;
            const sync = SYNC_PRESENTATION[source.syncState] ?? SYNC_PRESENTATION['not-connected'];
            const checked = source.lastCheckedAt ? formatDate(source.lastCheckedAt.slice(0, 10), 'short') : null;
            const sourceHref = safeExternalHref(source.url);
            return <article className="entry" key={sourceId}>
              <div className="entry__head">
                <h4 className="entry__title">
                  <span className="source-card__id">{source.id}</span> {source.name}
                </h4>
                {sourceHref
                  ? <a className="btn btn--secondary btn--sm" href={sourceHref} target="_blank" rel="noopener noreferrer">
                      <span>{t('person.visit')}</span><Icon name="external"/>
                    </a>
                  : null}
              </div>
              <p className="entry__org">{source.institution}</p>
              <p className="entry__meta">
                {count === 1 ? t('person.itemCount', { count }) : t('person.itemCountPlural', { count })} · {sync.label} · {checked ? t('person.syncRetrieved', { date: checked }) : t('person.syncNotYetRetrieved')}
              </p>
            </article>;
          })}
          <p className="divider-note">
            <Icon name="info"/><span>{t('common.somethingInaccurate')} </span><a href="/corrections">{t('common.reportError')}</a>
          </p>
        </>
      : <NotVerified>{t('person.noInstitutionalSource')}</NotVerified>}
  </SectionCard>;
}

function GoDeeper({ view }) {
  const { t } = useI18n();
  // The count is derived from what this record actually holds. The structurally
  // empty arrays are excluded rather than padding the figure with zeroes.
  const records = view.positions.length
    + (view.education?.length ?? 0)
    + (view.affiliations?.length ?? 0)
    + (view.legalChallenges?.length ?? 0);

  return <>
    <div className="pf-deeper">
      <h3 className="pf-deeper__title">{t('person.goDeeperTitle')}</h3>
      <p className="pf-deeper__body">{t('person.goDeeperBody', { count: records })}</p>
      <p className="pf-deeper__body">{t('person.whereFromBody1')}</p>
      <p className="pf-deeper__body">{t('person.whereFromBody2')}</p>
    </div>

    <div className="u-mt-8"><SourcesCard view={view}/></div>

    <div className="profile-status">
      <span className="profile-status__item">
        <Icon name="info"/>
        <span>{t('person.profileStatusLabel')}: <strong>{view.verification === 'source-linked' ? 'Source-linked' : view.verification}</strong>{t('person.profileStatusBody')}</span>
      </span>
      <span className="profile-status__item">
        <Icon name="refresh"/>
        <span>{t('person.lastRetrieved', { date: formatDate(view.person.updatedAt?.slice(0, 10)) ?? t('common.notRecorded') })}</span>
      </span>
    </div>
  </>;
}

/* ==========================================================================
   Page
   ========================================================================== */

/**
 * Rendered ONLY for slug "harsha-de-silva" — see PersonPage.jsx, which is the
 * component actually wired to the /person/:slug route and owns the branch.
 * Every other profile keeps rendering PersonPage's own tabbed layout.
 */
export default function PersonDecisionPage({ slug }) {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const view = React.useMemo(() => getPersonBySlug(slug, today), [slug, today]);
  const demonstration = DATASET.mode === 'demonstration';

  /*
    Which sources this particular record actually cites.

    The notice below used to assert that every fact came from 'this member's own
    page in the official Parliament of Sri Lanka Directory of Members'. True for
    sitting members; false for the 1,398 people who come from the Past Members
    directory, and false for the President and Cabinet ministers, who come from
    the Cabinet Office. Deriving it from sourcesCitedBy() makes the sentence
    right for whichever record is on screen, and keeps it right when another
    source is connected.
  */
  const citedSourceNames = React.useMemo(() => {
    if (!view) return [];
    return sourcesCitedBy(view)
      .map(({ sourceId }) => getSource(sourceId))
      .filter(Boolean)
      .map(source => source.name);
  }, [view]);

  // Metadata comes from the shared definition rather than being rebuilt here,
  // so the prerendered <head> a crawler reads and the one this page sets after
  // hydration are the same by construction, not by two people remembering to
  // edit both.
  React.useEffect(() => { applyPageMeta(personMeta(slug)); }, [view, slug]);

  return <>
    <header className="profile-header">
      <div className="container">
        <div className="profile-header__nav"><ActionLink label={t('person.backToDirectory')} href="/directory" back/></div>
        {view ? <ProfileHero view={view}/> : <h1>{t('person.recordNotFound')}</h1>}
      </div>
    </header>

    <section className="section section--tight">
      <div className="container">
        {!view
          ? <EmptyState
              iconName="slash"
              title={t('person.noRecordTitle')}
              message={t('person.noRecordMessage', { slug })}
              action={<a className="btn btn--primary" href="/directory">{t('common.browseDirectory')}</a>}
            />
          : <>
              <FactStrip view={view} today={today}/>

              <div className="u-mb-8 u-mt-8">
                {demonstration ? <Notice
                  tone="warning" iconName="alert" title={t('person.demoNoticeTitle')}
                  body={[t('person.demoNoticeBody')]}
                /> : <Notice
                  tone="info" iconName="info" title={t('person.sourceLinkedNoticeTitle')}
                  body={[
                    citedSourceNames.length
                      ? t('person.sourceLinkedBodyWithSources', {
                          sources: formatList(citedSourceNames),
                          sourcesPhrase: citedSourceNames.length === 1 ? t('person.thatSource') : t('person.thoseSources'),
                        })
                      : t('person.sourceLinkedBodyNoSources'),
                  ]}
                />}
              </div>

              <section className="pf-sec" aria-labelledby="pf-s01">
                <SectionHeading number="01" title={<span id="pf-s01">{t('person.s01Title')}</span>} question={t('person.s01Question')}/>
                <BeforePolitics view={view}/>
              </section>

              <section className="pf-sec" aria-labelledby="pf-s02">
                <SectionHeading number="02" title={<span id="pf-s02">{t('person.s02Title')}</span>} question={t('person.s02Question')}/>
                <Responsibilities view={view} today={today}/>
              </section>

              <section className="pf-sec" aria-labelledby="pf-s03">
                <SectionHeading number="03" title={<span id="pf-s03">{t('person.s03Title')}</span>} question={t('person.s03Question')}/>
                <NotPublished view={view}/>
              </section>

              <section className="pf-sec" aria-labelledby="pf-s04">
                <SectionHeading number="04" title={<span id="pf-s04">{t('person.s04Title')}</span>} question={t('person.s04Question')}/>
                <GoDeeper view={view}/>
              </section>
            </>}
      </div>
    </section>
  </>;
}
