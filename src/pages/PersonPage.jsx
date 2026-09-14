import React from 'react';
import { Icon } from '../lib/icons.jsx';
import {
  Avatar, VerifiedBadge, Chip, CurrentBadge, EvidencePill, Notice, EmptyState,
  ActionLink, Unavailable, Unrecorded, NotVerified, TenureValue, AgeValue, StatusTag, VitalStatusTag,
} from '../components/Primitives.jsx';
import { Tabs, TabPanel } from '../components/Tabs.jsx';
import {
  DATASET, getPersonBySlug, getSource, evidenceFor, sourcesCitedBy, getParty,
} from '../services/repository.ts';
import { SYNC_PRESENTATION } from '../data/sources.ts';
import { formatDate, deriveAge } from '../lib/date.ts';
import { isCurrent, isFuture } from '../lib/positions.ts';
import { roleTypeName } from '../data/roles.ts';
import { RoleType } from '../types/models.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { personMeta } from '../lib/pageMeta.ts';
import { replaceSearch } from '../lib/router.tsx';
import { tabFromSearch, searchForTab } from '../lib/profileTabs.ts';
import { PORTRAIT_DISPLAY_POLICY } from '../data/portraitPolicy.ts';
import { safeExternalHref } from '../lib/externalUrl.ts';
import { useI18n } from '../lib/i18n.jsx';
import { getProfileContent } from '../data/profileContent.ts';
import { recordProfileVisit } from '../lib/recentProfiles.ts';
import { useDirectoryReturnHref } from '../lib/directoryReturn.ts';
import PortfolioProfile from './PortfolioProfile.jsx';

/* ==========================================================================
   Shared building blocks
   ========================================================================== */

/**
 * `<h2>`, not `<h3>`.
 *
 * Every profile is `<h1>` the person's name, and these are the record's
 * top-level sections under it — but they were marked up two levels down, so
 * all 1,623 profiles shipped an outline of h1 → h3 → h4 with no h2 anywhere
 * except the footer. Heading level is how a screen-reader user navigates a
 * long document, and on this site's principal page type the ladder had its
 * second rung missing. Nothing about the SIZE of these headings changed: the
 * `.section-card__head` rule that styles them now matches both elements, so
 * the visual hierarchy is exactly what it was and only the semantics were
 * corrected. Entry titles inside a section moved h4 → h3 to match.
 */
function SectionCard({ icon, title, action = null, children }) {
  return <section className="section-card">
    <div className="section-card__head">
      <h2><Icon name={icon}/><span>{title}</span></h2>
      {action}
    </div>
    {children}
  </section>;
}

/**
 * The profile's way back to the register.
 *
 * Renders the plain `/directory` in the prerendered HTML and adopts the
 * reader's own last view of the directory once hydrated — see
 * lib/directoryReturn.ts for why that is a session-scoped memory rather than
 * something encoded in this page's URL.
 */
function BackToDirectory() {
  const { t } = useI18n();
  return <div className="profile-header__nav">
    <ActionLink label={t('person.backToDirectory')} href={useDirectoryReturnHref()} back/>
  </div>;
}

