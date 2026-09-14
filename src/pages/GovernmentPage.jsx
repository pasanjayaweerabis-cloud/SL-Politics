import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { Avatar } from '../components/Primitives.jsx';
import { SectionNav, useActiveSection } from '../components/SectionNav.jsx';
import { currentGovernment, governmentSourceStatus, getSource } from '../services/repository.ts';
import { formatDate } from '../lib/date.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { isApiEnabled, fetchCurrentGovernment } from '../services/apiClient.ts';
import { safeExternalHref } from '../lib/externalUrl.ts';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Javora — Current Government.
 *
 * A DERIVED view, not a maintained one. Every name, office and portfolio on
 * this page comes from `currentGovernment()`, which computes membership from
 * canonical positions that have not ended. There is no list here to edit: a
 * minister removed from the Cabinet Office roster gets an end date during
 * sync and disappears from this page on the next render, without anyone
 * touching this file.
 *
 * It is also NOT a second profile system. Every card links to the one
 * canonical profile at /person/<slug>, so a person reached from here and the
 * same person reached from the Directory show identical records.
 */

/* ==========================================================================
   Person card
   ========================================================================== */

/**
 * One office-holder.
 *
 * A whole card is a link. The offices are listed in full rather than
 * truncated to one: a minister holding two portfolios holds two, and showing
 * only the first would misrepresent the Cabinet.
 */
