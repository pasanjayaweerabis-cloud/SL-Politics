import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../lib/icons.jsx';
import { Tabs, TabPanel } from '../components/Tabs.jsx';
import { SectionNav, useActiveSection } from '../components/SectionNav.jsx';
import { toast } from '../components/Toast.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { safeExternalHref } from '../lib/externalUrl.ts';
import './PortfolioProfile.css';

/**
 * Javora — the "portfolio" profile layout: a hero, a compact "at a glance"
 * strip, and four tabs (Performance / Decisions & voting / Policy positions /
 * Role & career) for the small set of profiles that have one (see
 * src/data/profileContent.ts).
 *
 * Purely presentational: it takes its content as a prop rather than
 * importing a hardcoded object, so the same component can render any
 * profile that resolver maps to it. Renders only the content between the
 * site's global header and footer (both come from `Layout` in Chrome.jsx,
 * via App.jsx) — this component has no header or footer of its own.
 *
 * Reusable, not Harsha-specific: every string below comes from `content`.
 * See src/data/harshaDeSilva.ts for the shape a new profile must match, and
 * src/data/profileContent.ts's `PortfolioProfileContent` for the contract.
 *
 * Order: the sections run in a citizen decision order — outcomes, votes and
 * promises lead; background trails. They used to carry a continuous 01-10
 * numbering across the tabs, which told a reader they were inside a
 * ten-part report they had entered at part four, and served no navigation
 * purpose since the numbers appeared nowhere else. The ORDER is unchanged
 * and still never restarts per tab; the "on this page" jump row under the
 * tab strip is what does the navigating now. `Tabs`/
 * `TabPanel` (src/components/Tabs.jsx) are the site's existing accessible tab
 * primitives, reused as-is: every panel renders unconditionally and `hidden`
 * does the hiding, so all four tabs' content is present in the prerendered
 * HTML regardless of which one a reader lands on (the TabPanel invariant —
 * see CLAUDE.md and src/lib/prerenderContent.test.ts). Six of the ten
 * sections render as real `<table>`s with fixed columns, `<th scope="row">`
 * row titles and a `data-label`-per-cell stacked-card fallback that only
 * applies below 768px — tablet widths keep the real table, scrolling it
 * horizontally where a table's own min-width demands more room than the
 * viewport gives it (see PortfolioProfile.css's table responsive rules) —
 * cards remain only where a comparison across rows is not the point
 * (promises, attribution, role summary). Tab selection
 * is plain component state, not synced to the URL: src/lib/profileTabs.ts
 * already owns that job for the site's other (education/political) tab pair
 * and is hardcoded to that pair's two ids.
 *
 * A same-page hash (a `SourceRefs` link, a bookmarked `#hds-votes`, a shared
 * `#hds-source-s1` URL) is resolved by one mount/`hashchange` effect: it
 * activates whichever tab contains the target, opens any closed `<details>`
 * ancestor natively (direct DOM `.open = true`, since those disclosures are
 * otherwise uncontrolled), and expands an interventions Details row if the
 * target lives inside one. SSR-safe: it only runs in an effect, never during
 * render, so it has no bearing on what a crawler receives.
 */

/* ==========================================================================
   Copy affordances — "Copy link" (section headings, source records) and
   "Copy citation" (source records only). Neither has any other visible
   confirmation when it succeeds — nothing on screen changes — so both use a
   toast; see /ask-sonner and docs/portfolio-and-shared-visuals-toasts-prompt.md
   section 4 for why this is the one place on this page a toast belongs.
   ========================================================================== */

/**
 * The canonical profile URL for whatever page this component is currently
 * rendered on — derived from the CURRENT path's last segment rather than
 * hardcoded, so a reader on the retired `/politician/harsha-de-silva` alias
 * still copies the canonical `/person/...` address, and so this stays correct
 * for any future profile this same component renders (see the file header:
 * this component is written to be reusable, not Harsha-specific).
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
 * "accessed on" date or a fabricated field. See harshaDeSilva.ts's
 * `SourceEntry` for what a source may or may not carry.
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
    // Never claim success. `description` carries the actual text so a
    // reader can select and copy it by hand — the manual fallback the
    // failure toast promises.
    () => { toast.error(failureMessage, { id: toastId, description: text }); return false; },
  );
}

/** Small icon-only button beside a section heading or source record. Never
    a link: it performs a clipboard write, not a navigation. `toastId` is
    stable per button (derived from what it copies, not autogenerated), which
    is what makes clicking the same button repeatedly update one toast
    instead of piling up a new one each time. */
