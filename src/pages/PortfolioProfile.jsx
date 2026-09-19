import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../lib/icons.jsx';
import { SectionNav, useActiveSection } from '../components/SectionNav.jsx';
import { toast } from '../components/Toast.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { safeExternalHref } from '../lib/externalUrl.ts';
import { DATASET, getPersonBySlug } from '../services/repository.ts';
import { formatDate } from '../lib/date.ts';
import { sortPositions, isCurrent } from '../lib/positions.ts';
import { VerificationState, normaliseClaim, presentVerification } from '../lib/verification.ts';
import { Unavailable, VerifiedBadge } from '../components/Primitives.jsx';
import { Period } from './PersonPage.jsx';
import './PortfolioProfile.css';

/**
 * Javora — the "portfolio" profile layout: a single guided scroll covering
 * ONE office for the small set of profiles that have one (see
 * src/data/profileContent.ts). Sections run in the order a citizen reasons
 * through a record: the office itself, what was done under it, decisions and
 * votes during its term, what this page cannot answer, where the rest of the
 * person's record lives, then the evidence behind all of it.
 *
 * Not purely presentational any more: `content` supplies only researched
 * material (the office, its actions, its decisions, its sources) — name, the
 * office's own term, "Today", every other office the person has held and
 * every sourcing badge are derived here from `getPersonBySlug(content.slug)`,
 * so a stale hand-typed date can no longer disagree with the canonical
 * record. See src/data/profileContent.ts's `PortfolioProfileContent` for the
 * exact contract and the checklist for adding a second profile.
 *
 * Every sourcing badge on this page is a real `Claim` run through the same
 * `normaliseClaim()` the rest of the site uses (src/lib/verification.ts) —
 * nothing here can present itself as "Verified" without evidence and a check
 * date, which nothing in this hand-researched file carries, so the honest
 * ceiling for anything below is "Source-linked". The record-level state is
 * shown once, in the hero (reusing the tabbed layout's own `trust-bar`
 * pattern, PersonPage.jsx); a row shows its own badge only when its state
 * differs from that record-level state (show by exception).
 *
 * Nothing on this page is ever conditionally unrendered to hide it: a
 * disclosure is a native <details>, and there is no tab to hide content
 * behind — every section below is in the prerendered HTML regardless of
 * scroll position (see the TabPanel invariant this page no longer needs, and
 * CLAUDE.md).
 */

/* ==========================================================================
   Copy affordances — "Copy link" (section headings, source records) and
   "Copy citation" (source records only). Unchanged from the previous pass:
   same functions, same behaviour, still exported for
   PortfolioProfile.copy.test.jsx.
   ========================================================================== */

/**
 * The canonical profile URL for whatever page this component is currently
 * rendered on — derived from the CURRENT path's last segment rather than
 * hardcoded, so a reader on the retired `/politician/harsha-de-silva` alias
 * still copies the canonical `/person/...` address, and so this stays correct
 * for any future profile this same component renders.
 */
function canonicalProfileUrl() {
  if (typeof window === 'undefined') return '';
  const segments = window.location.pathname.split('/').filter(Boolean);
  const slug = segments[segments.length - 1] ?? '';
  return `${window.location.origin}/person/${slug}`;
}

/** Rejects rather than throwing synchronously: `navigator.clipboard` is
    absent on non-secure origins and `writeText` itself can reject if the
    reader denies the permission — both are the SAME failure path to the
    caller. Exported so a test can override `navigator.clipboard` and assert
    the rejection, without that reaching into module-private state. */
export function copyPlainText(text) {
  if (!navigator.clipboard?.writeText) return Promise.reject(new Error('Clipboard API unavailable'));
  return navigator.clipboard.writeText(text);
}

/**
 * A plain-text citation built ONLY from fields this source entry actually
 * has (organization, and title/date/href where present) — never a guessed
 * "accessed on" date or a fabricated field.
 */
export function buildCitation(source) {
  const parts = [source.organization, source.title, source.date, source.type].filter(Boolean);
  const citation = `${parts.join('. ')}.`;
  return source.href ? `${citation} ${source.href}` : citation;
}