function MemberCard({ member, size = 'md' }) {
  const { t } = useI18n();
  /*
    Every portfolio is still shown — a minister holding three holds three,
    and dropping two would misstate the Cabinet. What changed is that the
    FIRST one is the card's headline and the rest are listed under a label
    that says what they are. Rendering all of them as identical rows of
    building icons made a three-portfolio card three times as tall as a
    one-portfolio card AND gave the reader no way to tell, at a glance,
    which person this card is really about — every card in the grid became a
    paragraph of ministry names.
  */
  const [primary, ...also] = member.offices;
  return <a className={`gov-card${size === 'lg' ? ' gov-card--lead' : ''}`} href={`/person/${encodeURIComponent(member.slug)}`}>
    <Avatar name={member.name} portraitUrl={member.portraitUrl} size={size === 'lg' ? 'lg' : 'sm'}/>
    <div className="gov-card__body">
      <h3 className="gov-card__name">{member.name}</h3>
      {primary ? <p className="gov-card__office gov-card__office--primary">{primary.title}</p> : null}
      {also.length ? <div className="gov-card__also">
        <p className="gov-card__also-label">
          {also.length === 1 ? t('government.alsoHoldsOne') : t('government.alsoHolds', { count: also.length })}
        </p>
        <ul className="gov-card__offices">
          {also.map(office => <li key={office.positionId} className="gov-card__office">{office.title}</li>)}
        </ul>
      </div> : null}
      {member.partyLabel || member.districtLabel ? (
        <p className="gov-card__meta">
          {[member.partyLabel, member.districtLabel].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
    <span className="gov-card__go" aria-hidden="true"><Icon name="arrowRight"/></span>
  </a>;
}

/**
 * A section, rendered only when it has people.
 *
 * An empty section is not shown at all rather than displayed as a heading
 * over nothing: the Cabinet Office publishes no State Minister roster, and an
 * empty "State Ministers" heading would imply there are none rather than that
 * no authoritative source lists them.
 */
function Section({ id, title, description, members }) {
  if (!members.length) return null;
  return <section className="gov-section" aria-labelledby={id}>
    <div className="gov-section__head">
      <h2 id={id}>{title}</h2>
      <span className="gov-section__count">{members.length}</span>
    </div>
    {description ? <p className="gov-section__desc">{description}</p> : null}
    <div className="gov-grid">
      {members.map(member => <MemberCard key={member.personId} member={member}/>)}
    </div>
  </section>;
}

/** The President and Prime Minister get a wider, single-column treatment. */
function LeadSection({ id, title, member, absentNote }) {
  return <section className="gov-section" aria-labelledby={id}>
    <div className="gov-section__head"><h2 id={id}>{title}</h2></div>
    {member
      ? <div className="gov-grid gov-grid--lead"><MemberCard member={member} size="lg"/></div>
      : <p className="unrecorded"><Icon name="slash"/><span>{absentNote}</span></p>}
  </section>;
}

/* ==========================================================================
   Source status
   ========================================================================== */

/**
 * Truthful freshness.
 *
 * Shows only timestamps that came from a check that actually succeeded, and
 * says "not yet checked" rather than inventing one. If a source has never
 * been synced this must not imply that it has.
 */
function SourceStatus({ sources }) {
  const { t } = useI18n();
  const checked = sources.filter(s => s.lastSuccessfulSyncAt);
  const newest = checked
    .map(s => s.lastSuccessfulSyncAt)
    .sort()
    .at(-1) ?? null;
  const allChecked = checked.length === sources.length;

  return <div className="gov-status">
    <span className={`gov-status__dot${allChecked ? '' : ' gov-status__dot--partial'}`} aria-hidden="true"></span>
    <div>
      <p className="gov-status__line">
        {newest
          ? t('government.dataRetrieved', { date: formatDate(newest.slice(0, 10)) })
          : t('government.noSourceCheck')}
      </p>
      <p className="gov-status__sources">
        {sources.map(source => {
          const meta = getSource(source.sourceId);
          const href = safeExternalHref(meta?.url);
          return <span key={source.sourceId} className="gov-status__source">
            {href
              ? <a href={href} target="_blank" rel="noopener noreferrer">{source.name}</a>
              : source.name}
            {': '}
            {source.lastSuccessfulSyncAt ? formatDate(source.lastSuccessfulSyncAt.slice(0, 10)) : t('government.notYetChecked')}
          </span>;
        })}
      </p>
    </div>
  </div>;
}

/* ==========================================================================
   Page
   ========================================================================== */

/** Splits a translated sentence around a `{{directoryLink}}` placeholder so a real `<a>` can sit at the right spot for each language's word order, rather than always appended at the end. */
function ledeParts(t) {
  const marker = ' LINK ';
  const [before, after = ''] = t('government.lede', { directoryLink: marker }).split(marker);
  return [before, after];
}

export default function GovernmentPage() {
  const { t } = useI18n();
  const [ledeBefore, ledeAfter] = ledeParts(t);
  const today = React.useMemo(() => new Date(), []);

  /*
   * The bundled derivation is the starting point, and the API replaces it when
   * one is configured.
   *
   * Both are computed by the SAME function — `deriveCurrentGovernment()` —
   * one over the bundled canonical dataset, one over the database. So the
   * shape is identical and this component does not care which it rendered.
   *
   * Rendering the bundled data first rather than waiting means the page is
   * never blank: a government page that showed nothing because a server was
   * down would be worse than one computed from bundled canonical records.
   */
  const [government, setGovernment] = React.useState(() => currentGovernment(today));
  const [sources, setSources] = React.useState(() => governmentSourceStatus());

  React.useEffect(() => {
    if (!isApiEnabled()) return undefined;
    const controller = new AbortController();
    fetchCurrentGovernment(controller.signal)
      .then(payload => {
        setGovernment(payload);
        // The API reports per-source health from real sync runs, which is
        // strictly better than the bundled snapshot's own retrieval date.
        setSources(payload.sources.map(source => ({
          sourceId: source.sourceId,
          name: source.name,
          syncLabel: source.state,
          lastSuccessfulSyncAt: source.lastSuccessfulSyncAt,
        })));
      })
      // A failed API call leaves the bundled render in place. The canonical
      // records are still real; only their freshness is in question, and the
      // status line already reports that honestly.
      .catch(() => { /* keep the bundled derivation */ });
    return () => controller.abort();
  }, [today]);

  React.useEffect(() => { applyPageMeta(routeMeta('government')); }, []);

  const empty =
    !government.president && !government.primeMinister &&
    government.cabinet.length === 0 && government.deputyMinisters.length === 0;

  /*
    ONE declaration of what this page contains, feeding both the local
    navigation and the body below it. Two lists would drift the first time a
    section was added — the nav would advertise an anchor that renders
    nothing, or a section would exist with no way to reach it.

    A `lead` section always renders (it states plainly when the office is
    unfilled, which is information); a `group` renders only when it has
    members, because an empty "State Ministers" heading would read as "there
    are none" rather than "no authoritative source lists them" — the same
    rule `Section` already applied.
  */
  const sections = [
    { id: 'head-of-state', kind: 'lead', title: t('government.headOfState'), member: government.president, absentNote: t('government.headOfStateAbsent') },
    { id: 'head-of-government', kind: 'lead', title: t('government.headOfGovernment'), member: government.primeMinister, absentNote: t('government.headOfGovernmentAbsent') },
    { id: 'cabinet', kind: 'group', title: t('government.cabinet'), description: t('government.cabinetDescription'), members: government.cabinet },
    { id: 'deputy-ministers', kind: 'group', title: t('government.deputyMinisters'), description: t('government.deputyMinistersDescription'), members: government.deputyMinisters },
    { id: 'state-ministers', kind: 'group', title: t('government.stateMinisters'), members: government.stateMinisters },
    { id: 'parliamentary-leadership', kind: 'group', title: t('government.parliamentaryLeadership'), description: t('government.parliamentaryLeadershipDescription'), members: government.parliamentaryLeadership },
    { id: 'other-leadership', kind: 'group', title: t('government.otherLeadership'), members: government.otherMajorLeadership },
  ].filter(section => section.kind === 'lead' || section.members.length > 0);

  const navSections = sections.map(section => ({
    id: section.id,
    title: section.title,
    count: section.kind === 'group' ? section.members.length : undefined,
  }));
  const activeSection = useActiveSection(navSections.map(section => section.id));

  return <>
    <header className="section section--tight gov-header">
      <div className="container">
        <p className="eyebrow">{t('government.eyebrow')}</p>
        <h1>{t('government.title')}</h1>
        <p className="lede">
          {ledeBefore}<a href="/directory">{t('government.directoryLink')}</a>{ledeAfter}
        </p>
        <SourceStatus sources={sources}/>
      </div>
    </header>

    <SectionNav sections={navSections} activeId={activeSection} label={t('government.onThisPage')}/>

    <div className="section">
      <div className="container gov-page">
        {empty ? (
          <p className="unrecorded">
            <Icon name="slash"/>
            <span>{t('government.noDataAvailable')}</span>
          </p>
        ) : null}

        {sections.map(section => (section.kind === 'lead'
          ? <LeadSection
              key={section.id}
              id={section.id}
              title={section.title}
              member={section.member}
              absentNote={section.absentNote}
            />
          : <Section
              key={section.id}
              id={section.id}
              title={section.title}
              description={section.description}
              members={section.members}
            />))}

        <p className="gov-footnote">{t('government.footnote')}</p>
      </div>
    </div>
  </>;
}