function CopyButton({ iconName, ariaLabel, getText, successMessage, toastId }) {
  const { t } = useI18n();
  // A copy's only confirmation used to be a toast in the opposite corner of a
  // page this long — the button itself never changed. This crossfades the
  // button's own glyph to a check for 1600ms on a *successful* copy only; the
  // toast stays as-is, since it's the screen-reader announcement path.
  const [copied, setCopied] = useState(false);
  const timerRef = React.useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const handleClick = e => {
    // These buttons sit inside a heading (SectionHeading) that is sometimes
    // itself inside interactive ancestry elsewhere on the page — stopping
    // propagation here means a copy click can never be mistaken for a click
    // on whatever it's nested in.
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

/*
 * TWO vocabularies, and they stay two.
 *
 * `EVIDENCE_STATUS` answers "what does the evidence establish about this
 * ROW's outcome"; `VERIFICATION_STATUS` below answers "how solidly is this
 * ONE FACT sourced". They are different axes — a well-sourced record of an
 * intention is `verified` on one axis and `intended-only` on the other — and
 * collapsing them would turn a hope into a result, which is precisely the
 * failure a public record cannot afford.
 *
 * What changed is not the model but the words and where they are explained:
 * every tag now carries a plain-language hint on hover AND is listed once,
 * in full, in the "How to read these labels" panel (`LabelLegend` below), so
 * a reader meets the vocabulary in one place instead of inferring it from
 * two footnotes buried under different tables.
 */
const EVIDENCE_STATUS = {
  'source-linked': { label: 'Source-linked', hint: 'The claim points to an identified source document.' },
  'established': { label: 'Established', hint: 'The reviewed evidence supports the stated outcome.' },
  'not-established': { label: 'Not established', hint: 'The available sources do not establish the stated outcome. That is not the same as establishing that it did not happen.' },
  'conflicting': { label: 'Sources conflict', hint: 'Relevant sources disagree, or give materially inconsistent figures. Shown rather than resolved.' },
  'intended-only': { label: 'Intended, not established', hint: 'The sources establish an intention or a target, not an achieved outcome.' },
};

function EvidenceStatusTag({ status }) {
  const info = EVIDENCE_STATUS[status] ?? EVIDENCE_STATUS['not-established'];
  return <span className={`hds-profile__status-tag hds-profile__status-tag--${status}`} title={info.hint}>{info.label}</span>;
}

/** Verification pill for the outcome/voting/policy/career content — a
    distinct, simpler vocabulary from EVIDENCE_STATUS above: "verified" and
    "partially-verified" describe how well an indicator/vote is corroborated,
    "claim" marks a publicly reported position never converted into an
    individual roll-call. Not merged with EVIDENCE_STATUS: that map describes
    a programme row's outcome (intended vs established); this describes how
    solid the sourcing behind one fact is — different axes. */
const VERIFICATION_STATUS = {
  verified: { label: 'Verified', icon: 'check', tone: 'neutral', hint: 'Checked against the cited source.' },
  'partially-verified': { label: 'Partially verified', icon: 'halfCircle', tone: 'warning', hint: 'Part of this is confirmed by a source; part is not.' },
  claim: { label: 'Reported claim', icon: 'quote', tone: 'neutral', hint: 'A position reported publicly, never recorded as an individual vote or decision.' },
  /** The career summary's two additional states: a fact computed from other
      verified facts rather than stated by a source directly (Σ), and a fact
      the record doesn't establish at all (?) — a plain text glyph rather
      than another SVG path, since both are single characters, not icons. */
  derived: { label: 'Derived', glyph: 'Σ', tone: 'info', hint: 'Calculated from other recorded facts rather than stated by a source.' },
  unverified: { label: 'Not established', glyph: '?', tone: 'muted', hint: 'No source on record establishes this.' },
};

function VerificationTag({ status }) {
  const info = VERIFICATION_STATUS[status];
  if (!info) return null;
  return <span className={`hds-profile__verify-tag hds-profile__verify-tag--${info.tone}`} title={info.hint}>
    {info.icon ? <Icon name={info.icon} /> : <span className="hds-profile__verify-tag-glyph" aria-hidden="true">{info.glyph}</span>}
    {info.label}
  </span>;
}

/**
 * Both vocabularies, written out once, where the reader can reach them from
 * any table that uses them.
 *
 * This replaces three separate inline paragraphs that each explained part of
 * the system underneath the table that happened to need it — one under
 * Programmes explaining "intended only", one under Role explaining that the
 * portfolio summary is not one of the five evidence values, one under
 * Programmes explaining that "Sources 02" and "S12" are different numbering
 * systems. A reader who landed on the Policies tab met the tags with no
 * explanation at all.
 */
function LabelLegend({ sourceCount }) {
  return <details className="hds-profile__legend" id="hds-labels">
    <summary>How to read the labels on this page</summary>
    <div className="hds-profile__legend-body">
      <div>
        <h3 className="hds-profile__sub-heading">How solidly is a fact sourced?</h3>
        <dl className="hds-profile__legend-list">
          {Object.entries(VERIFICATION_STATUS).map(([key, info]) => (
            <div key={key}>
              <dt><VerificationTag status={key}/></dt>
              <dd>{info.hint}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="hds-profile__sub-heading">What does the evidence establish?</h3>
        <dl className="hds-profile__legend-list">
          {Object.entries(EVIDENCE_STATUS).map(([key, info]) => (
            <div key={key}>
              <dt><EvidenceStatusTag status={key}/></dt>
              <dd>{info.hint}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="hds-profile__sub-heading">Where do the source numbers point?</h3>
        <p className="hds-profile__legend-note">
          A numbered reference like <span className="hds-profile__row-sources-label">Sources</span>{' '}
          <strong>02</strong> points to one of the {sourceCount} records in{' '}
          <a href="#hds-sources">Evidence &amp; sources</a> at the foot of this page.
          A token marked <em>source pending</em> is a reference from the research file whose
          source record has not been transcribed yet — it is shown, rather than hidden, so the
          page never looks better sourced than it is, and it is never a link, because there is
          nothing yet for it to link to.
        </p>
      </div>
    </div>
  </details>;
}

/*
 * S1..S22 are references from the research file whose source records have not
 * been transcribed into `sources` yet (see the comment on
 * OutcomeIndicatorRow in harshaDeSilva.ts). They were rendered as bare
 * dotted-underline tokens — "S19, S20" under a figure — which reads either as
 * a broken link or as an internal code the reader is expected to know. They
 * are still never links (nothing exists yet for them to point at, and a
 * citation that looks live but resolves to nothing is worse than none), but
 * they now say in words what they are. `PENDING_HINT` is the one place that
 * wording lives so the inline and block forms cannot drift apart.
 */
const PENDING_HINT = 'Reference from the research file. Its source record has not been transcribed into Evidence & sources yet, so it is not a link.';

/** Inline "(source pending: S1, S2)" after a short value on the same line. */
function InlineCite({ ids }) {
  if (!ids?.length) return null;
  return <span className="hds-profile__inline-cite" title={PENDING_HINT}>
    {' ('}
    <span className="hds-profile__pending-cite-label">source pending:</span>{' '}
    {ids.map((id, i) => <React.Fragment key={id}>
      {i > 0 ? ', ' : ''}
      <span className="hds-profile__pending-cite-token">{id}</span>
    </React.Fragment>)}
    {')'}
  </span>;
}

/** The block form, under a table cell. Distinct from SourceRefs below, which
    links a row to real, numbered entries in Evidence & sources. */
function PendingCitations({ ids, note }) {
  if (note) return <p className="hds-profile__pending-cite">{note}</p>;
  if (!ids?.length) return null;
  return <p className="hds-profile__pending-cite" title={PENDING_HINT}>
    <span className="hds-profile__pending-cite-label">Source pending</span>
    {' · '}
    {ids.map((id, i) => <React.Fragment key={id}>
      {i > 0 ? ', ' : ''}
      <span className="hds-profile__pending-cite-token">{id}</span>
    </React.Fragment>)}
  </p>;
}

/* ==========================================================================
   Mobile row disclosure
   --------------------------------------------------------------------------
   Below 768px every table on this page becomes a stack of cards, one per
   row, with each cell labelled by its column name. That is technically
   responsive and, on a seven-column table, produces a 600px-tall card per
   promise — the reader scrolls through "Expected outcome", "Action taken"
   and "Documented outcome" in full before reaching the next row's title.
   Tablet widths (768-1199px) never reach this: they keep the real table and
   scroll it horizontally instead (see PortfolioProfile.css) — only a
   genuine phone width trades column comparison for a stack of cards.

   So the cards lead with what the row IS and hold the rest one tap away.
   Nothing is removed and nothing moves: the same cells, in the same DOM
   order, with the secondary ones marked `data-secondary` and hidden by CSS
   until the row is expanded. Desktop is untouched — every column shows, as
   it always did, because a wide table is the right shape on a wide screen.

   Which cells count as secondary is decided per table, at the call site,
   and the rule is the audit's: what happened first, then when and what
   category, then evidence detail, then methodological caution.
   ========================================================================== */

function useExpandedRows() {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = id => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return [expanded, toggle];
}

/** Mobile-only trailing cell; `display: none` on desktop, where the columns
    it reveals are already on screen. The visually-hidden half of the label
    names the row, so a screen reader hears "More details, Suwa Seriya" and
    not twelve identical "More details" buttons. */
function RowMoreCell({ rowId, rowLabel, expanded, onToggle }) {
  return <td className="hds-profile__row-more">
    <button
      type="button"
      className="hds-profile__row-more-btn"
      aria-expanded={expanded}
      onClick={() => onToggle(rowId)}
    >
      <span>{expanded ? 'Fewer details' : 'More details'}</span>
      <span className="visually-hidden"> — {rowLabel}</span>
      <Icon name="chevronDown" className="hds-profile__details-chevron"/>
    </button>
  </td>;
}

/** The header cell that pairs with RowMoreCell, so the row and the header
    row keep the same cell count in the DOM. Hidden in both layouts: on
    desktop and tablet the whole column is `display: none`, and below 768px
    the entire `thead` is clipped away by the stacked-card rules. */
function RowMoreHead() {
  return <th scope="col" className="hds-profile__row-more-head">Details</th>;
}

/** The small "Sources 02 · 04" line under a programme row, linking to the
    numbered records in the Evidence & sources utility. */
function SourceRefs({ sources, ids }) {
  const resolved = (ids ?? [])
    .map(id => ({ id, index: sources.findIndex(s => s.id === id) }))
    .filter(({ index }) => index !== -1);
  if (!resolved.length) return null;
  return <p className="hds-profile__row-sources">
    <span className="hds-profile__row-sources-label">Sources</span>
    {resolved.map(({ id, index }, i) => {
      const n = String(index + 1).padStart(2, '0');
      const source = sources[index];
      return <React.Fragment key={id}>
        {i > 0 ? <span aria-hidden="true"> · </span> : ' '}
        <a href={`#hds-source-${id}`} aria-label={`Source ${n}: ${source.organization}`}>{n}</a>
      </React.Fragment>;
    })}
  </p>;
}

/** No copy-link button when `collapsible`: that heading lives inside a native
    `<summary>` (CollapsibleSection below), where nesting a real `<button>`
    means every click needs `stopPropagation` just to keep from also
    toggling the disclosure — copying a link to "Evidence & sources" itself
    is a marginal case not worth that interaction risk. `label` is a plain-
    text stand-in for `children` (which is often JSX, not a string) used only
    for the copy button's accessible name — required whenever a button
    renders, i.e. whenever `id` is set and the heading isn't collapsible. */
function SectionHeading({ id, collapsible, label, children }) {
  return <h2 id={id} className="hds-profile__heading">
    {children}
    {collapsible ? <Icon name="chevronDown" className="hds-profile__collapse-icon" /> : null}
    {!collapsible && id && label ? <CopyLinkButton id={id} label={label}/> : null}
  </h2>;
}

/** The Evidence & sources utility and the Research notes disclosure both
    collapse to just their title by default — a native <details>/<summary>
    disclosure, not JS-driven conditional rendering, so the collapsed content
    stays in the DOM (and the prerendered HTML) exactly like TabPanel's
    `hidden` — see the invariant in CLAUDE.md. */
function CollapsibleSection({ id, heading, children }) {
  return <details className="hds-profile__section hds-profile__section--collapsible">
    <summary className="hds-profile__collapsible-summary">
      <SectionHeading id={id} collapsible>{heading}</SectionHeading>
    </summary>
    <div className="hds-profile__collapsible-body">
      {children}
    </div>
  </details>;
}

/** Quiet visual label placed above the Research notes disclosure — plain
    structural copy, not a data-file string, marking that block as background
    research rather than the record itself. */
function TierPill({ children }) {
  return <p className="hds-profile__tier-pill">{children}</p>;
}

/* ==========================================================================
   Portfolio at a glance — a quiet, unnumbered strip between the hero and the
   tabs. Deliberately not an <h2>: it is not a competing section, just load-
   bearing context (which office, what term) a reader shouldn't have to click
   a tab to see.
   ========================================================================== */

function GlanceStrip({ data, sources }) {
  return <section className="hds-profile__meta-strip" id="hds-glance" aria-label="Portfolio at a glance">
    <p className="hds-profile__glance-label">Portfolio at a glance</p>
    <dl className="hds-profile__meta-grid">
      <div className="hds-profile__meta-item">
        <dt>Role</dt>
        <dd>{data.hero.focusRole}</dd>
      </div>
      <div className="hds-profile__meta-item">
        <dt>Term</dt>
        <dd>{data.hero.tenure}</dd>
      </div>
      <div className="hds-profile__meta-item">
        <dt>Portfolio</dt>
        <dd>{data.portfolioAreas.join(' · ')}</dd>
      </div>
      {/* The state of the RECORD, beside the facts it qualifies rather than
          alone at the very bottom of the page, where a reader who never
          scrolled that far never learned it. */}
      <div className="hds-profile__meta-item">
        <dt>Record status</dt>
        <dd>{data.recordStatus.label}</dd>
      </div>
    </dl>
    <p className="hds-profile__meta-footer">
      {data.responsibilities.institutions.length} institutions ·{' '}
      <a href="#hds-sources">{sources.length} source records</a>
    </p>
  </section>;
}

/* ==========================================================================
   Tier A — Performance: outcome indicators, promises, major programmes and
   interventions, in that order.
   ========================================================================== */

function OutcomeIndicatorsTable({ data }) {
  const [expanded, toggleRow] = useExpandedRows();
  return <section className="hds-profile__section" aria-labelledby="hds-outcomes">
    <SectionHeading id="hds-outcomes" label="Performance / outcome indicators">Performance / outcome indicators</SectionHeading>
    <p className="hds-profile__section-intro">{data.outcomeIndicators.intro}</p>
    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--outcomes" aria-labelledby="hds-outcomes">
        <colgroup>
          <col className="hds-profile__col--oi-indicator" />
          <col className="hds-profile__col--oi-baseline" />
          <col className="hds-profile__col--oi-later" />
          <col className="hds-profile__col--oi-voter" />
          <col className="hds-profile__col--oi-caution" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Indicator</th>
            <th scope="col">2015 / Baseline</th>
            <th scope="col">Later reference point</th>
            <th scope="col">What it tells the voter</th>
            <th scope="col">Attribution caution</th>
            <RowMoreHead/>
          </tr>
        </thead>
        <tbody>
          {data.outcomeIndicators.rows.map(row => (
            <tr key={row.id} id={`hds-indicator-${row.id}`} data-expanded={expanded.has(row.id) ? 'true' : undefined}>
              <th scope="row" data-label="Indicator" className="hds-profile__cell--title">
                {row.indicator}
                <VerificationTag status={row.verification} />
              </th>
              <td data-label="2015 / Baseline">{row.baseline}</td>
              <td data-label="Later reference point">{row.laterReference}</td>
              <td data-label="What it tells the voter">{row.voterTakeaway}</td>
              {/* The caution is the row's methodological small print — the
                  last thing a reader needs and the first thing that should
                  move behind a tap on a phone. */}
              <td data-label="Attribution caution" data-secondary="true">
                {row.attributionCaution}
                <PendingCitations ids={row.citeIds} />
              </td>
              <RowMoreCell rowId={row.id} rowLabel={row.indicator} expanded={expanded.has(row.id)} onToggle={toggleRow}/>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>;
}

function PromisesSection({ data }) {
  const [expanded, toggleRow] = useExpandedRows();
  return <section className="hds-profile__section" aria-labelledby="hds-promises">
    <SectionHeading id="hds-promises" label="Promises & outcomes">Promises &amp; outcomes</SectionHeading>
    <p className="hds-profile__section-intro">{data.intro}</p>

    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--promises" aria-labelledby="hds-promises">
        <colgroup>
          <col className="hds-profile__col--promise-title" />
          <col className="hds-profile__col--promise-date" />
          <col className="hds-profile__col--promise-expected" />
          <col className="hds-profile__col--promise-action" />
          <col className="hds-profile__col--promise-status" />
          <col className="hds-profile__col--promise-documented" />
          <col className="hds-profile__col--promise-source" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Promise / public commitment</th>
            <th scope="col">Date</th>
            <th scope="col">Expected outcome</th>
            <th scope="col">Action taken</th>
            <th scope="col">Status</th>
            <th scope="col">Documented outcome</th>
            <th scope="col">Source</th>
            <RowMoreHead/>
          </tr>
        </thead>
        <tbody>
          {data.cards.map(card => (
            <tr key={card.id} data-expanded={expanded.has(card.id) ? 'true' : undefined}>
              <th scope="row" data-label="Promise / public commitment" className="hds-profile__cell--title">
                {card.title}
              </th>
              <td data-label="Date">{card.date}</td>
              {/* What was promised and what was done are the detail; what
                  came of it is the answer, so status and documented outcome
                  stay visible and these two fold away. */}
              <td data-label="Expected outcome" data-secondary="true">{card.expectedOutcome}</td>
              <td data-label="Action taken" data-secondary="true">{card.actionTaken}</td>
              <td data-label="Status">{card.status}</td>
              <td data-label="Documented outcome">{card.documentedOutcome}</td>
              <td data-label="Source" data-secondary="true">
                <PendingCitations ids={card.citeIds} note={card.citeNote} />
              </td>
              <RowMoreCell rowId={card.id} rowLabel={card.title} expanded={expanded.has(card.id)} onToggle={toggleRow}/>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>;
}

function ProgrammesTable({ data }) {
  const { name, programmes, sources, programmesIntro, evidenceNote } = data;
  const [expanded, toggleRow] = useExpandedRows();
  return <section className="hds-profile__section" aria-labelledby="hds-programmes">
    <SectionHeading id="hds-programmes" label={`Major programmes and interventions documented during ${name}'s tenure`}>
      Major programmes and interventions documented during {name}&apos;s tenure
    </SectionHeading>
    <p className="hds-profile__section-intro">{programmesIntro}</p>

    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--programmes" aria-labelledby="hds-programmes">
        <colgroup>
          <col className="hds-profile__col--prog-title" />
          <col className="hds-profile__col--prog-type" />
          <col className="hds-profile__col--prog-purpose" />
          <col className="hds-profile__col--prog-outcome" />
          <col className="hds-profile__col--prog-evidence" />
          <col className="hds-profile__col--prog-financial" />
          <col className="hds-profile__col--prog-people" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Programme / intervention</th>
            <th scope="col">Type</th>
            <th scope="col">Purpose</th>
            <th scope="col">Longer-term outcome</th>
            <th scope="col">Evidence</th>
            <th scope="col">Financial evidence</th>
            <th scope="col">Effect on people</th>
            <RowMoreHead/>
          </tr>
        </thead>
        <tbody>
          {programmes.map(row => (
            <tr key={row.id} data-expanded={expanded.has(row.id) ? 'true' : undefined}>
              <th scope="row" data-label="Programme / intervention" className="hds-profile__cell--title">
                {row.title}
                <SourceRefs sources={sources} ids={row.sourceIds} />
              </th>
              <td data-label="Type" data-secondary="true">{row.type}</td>
              <td data-label="Purpose">{row.purpose}</td>
              <td data-label="Longer-term outcome">
                {/* What follows is either something the source states was
                    INTENDED, or something evidence has ESTABLISHED actually
                    happened — different claims, and blending them under one
                    silent label is how a hope reads like a result. Derived
                    from the row's own evidenceStatus, never a second,
                    separately-authored field that could drift from it. */}
                <span className="hds-profile__outcome-kind">
                  {row.evidenceStatus === 'intended-only' ? 'Intended effect' : 'Outcome'}
                </span>
                {row.outcome}
              </td>
              <td data-label="Evidence"><EvidenceStatusTag status={row.evidenceStatus} /></td>
              <td data-label="Financial evidence" data-secondary="true">
                <span className="hds-profile__cell--muted">{row.financialEvidence}</span>
              </td>
              <td data-label="Effect on people" data-secondary="true">{row.peopleEffect}</td>
              <RowMoreCell rowId={row.id} rowLabel={row.title} expanded={expanded.has(row.id)} onToggle={toggleRow}/>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* The note itself is the data file's own wording about this table's
        evidence terms and stays verbatim. The paragraph of meta-explanation
        that used to follow it — which vocabulary is which, and which
        numbering system points where — is now stated once for the whole
        page in `LabelLegend`, instead of under whichever table happened to
        need it first. */}
    <p className="hds-profile__note">
      <strong>{evidenceNote.term}</strong> {evidenceNote.body}{' '}
      <a href="#hds-labels">How to read the labels on this page</a>.
    </p>
  </section>;
}

/** A programme/intervention row from the fuller documented-career pass
    (Suwa Seriya, Enterprise Sri Lanka, the food-supply Gazette, Dambulla,
    the export-reform agenda) — a separate research pass from `programmes`
    above, kept as its own section rather than merged row-for-row with it, so
    the two evidentiary scopes are never blended into one list pretending to
    be a single source. */
function InterventionRow({ row, indicators, expanded, onToggle }) {
  const linked = (row.indicatorIds ?? [])
    .map(id => indicators.find(indicator => indicator.id === id))
    .filter(Boolean);
  const canExpand = row.hasDetails && linked.length > 0;
  const detailId = `hds-interventions-detail-${row.id}`;

  return <>
    <tr id={`hds-intervention-${row.id}`}>
      <th scope="row" data-label="Programme / intervention" className="hds-profile__cell--title">{row.title}</th>
      <td data-label="Period">{row.period}</td>
      <td data-label="Documented role">{row.documentedRole}</td>
      <td data-label="Status / outcome">{row.statusOutcome}</td>
      <td data-label="Evidence">
        <VerificationTag status={row.evidence} />
        <PendingCitations ids={row.citeIds} />
      </td>
      <td data-label="Details">
        {canExpand
          ? <button
              type="button"
              className="hds-profile__details-link"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => onToggle(row.id)}
            >
              Details
              <Icon name="chevronDown" className="hds-profile__details-chevron"/>
            </button>
          : <span className="hds-profile__cell--muted">No further detail</span>}
      </td>
    </tr>
    <tr
      id={detailId}
      hidden={!expanded}
      data-intervention-detail-for={row.id}
      className="hds-profile__details-row"
    >
      <td colSpan={6} className="hds-profile__details-cell">
        {linked.map(indicator => (
          <div className="hds-profile__details-indicator" key={indicator.id}>
            <p className="hds-profile__field-label">
              {indicator.indicator} <VerificationTag status={indicator.verification} />
            </p>
            <p className="hds-profile__field-value">Baseline: {indicator.baseline}</p>
            <p className="hds-profile__field-value">Later reference point: {indicator.laterReference}</p>
            <p className="hds-profile__field-value">
              Attribution caution: {indicator.attributionCaution}
              <InlineCite ids={indicator.citeIds} />
            </p>
            <a href={`#hds-indicator-${indicator.id}`}>See in 01</a>
          </div>
        ))}
      </td>
    </tr>
  </>;
}

function InterventionsTable({ data, expandedInterventions, onToggleIntervention }) {
  const { intro, rows } = data.detailedAnalysis.programmeInterventions;
  const indicators = data.outcomeIndicators.rows;
  return <section className="hds-profile__section" aria-labelledby="hds-interventions">
    <SectionHeading id="hds-interventions" label="Programmes & interventions">Programmes &amp; interventions</SectionHeading>
    <p className="hds-profile__section-intro">{intro}</p>

    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--interventions" aria-labelledby="hds-interventions">
        <colgroup>
          <col className="hds-profile__col--intv-title" />
          <col className="hds-profile__col--intv-period" />
          <col className="hds-profile__col--intv-role" />
          <col className="hds-profile__col--intv-status" />
          <col className="hds-profile__col--intv-evidence" />
          <col className="hds-profile__col--intv-details" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Programme / intervention</th>
            <th scope="col">Period</th>
            <th scope="col">Documented role</th>
            <th scope="col">Status / outcome</th>
            <th scope="col">Evidence</th>
            <th scope="col" className="visually-hidden">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <InterventionRow
              key={row.id}
              row={row}
              indicators={indicators}
              expanded={expandedInterventions.has(row.id)}
              onToggle={onToggleIntervention}
            />
          ))}
        </tbody>
      </table>
    </div>
  </section>;
}

/* ==========================================================================
   Tier B — Record: voting/decision record, then responsibility & attribution.
   ========================================================================== */

/** Year / Evidence-type filters are real client-side state, not decoration —
    the "N of M records shown" count updates live. Evidence options are
    derived from the data present rather than hardcoded, so a value like
    "partially-verified" is never silently unfilterable. */
function VotingRecordSection({ data }) {
  const [year, setYear] = useState('all');
  const [evidence, setEvidence] = useState('all');
  const [expanded, toggleRow] = useExpandedRows();

  const years = useMemo(
    () => Array.from(new Set(data.rows.map(row => row.year))).sort((a, b) => a - b),
    [data.rows],
  );
  const evidenceOptions = useMemo(
    () => Array.from(new Set(data.rows.map(row => row.evidence))),
    [data.rows],
  );

  const filtered = data.rows.filter(row =>
    (year === 'all' || row.year === Number(year)) &&
    (evidence === 'all' || row.evidence === evidence),
  );

  return <section className="hds-profile__section" aria-labelledby="hds-votes">
    <SectionHeading id="hds-votes" label="Voting & decision record">Voting &amp; decision record</SectionHeading>
    <p className="hds-profile__section-intro">{data.intro}</p>

    <div className="hds-profile__voting-controls">
      <label className="hds-profile__filter">
        <span>Year</span>
        <select value={year} onChange={e => setYear(e.target.value)}>
          <option value="all">All</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="hds-profile__filter">
        <span>Evidence type</span>
        <select value={evidence} onChange={e => setEvidence(e.target.value)}>
          <option value="all">All</option>
          {evidenceOptions.map(opt => (
            <option key={opt} value={opt}>{VERIFICATION_STATUS[opt]?.label ?? opt}</option>
          ))}
        </select>
      </label>
      <p className="hds-profile__voting-count">{filtered.length} of {data.rows.length} records shown</p>
    </div>

    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--voting" aria-labelledby="hds-votes">
        <colgroup>
          <col className="hds-profile__col--vdate" />
          <col className="hds-profile__col--vmatter" />
          <col className="hds-profile__col--vaction" />
          <col className="hds-profile__col--vresult" />
          <col className="hds-profile__col--vevidence" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Matter</th>
            <th scope="col">Documented action</th>
            <th scope="col">Result</th>
            <th scope="col">Evidence</th>
            <RowMoreHead/>
          </tr>
        </thead>
        <tbody>
          {filtered.map(row => (
            <tr key={row.id} data-expanded={expanded.has(row.id) ? 'true' : undefined}>
              <th scope="row" data-label="Date" className="hds-profile__cell--title">{row.date}</th>
              <td data-label="Matter">{row.matter}</td>
              <td data-label="Documented action">
                {row.documentedAction}
                {row.actionCaveat ? <span className="hds-profile__row-caveat">{row.actionCaveat}</span> : null}
              </td>
              <td data-label="Result">{row.result}</td>
              <td data-label="Evidence" data-secondary="true">
                <VerificationTag status={row.evidence} />
                <PendingCitations ids={row.citeIds} />
              </td>
              <RowMoreCell rowId={row.id} rowLabel={row.matter} expanded={expanded.has(row.id)} onToggle={toggleRow}/>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <p className="hds-profile__note">{data.scopeNote}</p>
  </section>;
}

function AttributionSection({ data }) {
  const { intro, levels } = data.detailedAnalysis.responsibilityAttribution;
  return <section className="hds-profile__section" aria-labelledby="hds-attribution">
    <SectionHeading id="hds-attribution" label="Responsibility & attribution">Responsibility &amp; attribution</SectionHeading>
    <p className="hds-profile__section-intro">{intro}</p>
    <div className="hds-profile__triple-grid">
      {levels.map(level => (
        <div className="hds-profile__card" key={level.id}>
          <h3 className="hds-profile__sub-heading">{level.label}</h3>
          <p>{level.body}</p>
        </div>
      ))}
    </div>
  </section>;
}

/* ==========================================================================
   Tier C — Policies: policy positions.
   ========================================================================== */

function PoliciesTable({ data }) {
  const { intro, rows } = data.detailedAnalysis.policyPositions;
  const [expanded, toggleRow] = useExpandedRows();
  return <section className="hds-profile__section" aria-labelledby="hds-policies">
    <SectionHeading id="hds-policies" label="Policies & public positions">Policies &amp; public positions</SectionHeading>
    <p className="hds-profile__section-intro">{intro}</p>
    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--policies" aria-labelledby="hds-policies">
        <colgroup>
          <col className="hds-profile__col--pol-issue" />
          <col className="hds-profile__col--pol-position" />
          <col className="hds-profile__col--pol-date" />
          <col className="hds-profile__col--pol-type" />
          <col className="hds-profile__col--pol-evidence" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Issue</th>
            <th scope="col">Position</th>
            <th scope="col">Date</th>
            <th scope="col">Evidence type</th>
            <th scope="col">Evidence</th>
            <RowMoreHead/>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} data-expanded={expanded.has(row.id) ? 'true' : undefined}>
              <th scope="row" data-label="Issue" className="hds-profile__cell--title">{row.issue}</th>
              <td data-label="Position">{row.position}</td>
              <td data-label="Date">{row.date}</td>
              <td data-label="Evidence type" data-secondary="true">{row.evidenceType}</td>
              <td data-label="Evidence" data-secondary="true">
                <VerificationTag status={row.evidence} />
                <PendingCitations ids={row.citeIds} note={row.citeNote} />
              </td>
              <RowMoreCell rowId={row.id} rowLabel={row.issue} expanded={expanded.has(row.id)} onToggle={toggleRow}/>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>;
}

/* ==========================================================================
   Tier D — Profile: role & responsibilities, full career detail, research.
   ========================================================================== */

function RoleSection({ data }) {
  const { responsibilities } = data;
  return <section className="hds-profile__section" aria-labelledby="hds-role">
    <SectionHeading id="hds-role" label="Position and responsibilities">Position and responsibilities</SectionHeading>

    <div className="hds-profile__card-grid">
      <div className="hds-profile__card">
        <h3 className="hds-profile__sub-heading">Role summary</h3>
        <p>{responsibilities.roleSummary}</p>
      </div>
      <div className="hds-profile__card">
        <h3 className="hds-profile__sub-heading">Portfolio institutions</h3>
        <ul className="hds-profile__institutions">
          {responsibilities.institutions.map(name => <li key={name}>{name}</li>)}
        </ul>
      </div>
    </div>

    <div className="hds-profile__card hds-profile__card--scope hds-profile__card--full">
      <h3 className="hds-profile__sub-heading">Scope</h3>
      <p>{responsibilities.scope}</p>
      <p className="hds-profile__cell--muted">{responsibilities.authorityNote}</p>
    </div>

    <p className="hds-profile__footnote">
      This is a portfolio summary, not an evidence-graded record: it carries none of the
      status labels the tables on this page use. <a href="#hds-sources">Evidence &amp; sources</a>
      {' '}lists what each claim here rests on.
    </p>
  </section>;
}

function CareerDetailSection({ data }) {
  const { detailedAnalysis, education } = data;
  const { careerDetail } = detailedAnalysis;
  const { facts, positions, documentedResponsibilities, institutionsReferenced } = careerDetail;

  return <section className="hds-profile__section" aria-labelledby="hds-career">
    <SectionHeading id="hds-career" label="Detailed position & responsibilities">Detailed position &amp; responsibilities</SectionHeading>
    <p className="hds-profile__section-intro">{careerDetail.intro}</p>

    <h3 className="hds-profile__sub-heading">{careerDetail.summaryHeading}</h3>
    <p className="hds-profile__section-intro">{careerDetail.summaryNote}</p>
    <dl className="hds-profile__career-grid">
      {facts.map(fact => (
        <div className="hds-profile__career-item" key={fact.id}>
          <dt>
            {fact.label}
            <VerificationTag status={fact.verification} />
          </dt>
          <dd>
            {fact.note ? (
              <span className="hds-profile__cell--muted">{fact.note}</span>
            ) : fact.list ? (
              <>
                <ul className="hds-profile__glance-list">
                  {fact.list.map(item => <li key={item}>{item}</li>)}
                </ul>
                <InlineCite ids={fact.citeIds} />
              </>
            ) : (
              <>
                {fact.value}
                <InlineCite ids={fact.citeIds} />
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>

    <h3 className="hds-profile__sub-heading hds-profile__sub-heading--spaced">{careerDetail.positionsHeading}</h3>
    <div className="hds-profile__table-wrap">
      <table className="hds-profile__table hds-profile__table--positions" aria-labelledby="hds-career">
        <colgroup>
          <col className="hds-profile__col--pos-title" />
          <col className="hds-profile__col--pos-institution" />
          <col className="hds-profile__col--pos-period" />
          <col className="hds-profile__col--pos-source" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Institution</th>
            <th scope="col">Period</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(pos => (
            <tr
              key={pos.id}
              className={pos.period.startsWith('Current') ? 'hds-profile__position-row--current' : undefined}
            >
              <th scope="row" data-label="Position" className="hds-profile__cell--title">{pos.title}</th>
              <td data-label="Institution">{pos.institution}</td>
              <td data-label="Period" className="hds-profile__cell--mono">{pos.period}</td>
              <td data-label="Source">
                <PendingCitations ids={[pos.citeId]}/>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="hds-profile__card-grid">
      <div className="hds-profile__card hds-profile__card--scope">
        <h3 className="hds-profile__sub-heading">Documented responsibilities</h3>
        <p>{documentedResponsibilities.body}</p>
        <p className="hds-profile__cell--muted">{documentedResponsibilities.note}</p>
      </div>
      <div className="hds-profile__card">
        <h3 className="hds-profile__sub-heading">Portfolio institutions referenced in sources</h3>
        <ul className="hds-profile__institutions hds-profile__institutions--single">
          {institutionsReferenced.map(name => <li key={name}>{name}</li>)}
        </ul>
      </div>
    </div>

    {education?.length ? (
      <div className="hds-profile__card">
        <h3 className="hds-profile__sub-heading">Education</h3>
        <ul className="hds-profile__education-list">
          {education.map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
    ) : null}
  </section>;
}

/** De-emphasised by design — a closed disclosure with a quiet "Evidence
    layer" label above it, rather than a top-level tab or a section competing
    for attention with Career/Positions/Education above it. Still a native
    <details>, so the notes stay in the prerendered HTML either way. */
function ResearchNotesSection({ data }) {
  const { intro, notes } = data.detailedAnalysis.researchNotes;
  return <>
    <TierPill>For researchers</TierPill>
    <CollapsibleSection id="hds-research" heading="Research notes &amp; historical context">
      <p className="hds-profile__section-intro">{intro}</p>
      <div className="hds-profile__triple-grid">
        {notes.map(note => (
          <div className="hds-profile__card" key={note.id}>
            <h3 className="hds-profile__sub-heading">{note.label}</h3>
            <p>{note.body}</p>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  </>;
}

/* ==========================================================================
   Page
   ========================================================================== */

/**
 * The four tabs, named for what a reader will find in them.
 *
 * They used to be labelled "Tier A / Performance", "Tier B / Record" and so
 * on — the research taxonomy the content was assembled under, printed as the
 * primary navigation of a public page. A visitor has no way to know what
 * Tier B is, and the eyebrow took as much vertical space and more visual
 * weight than the only word that meant anything. The grouping is unchanged;
 * the internal names are simply no longer the reader's problem. `sections`
 * drives the per-tab "on this page" jump row and must list exactly the
 * section ids that panel renders, in order.
 */
const PROFILE_TABS = [
  {
    id: 'performance',
    label: 'Performance',
    shortLabel: 'Performance',
    icon: 'award',
    sections: [
      { id: 'hds-outcomes', title: 'Outcome indicators', shortTitle: 'Outcome' },
      { id: 'hds-promises', title: 'Promises' },
      { id: 'hds-programmes', title: 'Major programmes', shortTitle: 'Programmes' },
      { id: 'hds-interventions', title: 'Interventions', shortTitle: 'Actions' },
    ],
  },
  {
    id: 'record',
    label: 'Decisions & voting',
    shortLabel: 'Decisions',
    icon: 'scale',
    sections: [
      { id: 'hds-votes', title: 'Voting record' },
      { id: 'hds-attribution', title: 'Responsibility' },
    ],
  },
  {
    id: 'policies',
    label: 'Policy positions',
    shortLabel: 'Positions',
    icon: 'document',
    sections: [{ id: 'hds-policies', title: 'Policies & public positions' }],
  },
  {
    id: 'profile',
    label: 'Role & career',
    shortLabel: 'Career',
    icon: 'user',
    sections: [
      { id: 'hds-role', title: 'Position' },
      { id: 'hds-career', title: 'Career detail' },
      { id: 'hds-research', title: 'Research notes' },
    ],
  },
];

/** Resolves a same-page hash: activates the tab containing the target,
    opens any closed native <details> ancestor, and expands an interventions
    Details row if the target lives inside one, then scrolls it into view.
    Effect-only — never touches `window`/`document` during render, so it has
    no bearing on the prerendered HTML. */
/**
 * Scroll to `el` once it actually HAS a layout box.
 *
 * The obvious version of this is one `requestAnimationFrame` then
 * `scrollIntoView()`, and it silently did nothing for the case it was
 * written for. Arriving at `/person/harsha-de-silva#hds-votes` targets a
 * section inside a `hidden` tab panel: the browser's own fragment scroll
 * finds nothing to scroll to, `focusHash` asks React to switch tabs, and a
 * single frame later React has not necessarily committed that switch — so
 * the element is still `display: none`, `scrollIntoView()` is a no-op on it,
 * and the reader lands at the top of the page a thousand pixels above the
 * section they linked to. The tab was right; the position was not.
 *
 * `getClientRects().length` is the test because it is the actual question —
 * "is this element laid out?" — rather than a guess at how many frames React
 * needs. The attempt budget is what keeps a target that never becomes
 * visible (a hash naming an element inside a panel that failed to render)
 * from spinning a frame loop for the life of the page.
 */
function scrollWhenLaidOut(el, attempts = 10) {
  if (el.getClientRects().length) {
    el.scrollIntoView();
    return;
  }
  if (attempts > 0) requestAnimationFrame(() => scrollWhenLaidOut(el, attempts - 1));
}

function useHashNavigation(setActiveTab, setExpandedInterventions) {
  useEffect(() => {
    function focusHash() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const el = document.getElementById(hash);
      if (!el) return;

      const panel = el.closest('[role="tabpanel"]');
      if (panel) setActiveTab(panel.id.replace('hds-tab-panel-', ''));

      let details = el.closest('details');
      while (details) {
        details.open = true;
        details = details.parentElement ? details.parentElement.closest('details') : null;
      }

      const detailRow = el.closest('[data-intervention-detail-for]');
      if (detailRow) {
        const rowId = detailRow.dataset.interventionDetailFor;
        setExpandedInterventions(prev => {
          if (prev.has(rowId)) return prev;
          return new Set(prev).add(rowId);
        });
      }

      scrollWhenLaidOut(el);
    }

    focusHash();
    window.addEventListener('hashchange', focusHash);
    return () => window.removeEventListener('hashchange', focusHash);
  }, [setActiveTab, setExpandedInterventions]);
}

export default function PortfolioProfile({ content }) {
  const data = content;
  const sources = data.sources;
  const [activeTab, setActiveTab] = useState('performance');
  const [expandedInterventions, setExpandedInterventions] = useState(() => new Set());
  const portraitRef = React.useRef(null);
  // 'pending' fades the portrait in on load; 'instant' (a cached/already-
  // decoded image — the common case on a prerendered page) and 'faded' both
  // render at full opacity. This image is at or near the LCP element, so
  // fading up a portrait that was already complete on mount would delay the
  // recorded LCP for no benefit.
  const [portraitState, setPortraitState] = useState('pending');
  useEffect(() => {
    if (portraitRef.current?.complete) setPortraitState('instant');
  }, []);

  const toggleIntervention = id => setExpandedInterventions(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useHashNavigation(setActiveTab, setExpandedInterventions);

  const tabs = useMemo(() => PROFILE_TABS.map(tab => ({ id: tab.id, label: tab.label, shortLabel: tab.shortLabel, icon: tab.icon })), []);
  const sectionsOf = id => PROFILE_TABS.find(tab => tab.id === id)?.sections ?? [];
  /**
   * The per-panel "on this page" row. Rendered INSIDE its own TabPanel, not
   * once beneath the tab strip, for the same reason the panels themselves
   * render their content unconditionally (see Tabs.jsx): a row that only
   * existed for whichever tab happened to be active at render time would be
   * missing from the prerendered HTML for the other three, and would stop
   * working entirely without JavaScript.
   *
   * Sticky, same as the Government page's own SectionNav: a reader partway
   * down a long tab (Performance alone runs four tables) loses the row the
   * moment it scrolls off `position: static`, with no way back to it short of
   * scrolling all the way up. `sticky={false}` used to be passed here
   * deliberately, but that just reproduced the problem this page's own long
   * tables create the most.
   */
  const jumpRow = id => <SectionNav
    sections={sectionsOf(id)}
    activeId={activeSection}
    label={`Sections in ${PROFILE_TABS.find(tab => tab.id === id)?.label ?? ''}`}
  />;
  // Every section on the page, so one observer covers all four panels: a
  // section inside a `hidden` panel has no layout box and can never be
  // reported as visible, so the active section is always one on screen.
  const allSectionIds = useMemo(() => PROFILE_TABS.flatMap(tab => tab.sections.map(section => section.id)), []);
  const activeSection = useActiveSection(allSectionIds);

  return (
    <div className="hds-profile">
      <div className="hds-profile__container">
        {/* ================= HERO ================= */}
        <section className="hds-profile__hero" aria-labelledby="hds-hero-name">
          <img
            ref={portraitRef}
            className="hds-profile__portrait"
            src={data.portraitUrl}
            alt={data.name}
            width="180"
            height="180"
            decoding="async"
            data-loaded={portraitState !== 'pending' ? 'true' : undefined}
            data-instant={portraitState === 'instant' ? 'true' : undefined}
            onLoad={() => setPortraitState(current => (current === 'instant' ? current : 'faded'))}
          />
          <div className="hds-profile__hero-body">
            <p className="hds-profile__eyebrow">{data.hero.eyebrow}</p>
            <h1 id="hds-hero-name" className="hds-profile__name">{data.name}</h1>

            {/* The primary fact (which office, when) leads; the meta-explanation
                of why this page exists at all follows it, not the other way
                round — a reader scanning the hero should hit the office and
                tenure before the footnote about why SL Politics built this page. */}
            <div className="hds-profile__focus-role">
              <span className="hds-profile__focus-role-label">Focus role</span>
              <span className="hds-profile__focus-role-value">{data.hero.focusRole}</span>
              <span className="hds-profile__focus-role-tenure">{data.hero.tenure}</span>
            </div>

            <p className="hds-profile__focus-note">{data.hero.focusNote}</p>
            <details className="hds-profile__disclosure">
              <summary>Why this role?</summary>
              <p>{data.hero.focusExplainer}</p>
            </details>
          </div>
        </section>

        <hr className="hds-profile__divider" />

        {/* ================= AT A GLANCE =================
            Office, term, portfolio and the state of the record, before the
            reader has to pick a tab. The component existed and was simply
            never rendered — the page opened on a table of macroeconomic
            indicators with no statement of which job this person held. */}
        <GlanceStrip data={data} sources={sources} />

        <LabelLegend sourceCount={sources.length} />

        <hr className="hds-profile__divider" />

        {/* ================= TABS =================
            Performance is the default: the highest-priority citizen view
            (measurable outcomes) leads, background/research trails. */}
        <div className="hds-profile__tabs-wrap" data-active-index={PROFILE_TABS.findIndex(tab => tab.id === activeTab)}>
          <Tabs
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
            label={`${data.name}'s record, by category`}
            idPrefix="hds-tab"
          />
        </div>


        <TabPanel id="performance" active={activeTab} idPrefix="hds-tab">
          {jumpRow('performance')}
          <OutcomeIndicatorsTable data={data} />
          <hr className="hds-profile__divider" />
          <PromisesSection data={data.promises} />
          <hr className="hds-profile__divider" />
          <ProgrammesTable data={data} />
          <hr className="hds-profile__divider" />
          <InterventionsTable
            data={data}
            expandedInterventions={expandedInterventions}
            onToggleIntervention={toggleIntervention}
          />
        </TabPanel>

        <TabPanel id="record" active={activeTab} idPrefix="hds-tab">
          {jumpRow('record')}
          <VotingRecordSection data={data.votingRecord} />
          <hr className="hds-profile__divider" />
          <AttributionSection data={data} />
        </TabPanel>

        <TabPanel id="policies" active={activeTab} idPrefix="hds-tab">
          {jumpRow('policies')}
          <PoliciesTable data={data} />
        </TabPanel>

        <TabPanel id="profile" active={activeTab} idPrefix="hds-tab">
          {jumpRow('profile')}
          <RoleSection data={data} />
          <hr className="hds-profile__divider" />
          <CareerDetailSection data={data} />
          <hr className="hds-profile__divider" />
          <ResearchNotesSection data={data} />
        </TabPanel>

        <hr className="hds-profile__divider" />

        {/* ================= EVIDENCE & SOURCES (persistent utility, not a tab) ================= */}
        {/* The count is in the summary: a disclosure whose title does not say
            what is inside it, or how much, gives the reader no reason to
            open it. */}
        <CollapsibleSection id="hds-sources" heading={<>Evidence &amp; sources <span className="hds-profile__heading-count">{sources.length}</span></>}>
          <ol className="hds-profile__sources">
            {sources.map((source, i) => {
              const href = safeExternalHref(source.href);
              const n = String(i + 1).padStart(2, '0');
              const meta = [source.title, source.date].filter(Boolean).join(' · ');
              return (
                <li className="hds-profile__source" id={`hds-source-${source.id}`} key={source.id}>
                  <span className="hds-profile__source-no" aria-hidden="true">{n}</span>
                  <div className="hds-profile__source-body">
                    <p className="hds-profile__source-org">{source.organization}</p>
                    {meta ? <p className="hds-profile__source-meta">{meta}</p> : null}
                    <p className="hds-profile__source-type">{source.type}</p>
                  </div>
                  {/* Grouped in one wrapper rather than left as two loose flex
                      children, so mobile can lay them out as a single
                      deliberate action row under the body text instead of
                      whichever way flex-wrap happens to break the line —
                      see .hds-profile__source-controls in the CSS. */}
                  <div className="hds-profile__source-controls">
                    <div className="hds-profile__source-actions">
                      <CopyLinkButton id={`hds-source-${source.id}`} label={`Source ${n}: ${source.organization}`}/>
                      <CopyCitationButton source={source}/>
                    </div>
                    {href ? (
                      <a className="hds-profile__source-link" href={href} target="_blank" rel="noopener noreferrer">
                        <Icon name="external" /><span>Visit</span>
                      </a>
                    ) : (
                      <span className="hds-profile__source-link hds-profile__source-link--unavailable" title="No verified URL is on record for this source">
                        <Icon name="slash" /><span>URL unavailable</span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CollapsibleSection>

        <hr className="hds-profile__divider" />

        {/* ================= RECORD STATUS =================
            Also stated in the glance strip at the top — repeated here
            deliberately, at the end of the record it qualifies, the way a
            document states its own status on the last page as well as the
            first. */}
        <div className="hds-profile__record-status">
          <span className="hds-profile__record-status-label">Record status</span>
          <span className="hds-profile__record-status-value">{data.recordStatus.label}</span>
        </div>
      </div>
    </div>
  );
}