/**
 * Writes `text` to the clipboard and reports the result as a toast — shared
 * by every copy button on this page, so "never claim success" and "the
 * failure toast carries the manual-copy text" are enforced in exactly one
 * place. `copy` defaults to the real `copyPlainText` but is injectable,
 * which is what lets a test exercise the failure path with a rejecting stub
 * instead of a real `navigator.clipboard`.
 */
export function copyWithFeedback(text, { toastId, successMessage, failureMessage, copy = copyPlainText }) {
  return copy(text).then(
    () => { toast.success(successMessage, { id: toastId }); return true; },
    () => { toast.error(failureMessage, { id: toastId, description: text }); return false; },
  );
}

function CopyButton({ iconName, ariaLabel, getText, successMessage, toastId }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timerRef = React.useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const handleClick = e => {
    e.preventDefault();
    e.stopPropagation();
    copyWithFeedback(getText(), { toastId, successMessage, failureMessage: t('toast.copyFailed') }).then(ok => {
      if (!ok) return;
      clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    });
  };
  return <button
    type="button"
    className="hds-profile__copy-btn"
    data-copied={copied ? 'true' : undefined}
    aria-label={ariaLabel}
    onClick={handleClick}
  >
    <Icon name={iconName} className="hds-profile__copy-glyph hds-profile__copy-glyph--idle"/>
    <Icon name="check" className="hds-profile__copy-glyph hds-profile__copy-glyph--done"/>
  </button>;
}

function CopyLinkButton({ id, label }) {
  const { t } = useI18n();
  return <CopyButton
    iconName="link"
    ariaLabel={t('toast.copyLinkTo', { label })}
    getText={() => `${canonicalProfileUrl()}#${id}`}
    successMessage={t('toast.linkCopied')}
    toastId={`copy-link-${id}`}
  />;
}

function CopyCitationButton({ source }) {
  const { t } = useI18n();
  const label = source.title ? `${source.organization} — ${source.title}` : source.organization;
  return <CopyButton
    iconName="document"
    ariaLabel={t('toast.copyCitationFor', { label })}
    getText={() => buildCitation(source)}
    successMessage={t('toast.citationCopied')}
    toastId={`copy-citation-${source.id}`}
  />;
}

/* ==========================================================================
   Sourcing — one small adapter turning this file's citeIds into a real
   Claim, run through the site's own normaliseClaim(). This is the ONLY
   verification vocabulary on this page: there is no second, page-local
   status map.
   ========================================================================== */

/** citeIds referenced anywhere on an action row, deduplicated. */
function actionCiteIds(row) {
  return [...new Set([...(row.statedAim?.citeIds ?? []), ...(row.recordedResult?.citeIds ?? [])])];
}

/**
 * citeIds that resolve to a real, listed SourceEntry become evidenceIds; the
 * verification guess is SOURCE_LINKED when there is at least one (this file
 * points at a real document, never independently re-checked) and UNVERIFIED
 * when there is none (nothing checkable is cited at all). normaliseClaim()
 * then applies the site's own floor: with no `verifiedAt` on anything in this
 * hand-researched file, VERIFIED is structurally unreachable, which is the
 * honest ceiling Task 1a asks for.
 */
function claimForCiteIds(citeIds, sources) {
  const evidenceIds = (citeIds ?? []).filter(id => sources.some(s => s.id === id));
  const guess = evidenceIds.length ? VerificationState.SOURCE_LINKED : VerificationState.UNVERIFIED;
  return normaliseClaim({ verification: guess, evidenceIds, verifiedAt: null }, DATASET.mode);
}

/** The record-level sourcing state: the most common claim state across every
    claim on the page, so the hero states the honest default and rows only
    need their own badge when they differ from it (Task 5). */
function recordLevelState(claims) {
  const counts = new Map();
  for (const claim of claims) counts.set(claim.verification, (counts.get(claim.verification) ?? 0) + 1);
  let winner = VerificationState.UNVERIFIED;
  let best = -1;
  for (const [state, count] of counts) {
    if (count > best) { winner = state; best = count; }
  }
  return winner;
}

/** Real, listed sources render as linked numbers; anything else renders as
    plain "Source not yet listed" text, with the raw ids kept only in a
    data- attribute — never a link, and never printed as a bare token. */