function Subsection({ icon, title, badge = null, children }) {
  return <div className="subsection">
    <div className="subsection__head">
      <span className="subsection__title">{icon ? <Icon name={icon}/> : null}<span>{title}</span></span>
      {badge}
    </div>
    {children}
  </div>;
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
export function Period({ start, end, ongoing = false }) {
  const { t } = useI18n();
  if (!start && !end) return <Unavailable>{t('common.datesNotRecorded')}</Unavailable>;
  const from = start ? formatDate(start) : t('person.unknown');
  const to = end ? formatDate(end) : ongoing ? t('person.present') : t('person.endNotRecorded');
  return <span className="entry__meta">{`${from} – ${to}`}</span>;
}

/* ==========================================================================
   Profile header
   ========================================================================== */

function ProfileHeader({ view, today }) {
  const { t } = useI18n();
  const person = view.person;
  const headline = view.headline;
  const age = person.dateOfBirth ? deriveAge(person.dateOfBirth, person.dateOfDeath) : null;

  const portrait = person.portrait;
  const currentOfficeCount = view.positions.filter(p => isCurrent(p, today)).length;

  return <div className="profile-header__inner">
    <div className="profile-portrait">
      <Avatar name={view.person.canonicalName} portraitUrl={view.person.portrait?.url} size="lg" decorative={false}/>
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
      {/* Status leads the header, above the name's own line of metadata.
          "Is this person in office now?" is the first thing a reader needs
          from a political record and it used to be the third chip in a row
          of three identical ones, after party and district. */}
      <div className="profile-header__status">
        <StatusTag status={view.status}/>
        <VitalStatusTag vitalStatus={view.vitalStatus}/>
      </div>
      <h1>{person.canonicalName}</h1>
      <p className="profile-header__role">
        {headline ? headline.title : <Unavailable>{t('common.officeNotRecorded')}</Unavailable>}
      </p>
      <div className="chip-row">
        <Chip text={view.partyLabel} iconName="document"/>
        <Chip text={view.districtLabel} iconName="mapPin"/>
      </div>

      {/* Deliberately only three facts: the header stays scannable, and
          everything else belongs in the Official Overview below. */}
      <div className="profile-facts">
        <div className="profile-fact">
          <Icon name="calendar"/>
          <div>
            <p className="profile-fact__label">{t('person.born')}</p>
            <p className="profile-fact__value">
              {person.dateOfBirth
                ? <>{formatDate(person.dateOfBirth)}{age ? <AgeValue age={age}/> : null}</>
                : <Unavailable/>}
            </p>
          </div>
        </div>
        <div className="profile-fact">
          <Icon name="mapPin"/>
          <div>
            <p className="profile-fact__label">{t('person.district')}</p>
            <p className="profile-fact__value">{view.districtLabel ?? <Unavailable/>}</p>
          </div>
        </div>
        <div className="profile-fact">
          <Icon name="building"/>
          <div>
            <p className="profile-fact__label">{t('person.currently')}</p>
            <p className="profile-fact__value">
              {currentOfficeCount === 1
                ? t('person.recordedOffice', { count: currentOfficeCount })
                : t('person.recordedOffices', { count: currentOfficeCount })}
            </p>
          </div>
        </div>
        {/* How current is this? — answered at the top of the record rather
            than in a status line under 1,200px of page. */}
        <div className="profile-fact">
          <Icon name="refresh"/>
          <div>
            <p className="profile-fact__label">{t('person.lastCheckedLabel')}</p>
            <p className="profile-fact__value">
              {person.updatedAt ? formatDate(person.updatedAt.slice(0, 10)) : <Unavailable/>}
            </p>
          </div>
        </div>
      </div>

      {/*
        Corrections are the site's whole answer to "what if this is wrong",
        and they lived on a page reachable from the footer and from one line
        at the very bottom of the profile. From here the reporter arrives
        with the record already chosen (`?person=` is read by
        CorrectionsPage) instead of re-finding this person in a list of
        1,623. Rendered as a quiet tertiary link, not a call to action: most
        readers are not reporting anything.
      */}
      <p className="profile-header__actions">
        <a className="profile-header__correct" href={`/corrections?person=${encodeURIComponent(person.slug)}`}>
          <Icon name="alert"/><span>{t('person.suggestCorrection')}</span>
        </a>
      </p>
    </div>
  </div>;
}

/* ==========================================================================
   Official overview
   ========================================================================== */

function Field({ label, value }) {
  return <div><dt>{label}</dt><dd>{value ?? <Unavailable/>}</dd></div>;
}

function OfficialOverview({ view }) {
  const { t } = useI18n();
  const person = view.person;
  return <SectionCard icon="user" title={t('person.officialOverview')}>
    <dl className="def-grid">
      <Field label={t('person.fullName')} value={person.canonicalName}/>
      <Field
        label={t('person.knownAs')}
        value={person.aliases.length ? person.aliases.join(' · ') : <Unavailable>{t('common.noneRecorded')}</Unavailable>}
      />
      <Field label={t('person.dateOfBirth')} value={person.dateOfBirth ? formatDate(person.dateOfBirth) : null}/>
      <Field label={t('person.placeOfBirth')} value={null}/>
      <Field label={t('person.profession')} value={person.profession}/>
      <Field label={t('person.politicalParty')} value={view.partyLabel}/>
      <Field label={t('person.district2')} value={view.districtLabel}/>
      <Field label={t('person.currentPrimaryRole')} value={view.headline ? view.headline.title : <Unavailable>{t('person.noCurrentOffice')}</Unavailable>}/>
      <Field
        label={t('person.namesInSinhalaTamil')}
        value={person.names.si || person.names.ta
          ? <>
              {person.names.si && <span lang="si">{person.names.si}</span>}
              {person.names.si && person.names.ta && ' · '}
              {person.names.ta && <span lang="ta">{person.names.ta}</span>}
            </>
          : <Unavailable>{t('person.notPublishedEnglishSources')}</Unavailable>}
      />
    </dl>
  </SectionCard>;
}

/* ==========================================================================
   TAB 1 — Education & Career
   ========================================================================== */

/**
 * The education sections render from `view.education`, `view.examResults`,
 * `view.employment` and `view.publicService`. Those arrays are currently
 * empty for every person, and the sections say so explicitly rather than
 * collapsing — see each `NotVerified` message for the specific reason.
 */
function EducationCareerTab({ view }) {
  const { t } = useI18n();
  const education = view.education ?? [];
  const exams = view.examResults ?? [];
  const employment = view.employment ?? [];
  const service = view.publicService ?? [];
  const person = view.person;

  // An examination row is filed under school education by type, but belongs in
  // its own section - otherwise "G.C.E. A/L" renders as though it were a school.
  const byType = type => education.filter(e => e.educationType === type && !e.examLevel);
  const schools = byType('school');
  const olExams = education.filter(e => e.examLevel === 'ol');
  const alExams = education.filter(e => e.examLevel === 'al');
  const olResults = exams.filter(e => e.examType === 'ol');
  const alResults = exams.filter(e => e.examType === 'al');

  return <div className="profile-grid">
    <div className="profile-col">
      <SectionCard icon="bookOpen" title={t('person.education')}>
        <Subsection icon="building" title={t('person.schoolEducation')}>
          {schools.length
            ? schools.map(row => <EducationEntry key={row.id} row={row}/>)
            : <Unrecorded why={t('person.noSchoolWhy')}>{t('person.noSchoolNamed')}</Unrecorded>}
        </Subsection>

        <Subsection icon="award" title={t('person.olHeading')}>
          {/* Two different facts, never conflated: THAT the qualification is
              held, and WHAT was scored. Parliament states the first for some
              members; nobody publishes the second for anyone. */}
          {olExams.length ? <>
            {olExams.map(row => <EducationEntry key={row.id} row={row}/>)}
            {olResults.length
              ? <GradeList results={olResults}/>
              : <NotVerified>{t('person.olNoResults')}</NotVerified>}
          </> : <NotVerified>{t('person.olNoQualification')}</NotVerified>}
        </Subsection>

        <Subsection icon="award" title={t('person.alHeading')}>
          {alExams.length ? <>
            {alExams.map(row => <EducationEntry key={row.id} row={row}/>)}
            {alResults.length
              ? <GradeList results={alResults}/>
              : <NotVerified>{t('person.alNoResults')}</NotVerified>}
          </> : <NotVerified>{t('person.alNoQualification')}</NotVerified>}
        </Subsection>

        <Subsection icon="bookOpen" title={t('person.universityEducation')}>
          {byType('university').length
            ? byType('university').map(row => <EducationEntry key={row.id} row={row}/>)
            : <Unrecorded why={t('person.noUniversityWhy')}>{t('person.noUniversityDegree')}</Unrecorded>}
        </Subsection>

        <Subsection icon="award" title={t('person.postgraduateEducation')}>
          {byType('postgraduate').length
            ? byType('postgraduate').map(row => <EducationEntry key={row.id} row={row}/>)
            : <Unrecorded>{t('person.noPostgraduate')}</Unrecorded>}
        </Subsection>
      </SectionCard>

      <SectionCard icon="shieldCheck" title={t('person.certifications')}>
        {byType('professional').length
          ? byType('professional').map(row => <EducationEntry key={row.id} row={row}/>)
          : <NotVerified>
              {t('person.noCredential')}
              {person.profession ? t('person.noCredentialWithProfession', { profession: person.profession }) : ''}
            </NotVerified>}
      </SectionCard>
    </div>

    <div className="profile-col">
      <SectionCard icon="building" title={t('person.professionalExperience')}>
        {employment.length
          ? employment.map(row => <EmploymentEntry key={row.id} row={row}/>)
          : <NotVerified>
              {t('person.noEmployment')}
              {person.profession ? t('person.noEmploymentWithProfession', { profession: person.profession }) : ''}
              {t('person.noEmploymentPoliticalNote')}
            </NotVerified>}
      </SectionCard>

      <SectionCard icon="users" title={t('person.publicInstitutionalService')}>
        {service.length
          ? service.map(row => <ServiceEntry key={row.id} row={row}/>)
          : <NotVerified>{t('person.noServiceRecord')}</NotVerified>}
      </SectionCard>

      <SectionCard icon="info" title={t('person.whereFrom')}>
        <p className="entry__desc">{t('person.whereFromBody1')}</p>
        <p className="entry__desc">{t('person.whereFromBody2')}</p>
        <p className="entry__desc">{t('person.whereFromBody3')}</p>
      </SectionCard>
    </div>
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
      <h3 className="entry__title">
        {row.challengeType === 'quo-warranto' ? t('person.writOfQuoWarranto') : row.challengeType}
      </h3>
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

/**
 * The <article class="entry"> shell shared by EducationEntry, EmploymentEntry
 * and ServiceEntry.
 *
 * Deliberately dumb: it takes already-rendered content (title, badge, org,
 * period, children), never raw row data or an `ongoing` boolean. Each entry
 * type keeps deciding for itself whether to pass Period an `ongoing` prop at
 * all - Education may legitimately be ongoing (row.completion === 'ongoing');
 * Employment and Service deliberately never pass it, because their source
 * does not say whether the role continues. Collapsing that decision into a
 * flag on this shell is exactly what the audit this refactor follows warns
 * against: a boolean prop makes the distinction trivial to get wrong
 * silently, and the src/lib/endNotRecorded.test.ts suite exists specifically
 * to catch a "Present" leaking out of an unrecorded end.
 */
function RecordEntry({ title, badge, org, period, children }) {
  return <article className="entry">
    <div className="entry__head">
      <h3 className="entry__title">{title}</h3>
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

/* ==========================================================================
   TAB 2 — Political Career
   ========================================================================== */

const AFFILIATION_ROLE_KEY = {
  member: 'affiliationMember', leader: 'affiliationLeader', 'deputy-leader': 'affiliationDeputyLeader',
  'general-secretary': 'affiliationGeneralSecretary', chairperson: 'affiliationChairperson',
  founder: 'affiliationFounder', other: 'affiliationOther',
};

const EVENT_TYPE_KEY = {
  elected: 'eventElected', appointed: 'eventAppointed', 'assumed-office': 'eventAssumedOffice',
  resigned: 'eventResigned', removed: 'eventRemoved', dismissed: 'eventDismissed',
  reappointed: 'eventReappointed', 'ceased-office': 'eventCeasedOffice',
  'acting-appointment': 'eventActingAppointment', 'caretaker-appointment': 'eventCaretakerAppointment',
};

/** Ministerial offices — the ones that constitute a "portfolio". */
const PORTFOLIO_ROLES = new Set([
  RoleType.PRIME_MINISTER, RoleType.CABINET_MINISTER,
  RoleType.STATE_MINISTER, RoleType.DEPUTY_MINISTER,
]);

function PositionEntry({ position, today, showMinistry = false }) {
  const { t } = useI18n();
  const current = isCurrent(position, today);
  const future = !current && !position.endDate && isFuture(position.startDate, today);
  return <article className="entry">
    <div className="entry__head">
      <h3 className="entry__title">
        {position.title}
        {current ? <> <CurrentBadge/></> : null}
        {future ? <> <span className="badge badge--review">{t('person.notYetAssumed')}</span></> : null}
      </h3>
      <EvidencePill evidence={evidenceFor(position.claim)}/>
    </div>
    <p className="entry__org">{position.institution}</p>
    {showMinistry && position.ministry
      ? <p className="entry__org">{t('person.portfolio', { ministry: position.ministry })}</p>
      : null}
    <p className="entry__meta">{roleTypeName(position.roleType)}</p>
    <div className="u-mt-2"><TenureValue position={position} today={today}/></div>
  </article>;
}

function PoliticalCareerTab({ view, today }) {
  const { t } = useI18n();
  const current = view.positions.filter(p => isCurrent(p, today));
  const past = view.positions.filter(p => !isCurrent(p, today));
  const portfolios = current.filter(p => PORTFOLIO_ROLES.has(p.roleType));
  const challenges = view.legalChallenges ?? [];
  const parliamentary = view.positions.filter(
    p => p.roleType === RoleType.MEMBER_OF_PARLIAMENT
      || p.roleType === RoleType.SPEAKER
      || p.roleType === RoleType.DEPUTY_SPEAKER
      || p.roleType === RoleType.PARLIAMENTARY_OFFICE
      || p.roleType === RoleType.OPPOSITION_LEADER,
  );

  return <div className="profile-grid">
    <div className="profile-col">
      <SectionCard icon="building" title={t('person.currentPoliticalPositions')}>
        {current.length
          ? current.map(p => <PositionEntry key={p.id} position={p} today={today}/>)
          : <NotVerified>{t('person.noCurrentOfficeRecorded')}</NotVerified>}
      </SectionCard>

      <SectionCard icon="layers" title={t('person.currentPortfolios')}>
        {portfolios.length
          ? <>
              {portfolios.map(p => <PositionEntry key={p.id} position={p} today={today} showMinistry/>)}
              <p className="entry__desc u-mt-4">{t('person.portfolioNote')}</p>
            </>
          : <NotVerified>{t('person.noPortfolio')}</NotVerified>}
      </SectionCard>

      <SectionCard icon="archive" title={t('person.politicalCareerHistory')}>
        {past.length
          ? past.map(p => <PositionEntry key={p.id} position={p} today={today} showMinistry/>)
          : <NotVerified>{t('person.noPreviousOffice')}</NotVerified>}
      </SectionCard>

      <SectionCard icon="users" title={t('person.parliamentaryHistory')}>
        {parliamentary.length
          ? parliamentary.map(p => <PositionEntry key={p.id} position={p} today={today}/>)
          : <NotVerified>{t('person.noParliamentaryService')}</NotVerified>}
      </SectionCard>
    </div>

    <div className="profile-col">
      <SectionCard icon="document" title={t('person.politicalPartyHistory')}>
        {view.affiliations.length
          ? <>
              {view.affiliations.map(affiliation => {
                const party = getParty(affiliation.partyId);
                return <article className="entry" key={affiliation.id}>
                  <div className="entry__head">
                    <h3 className="entry__title">{party ? party.name : affiliation.partyId}</h3>
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
      </SectionCard>

      <SectionCard icon="layers" title={t('person.electionHistory')}>
        <NotVerified>{t('person.noElectionRecords')}</NotVerified>
      </SectionCard>

      <SectionCard icon="calendar" title={t('person.politicalTimeline')}>
        {view.events.length
          ? <ol className="timeline">{view.events.map(event => (
              <li key={event.id} className="timeline__item">
                <span className="timeline__dot" aria-hidden="true"></span>
                <div className="timeline__head">
                  <time className="timeline__date" dateTime={event.eventDate}>{formatDate(event.eventDate)}</time>
                  <EvidencePill evidence={evidenceFor(event.claim)}/>
                </div>
                <h3 className="timeline__title">{event.title}</h3>
                <p className="timeline__type">{t(`person.${EVENT_TYPE_KEY[event.eventType] ?? 'eventRecord'}`)}</p>
                {event.description ? <p className="timeline__desc">{event.description}</p> : null}
              </li>
            ))}</ol>
          : <NotVerified>{t('person.noTimelineEvents')}</NotVerified>}
      </SectionCard>

      {challenges.length ? (
        <SectionCard icon="alert" title={t('person.mandateUnderChallenge')}>
          {challenges.map(row => <LegalChallengeEntry key={row.id} row={row}/>)}
        </SectionCard>
      ) : null}

      <SourcesCard view={view}/>
    </div>
  </div>;
}

/* ==========================================================================
   Sources
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
                <h3 className="entry__title">
                  <span className="source-card__id">{source.id}</span> {source.name}
                </h3>
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

/* ==========================================================================
   Page
   ========================================================================== */

/** "A", "A and B", "A, B and C" — for naming the sources a record cites. */
function formatList(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A person's profile renders one of two layouts. `profileContent.ts` maps a
 * slug to hand-built portfolio content for the small set of profiles that
 * have one (currently just Harsha de Silva); every other slug keeps the
 * tabbed layout below, completely unaffected. Every link to a mapped person
 * — search, directory card, direct URL — resolves to this same /person/:slug
 * route, so branching here is enough to cover all of them. Kept as a plain
 * dispatch, rather than an early return inside a single component, so
 * neither branch calls hooks conditionally.
 */
export default function PersonPage({ slug, route }) {
  const content = getProfileContent(slug);
  if (content) return <PortfolioPersonPage slug={slug} content={content}/>;
  return <TabbedPersonPage slug={slug} route={route}/>;
}

/**
 * Wraps `PortfolioProfile` with the site's usual profile-page furniture — the
 * "Back to Directory" affordance and the shared `personMeta` title/canonical
 * — so a portfolio profile looks and behaves like any other person page from
 * outside its own content. Exported so the retired /politician/harsha-de-silva
 * route (App.jsx) can render the exact same thing.
 */
export function PortfolioPersonPage({ slug, content }) {
  // No `useI18n` here any more: the one translated string this component had
  // was the back link's label, and that moved into `BackToDirectory` along
  // with the destination it needs to resolve.
  const view = React.useMemo(() => getPersonBySlug(slug), [slug]);

  // Same shared metadata definition the tabbed layout uses, so this profile
  // gets the same canonical tag and structured data as every other person —
  // see the comment on the equivalent effect in TabbedPersonPage below.
  React.useEffect(() => { applyPageMeta(personMeta(slug)); }, [view, slug]);
  React.useEffect(() => {
    if (view) recordProfileVisit(view.person.slug, view.person.canonicalName);
  }, [view]);

  return <>
    <header className="profile-header">
      <div className="container">
        <BackToDirectory/>
      </div>
    </header>
    <PortfolioProfile content={content}/>
  </>;
}

function TabbedPersonPage({ slug, route }) {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const view = React.useMemo(() => getPersonBySlug(slug, today), [slug, today]);
  const demonstration = DATASET.mode === 'demonstration';

  const TABS = [
    { id: 'education', label: t('person.tabEducation'), icon: 'bookOpen' },
    { id: 'political', label: t('person.tabPolitical'), icon: 'building' },
  ];

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

  /**
   * Tab state lives in the query string so a profile tab can be linked and
   * survives reload — but with `replaceSearch`, not a push, so switching tabs
   * does not fill the back button with history entries the reader has to
   * click through to leave the page.
   */
  const active = tabFromSearch(route?.search);
  const setTab = id => replaceSearch(searchForTab(id));

  // Metadata comes from the shared definition rather than being rebuilt here,
  // so the prerendered <head> a crawler reads and the one this page sets after
  // hydration are the same by construction, not by two people remembering to
  // edit both.
  React.useEffect(() => { applyPageMeta(personMeta(slug)); }, [view, slug]);
  React.useEffect(() => {
    if (view) recordProfileVisit(view.person.slug, view.person.canonicalName);
  }, [view]);

  return <>
    <header className="profile-header">
      <div className="container">
        <BackToDirectory/>
        {view ? <ProfileHeader view={view} today={today}/> : <h1>{t('person.recordNotFound')}</h1>}
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
              {/*
                The same two claims, one level of disclosure apart.

                A demonstration record keeps the full warning block: that one
                must not be possible to skim past. The ordinary case — 99% of
                records — used to open every profile with a four-line grey
                box explaining the difference between "source-linked" and
                "verified" before the reader reached a single fact about the
                person. The headline sentence still states it outright, and
                the full explanation, including WHICH sources this particular
                record cites, is one click away and still in the prerendered
                HTML. Nothing is softened: "not verified" is in the summary
                line itself.
              */}
              <div className="u-mb-8">
                {demonstration ? <Notice
                  tone="warning" iconName="alert" title={t('person.demoNoticeTitle')}
                  body={[t('person.demoNoticeBody')]}
                /> : <div className="trust-bar">
                  <span className="trust-bar__mark" aria-hidden="true"><Icon name="link"/></span>
                  <div className="trust-bar__body">
                    <p className="trust-bar__headline">
                      <strong>{t('person.sourceLinkedNoticeTitle')}</strong>
                      <span> — {t('person.sourceLinkedSummary')}</span>
                    </p>
                    <details className="trust-bar__details">
                      <summary>{t('person.whatThisMeans')}</summary>
                      <p>
                        {citedSourceNames.length
                          ? t('person.sourceLinkedBodyWithSources', {
                              sources: formatList(citedSourceNames),
                              sourcesPhrase: citedSourceNames.length === 1 ? t('person.thatSource') : t('person.thoseSources'),
                            })
                          : t('person.sourceLinkedBodyNoSources')}
                      </p>
                    </details>
                  </div>
                </div>}
              </div>

              <div className="u-mb-8"><OfficialOverview view={view}/></div>

              <div className="u-mb-8">
                <Tabs
                  tabs={TABS}
                  active={active}
                  onChange={setTab}
                  label={t('person.profileSections', { name: view.person.canonicalName })}
                />
              </div>

              <TabPanel id="education" active={active}>
                <EducationCareerTab view={view}/>
              </TabPanel>
              <TabPanel id="political" active={active}>
                <PoliticalCareerTab view={view} today={today}/>
              </TabPanel>

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
            </>}
      </div>
    </section>
  </>;
}