function Citations({ citeIds, sources }) {
  const { t } = useI18n();
  const ids = citeIds ?? [];
  const listed = ids
    .map(id => ({ id, index: sources.findIndex(s => s.id === id) }))
    .filter(({ index }) => index !== -1);
  const unlisted = ids.filter(id => !listed.some(l => l.id === id));
  if (!listed.length && !unlisted.length) return null;
  return <span className="hds-profile__row-sources">
    {listed.length ? <>
      <span className="hds-profile__row-sources-label">{t('portfolioProfile.sources')}</span>
      {listed.map(({ id, index }, i) => {
        const n = String(index + 1).padStart(2, '0');
        const source = sources[index];
        return <React.Fragment key={id}>
          {i > 0 ? <span aria-hidden="true"> · </span> : ' '}
          <a href={`#hds-source-${id}`} aria-label={`${t('portfolioProfile.source')} ${n}: ${source.organization}`}>{n}</a>
        </React.Fragment>;
      })}
    </> : null}
    {unlisted.length ? (
      <span className="hds-profile__pending-cite" data-unlisted-ids={unlisted.join(',')}>
        {listed.length ? ' · ' : ''}{t('portfolioProfile.sourceNotYetListed')}
      </span>
    ) : null}
  </span>;
}

/** Shows a sourcing badge only when this claim differs from the record-level
    state already declared once in the hero — Task 5's show-by-exception
    rule, so a page-wide default is never repeated on every row. */
function SourcingException({ claim, baseline }) {
  if (claim.verification === baseline) return null;
  return <VerifiedBadge state={claim.verification} compact/>;
}

/* ==========================================================================
   Shared structural pieces
   ========================================================================== */

function SectionHeading({ id, label, children }) {
  return <h2 id={id} className="hds-profile__heading">
    {children}
    {id && label ? <CopyLinkButton id={id} label={label}/> : null}
  </h2>;
}

function CollapsibleSection({ id, heading, children }) {
  return <details className="hds-profile__section hds-profile__section--collapsible">
    <summary className="hds-profile__collapsible-summary">
      <SectionHeading id={id}>{heading}</SectionHeading>
    </summary>
    <div className="hds-profile__collapsible-body">
      {children}
    </div>
  </details>;
}

function useExpandedRows() {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = id => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return [expanded, toggle];
}

/** A date at the precision it was recorded, preferring the source's own
    wording (`display`) over a bare formatted date when the data carries
    one. */
function periodDate(structuredDate) {
  return structuredDate.display ?? formatDate(structuredDate.date);
}

/* ==========================================================================
   Hero
   ========================================================================== */

const ATTRIBUTION_KEY = {
  'documented-personal-action': 'documentedPersonalAction',
  'office-institution': 'officeInstitution',
  'government-wide': 'governmentWide',
};

const STATUS_KEY = {
  completed: 'completed',
  'partly-completed': 'partlyCompleted',
  delayed: 'delayed',
  'not-completed': 'notCompleted',
  'intended-outcome-not-established': 'intendedOutcomeNotEstablished',
  'outcome-not-established': 'outcomeNotEstablished',
  'sources-conflict': 'sourcesConflict',
};

function Hero({ content, view, today, t, baselineState }) {
  const portraitRef = React.useRef(null);
  const [portraitState, setPortraitState] = useState('pending');
  useEffect(() => {
    if (portraitRef.current?.complete) setPortraitState('instant');
  }, []);

  const appointments = content.focusPosition.appointments;
  const firstAppointment = appointments[0];
  const lastAppointment = appointments[appointments.length - 1];
  const name = view.person.canonicalName;

  const current = view.positions.filter(p => isCurrent(p, today));
  const todayParts = [];
  if (current.length) todayParts.push(current.map(p => p.title).join(', '));
  if (view.partyLabel) todayParts.push(view.partyLabel);
  if (view.districtLabel) todayParts.push(view.districtLabel);

  const presentation = presentVerification(baselineState);

  return <section className="hds-profile__hero" id="hds-hero" aria-labelledby="hds-hero-name">
    <img
      ref={portraitRef}
      className="hds-profile__portrait"
      src={content.portraitUrl}
      alt={name}
      width="180"
      height="180"
      decoding="async"
      data-loaded={portraitState !== 'pending' ? 'true' : undefined}
      data-instant={portraitState === 'instant' ? 'true' : undefined}
      onLoad={() => setPortraitState(current => (current === 'instant' ? current : 'faded'))}
    />
    <div className="hds-profile__hero-body">
      <p className="hds-profile__eyebrow">{t('portfolioProfile.eyebrow')}</p>
      <h1 id="hds-hero-name" className="hds-profile__name">{name}</h1>
      <p className="hds-profile__office-title">{lastAppointment.title}</p>
      {content.portfolioAreas.length ? (
        <p className="hds-profile__portfolio-areas">{content.portfolioAreas.join(' · ')}</p>
      ) : null}
      <p className="hds-profile__term">
        <Period start={firstAppointment.start.date} end={lastAppointment.end?.date} ongoing={Boolean(lastAppointment.ongoing)}/>
      </p>
      <p className="hds-profile__scope-sentence">
        {t('portfolioProfile.scopeSentence', {
          name,
          office: lastAppointment.title,
          start: formatDate(firstAppointment.start.date),
          end: lastAppointment.end ? formatDate(lastAppointment.end.date) : t('person.present'),
        })}
      </p>
      <p className="hds-profile__today-line">
        <span className="hds-profile__today-label">{t('portfolioProfile.today')}</span>{' '}
        {todayParts.length ? todayParts.join(' · ') : t('person.noCurrentOffice')}
      </p>
      <div className="trust-bar">
        <span className="trust-bar__mark" aria-hidden="true"><Icon name="link"/></span>
        <div className="trust-bar__body">
          <p className="trust-bar__headline">
            <strong>{presentation.label}</strong>
            <span> — {t('portfolioProfile.recordLevelSummary')}</span>
          </p>
          <details className="trust-bar__details">
            <summary>{t('person.whatThisMeans')}</summary>
            <p>{presentation.description}</p>
          </details>
        </div>
      </div>
    </div>
  </section>;
}

/* ==========================================================================
   1 — The office
   ========================================================================== */

function OfficeSection({ content, t }) {
  return <section className="hds-profile__section">
    <SectionHeading id="hds-office" label={t('portfolioProfile.theOffice')}>{t('portfolioProfile.theOffice')}</SectionHeading>
    <dl className="hds-profile__office-list">
      <div>
        <dt>{t('portfolioProfile.appointments')}</dt>
        <dd>
          <ul className="hds-profile__appointments-list">
            {content.focusPosition.appointments.map((a, i) => (
              <li key={i}>
                <span className="hds-profile__appointment-title">{a.title}</span>{' '}
                <Period start={a.start.date} end={a.end?.date} ongoing={Boolean(a.ongoing)}/>
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <div>
        <dt>{t('portfolioProfile.gazettedDuties')}</dt>
        <dd>
          {content.office.duties
            ? <>{content.office.duties.text} <Citations citeIds={content.office.duties.citeIds} sources={content.sources}/></>
            : <Unavailable>{t('portfolioProfile.noDutiesRecorded')}</Unavailable>}
        </dd>
      </div>
      <div>
        <dt>{t('portfolioProfile.institutions')}</dt>
        <dd>
          {content.office.institutions.length ? (
            <ul className="hds-profile__institutions">
              {content.office.institutions.map(inst => (
                <li key={inst.name}>{inst.name} <Citations citeIds={inst.citeIds} sources={content.sources}/></li>
              ))}
            </ul>
          ) : <Unavailable>{t('portfolioProfile.noInstitutionsRecorded')}</Unavailable>}
        </dd>
      </div>
    </dl>
  </section>;
}

/* ==========================================================================
   2 — What was done
   ========================================================================== */

function ActionsSection({ content, name, baseline, t }) {
  const [expanded, toggleRow] = useExpandedRows();
  const rows = content.actions;

  return <section className="hds-profile__section">
    <SectionHeading id="hds-actions" label={t('portfolioProfile.whatWasDone')}>{t('portfolioProfile.whatWasDone')}</SectionHeading>
    {!rows.length ? (
      <p className="hds-profile__section-empty"><Unavailable>{t('portfolioProfile.noActionsRecorded')}</Unavailable></p>
    ) : (
      <div className="hds-profile__table-wrap">
        <table className="hds-profile__table hds-profile__table--actions" aria-labelledby="hds-actions">
          <colgroup>
            <col className="hds-profile__col--action-title" />
            <col className="hds-profile__col--action-role" />
            <col className="hds-profile__col--action-result" />
            <col className="hds-profile__col--action-status" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t('portfolioProfile.colAction')}</th>
              <th scope="col">{t('portfolioProfile.colDocumentedRole', { name })}</th>
              <th scope="col">{t('portfolioProfile.colWhatSourcesShow')}</th>
              <th scope="col">{t('portfolioProfile.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isExpanded = expanded.has(row.id);
              const claim = claimForCiteIds(actionCiteIds(row), content.sources);
              const detailId = `hds-actions-detail-${row.id}`;
              return <React.Fragment key={row.id}>
                <tr data-expanded={isExpanded ? 'true' : undefined}>
                  <th scope="row" data-label={t('portfolioProfile.colAction')} className="hds-profile__cell--title">
                    {row.title}
                    {row.period ? (
                      <span className="hds-profile__row-period">{periodDate(row.period.start)}{row.period.end ? <> – {periodDate(row.period.end)}</> : null}</span>
                    ) : null}
                    <button
                      type="button"
                      className="hds-profile__row-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      onClick={() => toggleRow(row.id)}
                    >
                      <span>{isExpanded ? t('portfolioProfile.fewerDetails') : t('portfolioProfile.moreDetails')}</span>
                      <Icon name="chevronDown" className="hds-profile__details-chevron"/>
                    </button>
                  </th>
                  <td data-label={t('portfolioProfile.colDocumentedRole', { name })}>
                    {t(`portfolioProfile.attribution.${ATTRIBUTION_KEY[row.attribution]}`, { name })}
                    {row.attributionDetail ? <span className="hds-profile__cell--muted hds-profile__attribution-detail">{row.attributionDetail}</span> : null}
                  </td>
                  <td data-label={t('portfolioProfile.colWhatSourcesShow')}>
                    {row.recordedResult.text}
                    {row.recordedResult.asOf ? (
                      <span className="hds-profile__cell--muted"> {t('portfolioProfile.asOf', { date: periodDate(row.recordedResult.asOf) })}</span>
                    ) : null}
                    {row.isLaterResult ? <span className="hds-profile__row-caveat">{t('portfolioProfile.laterResult')}</span> : null}
                  </td>
                  <td data-label={t('portfolioProfile.colStatus')}>{t(`portfolioProfile.status.${STATUS_KEY[row.status]}`)}</td>
                </tr>
                <tr id={detailId} hidden={!isExpanded} className="hds-profile__details-row">
                  <td colSpan={4} className="hds-profile__details-cell">
                    {row.statedAim ? (
                      <p className="hds-profile__field-value">
                        <span className="hds-profile__field-label">{t('portfolioProfile.statedAim')}</span>
                        {row.statedAim.text}
                      </p>
                    ) : null}
                    <p className="hds-profile__field-value">
                      <SourcingException claim={claim} baseline={baseline}/>
                      <Citations citeIds={actionCiteIds(row)} sources={content.sources}/>
                    </p>
                  </td>
                </tr>
              </React.Fragment>;
            })}
          </tbody>
        </table>
      </div>
    )}
  </section>;
}

/* ==========================================================================
   3 — Decisions & votes
   ========================================================================== */

function DecisionsSection({ content, name, t }) {
  const rows = content.decisions;
  return <section className="hds-profile__section">
    <SectionHeading id="hds-decisions" label={t('portfolioProfile.decisionsVotes')}>{t('portfolioProfile.decisionsVotes')}</SectionHeading>
    {!rows.length ? (
      <p className="hds-profile__section-empty"><Unavailable>{t('portfolioProfile.noDecisionsRecorded')}</Unavailable></p>
    ) : (
      <div className="hds-profile__table-wrap">
        <table className="hds-profile__table hds-profile__table--decisions" aria-labelledby="hds-decisions">
          <colgroup>
            <col className="hds-profile__col--decision-date" />
            <col className="hds-profile__col--decision-matter" />
            <col className="hds-profile__col--decision-action" />
            <col className="hds-profile__col--decision-result" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t('portfolioProfile.colDate')}</th>
              <th scope="col">{t('portfolioProfile.colMatter')}</th>
              <th scope="col">{t('portfolioProfile.colRecordedAction', { name })}</th>
              <th scope="col">{t('portfolioProfile.colResult')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <th scope="row" data-label={t('portfolioProfile.colDate')} className="hds-profile__cell--title hds-profile__cell--mono">
                  {periodDate(row.date)}
                </th>
                <td data-label={t('portfolioProfile.colMatter')}>{row.matter}</td>
                <td data-label={t('portfolioProfile.colRecordedAction', { name })}>
                  {row.isPublicPosition ? (
                    <span className="hds-profile__caveat-tag">{t('portfolioProfile.publicPositionLabel')}</span>
                  ) : null}
                  <span> {row.action.text}</span>
                  <Citations citeIds={row.action.citeIds} sources={content.sources}/>
                </td>
                <td data-label={t('portfolioProfile.colResult')}>{row.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>;
}

/* ==========================================================================
   4 — Not in this record
   ========================================================================== */

const NOT_RECORDED_KEYS = ['budget', 'spent', 'audit'];

function NotRecordedSection({ t }) {
  return <section className="hds-profile__section">
    <SectionHeading id="hds-not-recorded" label={t('portfolioProfile.notInThisRecord')}>{t('portfolioProfile.notInThisRecord')}</SectionHeading>
    <ul className="hds-profile__not-recorded-list">
      {NOT_RECORDED_KEYS.map(key => (
        <li key={key}><Unavailable>{t(`portfolioProfile.notRecorded.${key}`)}</Unavailable></li>
      ))}
    </ul>
  </section>;
}

/* ==========================================================================
   5 — Other offices held
   ========================================================================== */

function OtherOfficesSection({ view, today, focusRoleType, t }) {
  const others = sortPositions(view.positions.filter(p => p.roleType !== focusRoleType), today);
  if (!others.length) return null;
  return <CollapsibleSection id="hds-other-offices" heading={t('portfolioProfile.otherOfficesHeld')}>
    <ul className="hds-profile__other-offices-list">
      {others.map(p => (
        <li key={p.id}>
          <span className="hds-profile__other-office-title">{p.title}</span>
          <Period start={p.startDate} end={p.endDate} ongoing={isCurrent(p, today)}/>
        </li>
      ))}
    </ul>
  </CollapsibleSection>;
}

/* ==========================================================================
   6 — Sources
   ========================================================================== */

function usedByTitles(sourceId, content, t) {
  const titles = [];
  if (content.office.duties?.citeIds?.includes(sourceId)) titles.push(t('portfolioProfile.theOffice'));
  for (const inst of content.office.institutions) {
    if (inst.citeIds.includes(sourceId)) titles.push(inst.name);
  }
  for (const row of content.actions) {
    if (actionCiteIds(row).includes(sourceId)) titles.push(row.title);
  }
  for (const row of content.decisions) {
    if (row.action.citeIds.includes(sourceId)) titles.push(row.matter);
  }
  return titles;
}

function unlistedReferenceIds(content) {
  const listedIds = new Set(content.sources.map(s => s.id));
  const all = new Set();
  const collect = ids => (ids ?? []).forEach(id => { if (!listedIds.has(id)) all.add(id); });
  collect(content.office.duties?.citeIds);
  content.office.institutions.forEach(inst => collect(inst.citeIds));
  content.actions.forEach(row => collect(actionCiteIds(row)));
  content.decisions.forEach(row => collect(row.action.citeIds));
  return [...all];
}

function SourcesSection({ content, t }) {
  const sources = content.sources;
  const unlisted = unlistedReferenceIds(content);
  return <CollapsibleSection id="hds-sources" heading={<>{t('portfolioProfile.sources')} <span className="hds-profile__heading-count">{sources.length}</span></>}>
    <ol className="hds-profile__sources">
      {sources.map((source, i) => {
        const href = safeExternalHref(source.href);
        const n = String(i + 1).padStart(2, '0');
        const meta = [source.title, source.date].filter(Boolean).join(' · ');
        const usedBy = usedByTitles(source.id, content, t);
        return (
          <li className="hds-profile__source" id={`hds-source-${source.id}`} key={source.id}>
            <span className="hds-profile__source-no" aria-hidden="true">{n}</span>
            <div className="hds-profile__source-body">
              <p className="hds-profile__source-org">{source.organization}</p>
              {meta ? <p className="hds-profile__source-meta">{meta}</p> : null}
              <p className="hds-profile__source-type">{source.type}</p>
              {usedBy.length ? (
                <p className="hds-profile__source-used-for">{t('portfolioProfile.usedFor', { rows: usedBy.join(' · ') })}</p>
              ) : null}
            </div>
            <div className="hds-profile__source-controls">
              <div className="hds-profile__source-actions">
                <CopyLinkButton id={`hds-source-${source.id}`} label={`${t('portfolioProfile.source')} ${n}: ${source.organization}`}/>
                <CopyCitationButton source={source}/>
              </div>
              {href ? (
                <a className="hds-profile__source-link" href={href} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" /><span>{t('person.visit')}</span>
                </a>
              ) : (
                <span className="hds-profile__source-link hds-profile__source-link--unavailable">
                  <Icon name="slash" /><span>{t('portfolioProfile.noLinkOnRecord')}</span>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
    {unlisted.length ? (
      <p className="hds-profile__note">{t('portfolioProfile.furtherReferencesNotListed', { count: unlisted.length })}</p>
    ) : null}
  </CollapsibleSection>;
}

/* ==========================================================================
   Labels explanation — only the labels that actually render on this page.
   ========================================================================== */

function LabelsExplanation({ sourcingStates, statuses, t }) {
  return <details className="hds-profile__legend" id="hds-labels">
    <summary>{t('portfolioProfile.howToReadLabels')}</summary>
    <div className="hds-profile__legend-body">
      <div>
        <h3 className="hds-profile__sub-heading">{t('portfolioProfile.howSourcedHeading')}</h3>
        <dl className="hds-profile__legend-list">
          {sourcingStates.map(state => {
            const presentation = presentVerification(state);
            return <div key={state}>
              <dt><VerifiedBadge state={state} compact/></dt>
              <dd>{presentation.description}</dd>
            </div>;
          })}
        </dl>
      </div>
      <div>
        <h3 className="hds-profile__sub-heading">{t('portfolioProfile.statusHeading')}</h3>
        <dl className="hds-profile__legend-list">
          {statuses.map(status => (
            <div key={status}>
              <dt>{t(`portfolioProfile.status.${STATUS_KEY[status]}`)}</dt>
              <dd>{t(`portfolioProfile.statusHint.${STATUS_KEY[status]}`)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  </details>;
}

/* ==========================================================================
   Hash navigation — redirects a link built for the old tiered structure to
   the nearest section that still exists, opens any closed native <details>
   ancestor, and scrolls the target into view. Effect-only: it never touches
   `window`/`document` during render, so it has no bearing on the
   prerendered HTML.
   ========================================================================== */

const HASH_REDIRECTS = {
  'hds-glance': 'hds-hero',
  'hds-outcomes': 'hds-actions',
  'hds-promises': 'hds-actions',
  'hds-programmes': 'hds-actions',
  'hds-interventions': 'hds-actions',
  'hds-votes': 'hds-decisions',
  'hds-attribution': 'hds-actions',
  'hds-policies': 'hds-actions',
  'hds-role': 'hds-office',
  'hds-career': 'hds-other-offices',
  'hds-research': 'hds-sources',
};
const HASH_PREFIX_REDIRECTS = [
  ['hds-indicator-', 'hds-actions'],
  ['hds-intervention-', 'hds-actions'],
];

function resolveHash(hash) {
  if (HASH_REDIRECTS[hash]) return HASH_REDIRECTS[hash];
  const prefixMatch = HASH_PREFIX_REDIRECTS.find(([prefix]) => hash.startsWith(prefix));
  return prefixMatch ? prefixMatch[1] : hash;
}

function scrollWhenLaidOut(el, attempts = 10) {
  if (el.getClientRects().length) {
    el.scrollIntoView();
    return;
  }
  if (attempts > 0) requestAnimationFrame(() => scrollWhenLaidOut(el, attempts - 1));
}

function useHashNavigation() {
  useEffect(() => {
    function focusHash() {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const hash = resolveHash(raw);
      const el = document.getElementById(hash);
      if (!el) return;

      let details = el.closest('details');
      while (details) {
        details.open = true;
        details = details.parentElement ? details.parentElement.closest('details') : null;
      }

      scrollWhenLaidOut(el);
    }

    focusHash();
    window.addEventListener('hashchange', focusHash);
    return () => window.removeEventListener('hashchange', focusHash);
  }, []);
}

/* ==========================================================================
   Page
   ========================================================================== */

export default function PortfolioProfile({ content }) {
  const { t } = useI18n();
  const today = useMemo(() => new Date(), []);
  const view = useMemo(() => getPersonBySlug(content.slug), [content.slug]);
  const name = view.person.canonicalName;

  useHashNavigation();

  const notRecordedItems = NOT_RECORDED_KEYS;
  const otherOffices = useMemo(
    () => view.positions.filter(p => p.roleType !== content.focusPosition.roleType),
    [view, content.focusPosition.roleType],
  );

  const allClaims = useMemo(() => {
    const claims = [];
    if (content.office.duties) claims.push(claimForCiteIds(content.office.duties.citeIds, content.sources));
    content.office.institutions.forEach(inst => claims.push(claimForCiteIds(inst.citeIds, content.sources)));
    content.actions.forEach(row => claims.push(claimForCiteIds(actionCiteIds(row), content.sources)));
    content.decisions.forEach(row => claims.push(claimForCiteIds(row.action.citeIds, content.sources)));
    return claims;
  }, [content]);
  const baseline = useMemo(() => recordLevelState(allClaims), [allClaims]);
  const sourcingStates = useMemo(
    () => [...new Set([baseline, ...allClaims.map(c => c.verification)])],
    [baseline, allClaims],
  );
  const statuses = useMemo(() => [...new Set(content.actions.map(row => row.status))], [content.actions]);

  const sections = useMemo(() => {
    const list = [
      { id: 'hds-office', title: t('portfolioProfile.theOffice') },
      { id: 'hds-actions', title: t('portfolioProfile.whatWasDone') },
      { id: 'hds-decisions', title: t('portfolioProfile.decisionsVotes') },
    ];
    if (notRecordedItems.length) list.push({ id: 'hds-not-recorded', title: t('portfolioProfile.notInThisRecord') });
    if (otherOffices.length) list.push({ id: 'hds-other-offices', title: t('portfolioProfile.otherOfficesHeld') });
    if (content.sources.length) list.push({ id: 'hds-sources', title: t('portfolioProfile.sources') });
    return list;
  }, [t, notRecordedItems, otherOffices, content.sources.length]);
  const sectionIds = useMemo(() => sections.map(s => s.id), [sections]);
  const [activeSection] = useActiveSection(sectionIds);

  return (
    <div className="hds-profile">
      <div className="hds-profile__container">
        <Hero content={content} view={view} today={today} t={t} baselineState={baseline}/>

        <hr className="hds-profile__divider" />

        <SectionNav sections={sections} activeId={activeSection} label={t('portfolioProfile.onThisPage')}/>

        <OfficeSection content={content} t={t}/>
        <hr className="hds-profile__divider" />

        <ActionsSection content={content} name={name} baseline={baseline} t={t}/>
        <hr className="hds-profile__divider" />

        <DecisionsSection content={content} name={name} t={t}/>

        {notRecordedItems.length ? <>
          <hr className="hds-profile__divider" />
          <NotRecordedSection t={t}/>
        </> : null}

        {otherOffices.length ? <>
          <hr className="hds-profile__divider" />
          <OtherOfficesSection view={view} today={today} focusRoleType={content.focusPosition.roleType} t={t}/>
        </> : null}

        {content.sources.length ? <>
          <hr className="hds-profile__divider" />
          <SourcesSection content={content} t={t}/>
        </> : null}

        {allClaims.length ? <>
          <hr className="hds-profile__divider" />
          <LabelsExplanation sourcingStates={sourcingStates} statuses={statuses} t={t}/>
        </> : null}
      </div>
    </div>
  );
}
