import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { presentVerification, hasPreciseEvidence } from '../lib/verification.ts';
import { getSource } from '../data/sources.ts';
import { formatDuration, formatAge } from '../lib/date.ts';
import { formatTenure, tenureOf, isCurrent } from '../lib/positions.ts';
import { initialsOf } from '../lib/identity.ts';
import { shouldDisplayPortraits } from '../data/portraitPolicy.ts';
import { portraitSrc } from '../lib/portrait.ts';
import { safeExternalHref } from '../lib/externalUrl.ts';
import { SearchField } from './SearchField.jsx';

/** Canonical profile URL. Query-string ids are legacy and redirect to this. */
export const personHref = view => `/person/${encodeURIComponent(view.person.slug)}`;

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal overlay drawer: traps focus, closes on Escape or scrim click, locks
 * body scroll, and returns focus to whatever opened it. Shared by the mobile
 * nav drawer and the directory filters drawer so both get the same keyboard
 * behaviour instead of reimplementing it twice.
 */
export function Drawer({ open, onClose, id, label, panelClassName='', children }) {
  const panelRef = React.useRef(null);
  const openerRef = React.useRef(null);

  /*
   * Slide in / slide out (the panel) plus a fade in/out (the scrim) — see the
   * CSS in layout.css. This is an interruptible animation: exiting used to
   * unmount on the same render that `open` went false, so the drawer vanished
   * instead of retracing the path it slid in on. This keeps it mounted for
   * one more render — the exit runs as a transition on the single `data-open`
   * attribute below, not a keyframe animation — and only unmounts once that
   * transition reports `transitionend`. Because a transition (unlike a
   * keyframe animation) always retargets from its element's CURRENT value,
   * tapping the burger twice quickly redirects the exit mid-flight instead of
   * restarting from a fixed `from` frame.
   *
   * The `open`→exit transition is caught during render (comparing `open`
   * against the previous render's value) rather than in an effect, the same
   * pattern Chrome uses to close this same drawer on a route change: an
   * effect would still leave the un-animated old state on screen for one
   * extra frame.
   */
  const [rendered, setRendered] = React.useState(open);
  const [visible, setVisible] = React.useState(false);
  const [lastOpen, setLastOpen] = React.useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setRendered(true);
    else setVisible(false);
  }

  // Entrance (slide in / fade in) only: a freshly-mounted element has no
  // prior frame to transition from, so it has to render once in the closed
  // visual state before flipping to open on the next frame — otherwise it
  // would just appear already open, with no interpolation to animate.
  React.useEffect(() => {
    if (!open || visible) return;
    let raf2 = null;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setVisible(true)); });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [open, visible]);

  React.useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    const getFocusable = () => panelRef.current ? [...panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)] : [];
    (getFocusable()[0] ?? panelRef.current)?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!rendered) return null;
  return <div className="drawer" id={id} data-open={visible ? 'true' : 'false'}>
    <div className="drawer__scrim" onClick={onClose}></div>
    <div
      className={`drawer__panel${panelClassName ? ` ${panelClassName}` : ''}`}
      ref={panelRef}
      role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      onTransitionEnd={e => { if (!open && e.target === panelRef.current) setRendered(false); }}
    >
      {children}
    </div>
  </div>;
}

/**
 * Portrait, falling back to a monogram.
 *
 * The monogram is the fallback for three distinct cases, all of which must
 * degrade to something readable rather than a broken image: no portrait
 * recorded, an unreachable URL, and a URL that loads but is not an image.
 * `onError` covers the latter two.
 *
 * Portraits are hot-linked to the publishing institution with credit
 * recorded on the profile, not copied into this repository.
 */
/**
 * Narrow prop contract: `name` and `portraitUrl` only, never a full
 * PersonView. Every caller has a real person or a fabricated stand-in
 * (MemberCard in GovernmentPage.jsx used to build
 * `{ person: { canonicalName, portrait } }` purely to satisfy the shape this
 * component used to require) - accepting exactly the two fields Avatar
 * reads means no caller ever needs to invent a partial view object again.
 */
/**
 * A URL no real portrait will ever equal, so `brokenUrl` starts "not broken"
 * without needing a second state variable to track the previous `portraitUrl`
 * separately — see the note on `brokenUrl` below.
 */
const NO_BROKEN_PORTRAIT = Symbol('no-broken-portrait');

export function Avatar({ name, portraitUrl, size='md', decorative=true }) {
  const { t } = useI18n();
  const modifier = size === 'md' ? '' : ` avatar--${size}`;
  const initials = initialsOf(name);

  /*
    Stores WHICH url last failed to load, not just whether one did — so
    "broken" is derived by comparing it to the current `portraitUrl` rather
    than tracked as its own flag. That derivation is what resets the fallback
    for free when the person changes (Avatar is reused across a list, not
    remounted per row): a stale failure recorded against a PREVIOUS person's
    url can never match the CURRENT one, so a new person's working portrait is
    never suppressed by the last one's broken image. The previous version
    tracked `broken` and `lastUrl` as two separate states kept in sync by an
    `if` block during render; this is the same reset with one state instead
    of two.
  */
  const [brokenUrl, setBrokenUrl] = React.useState(NO_BROKEN_PORTRAIT);
  const broken = brokenUrl === (portraitUrl ?? null);
  // The display decision is policy, kept separate from the recorded rights.
  // See src/data/portraitPolicy.ts.
  const src = broken || !shouldDisplayPortraits() ? null : portraitSrc(portraitUrl);

  // Mirrors the `brokenUrl` derivation above: tracked as "the src this last
  // loaded", not a bare flag, so reusing this component for a different
  // portrait (same pattern the comment above documents for `broken`) resets
  // the fade-in instead of inheriting a stale "already loaded" state.
  const imgRef = React.useRef(null);
  const [loadedSrc, setLoadedSrc] = React.useState(null);
  const loaded = loadedSrc === src;

  React.useEffect(() => {
    // A cached image is already `complete` by the time this effect runs and
    // fires no `load` event at all — without this check its portrait would
    // stay invisible forever behind the fade-in gate.
    if (imgRef.current?.complete) setLoadedSrc(src);
  }, [src]);

  return <div
    className={`avatar${modifier}`}
    role={decorative ? 'presentation' : 'img'}
    aria-label={decorative ? undefined : t('common.portraitOf', { name })}
    title={src ? undefined : t('common.noPortraitOnRecord')}
  >
    {src
      ? <img
          ref={imgRef}
          src={src}
          alt={decorative ? '' : t('common.portraitOf', { name })}
          loading="lazy"
          decoding="async"
          // Do not tell the publishing institution which profile a reader is
          // looking at.
          referrerPolicy="no-referrer"
          data-loaded={loaded ? 'true' : undefined}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setBrokenUrl(portraitUrl ?? null)}
        />
      : <span className="avatar__initials" aria-hidden="true">{initials}</span>}
  </div>;
}

/**
 * `compact` makes the badge visually subordinate — smaller, quieter — but it
 * never removes the word.
 *
 * It used to drop the label and show the icon alone. On a directory card that
 * produced a bare link-glyph pill in the corner of every result: a mark that
 * carries the record's entire provenance claim, legible only to someone who
 * already knows this site's icon vocabulary, and meaningless on touch where
 * there is no hover to reveal the `title`. A badge whose meaning is essential
 * always shows its label (see the audit's iconography rule); `compact` now
 * governs SIZE and weight, which is the part that was actually wanted.
 */
export function VerifiedBadge({ state, compact=false }) {
  const presentation = presentVerification(state);
  return <span className={`badge badge--${presentation.modifier}${compact ? ' badge--compact' : ''}`} title={presentation.description}><Icon name={presentation.icon} /><span>{presentation.label}</span></span>;
}

export function Chip({ text, iconName=null, variant=null, title=null }) {
  if (!text) return null;
  return <span className={variant ? `chip chip--${variant}` : 'chip'} title={title}>{iconName ? <Icon name={iconName} /> : null}<span>{text}</span></span>;
}

export function CurrentBadge(){ const { t } = useI18n(); return <span className="badge badge--current">{t('common.current')}</span>; }

/**
 * Where a person stands relative to public office, as ONE semantic tag.
 *
 * "Is this person in this job now?" is the first question a political
 * directory has to answer, and until this component it was answered by a
 * `Chip` reading "Currently serving" sitting in a row of identical `Chip`s
 * for party, district and role type — four facts of very different weight
 * rendered identically, so the temporal one had to be hunted for.
 *
 * The states are `PersonView.status` verbatim (repository.ts derives them
 * from the positions themselves); nothing is asserted here that the record
 * does not already say, and "historical" and "unknown" keep their own words
 * rather than being folded into "former", which would be a different claim.
 *
 * Colour is never the only carrier: each state has its own wording, and only
 * the current state carries the filled dot.
 */
const STATUS_LABEL_KEY = {
  current: 'common.statusCurrent',
  former: 'common.statusFormer',
  historical: 'common.statusHistorical',
  unknown: 'common.statusUnknown',
};

export function StatusTag({ status, compact=false }) {
  const { t } = useI18n();
  const state = STATUS_LABEL_KEY[status] ? status : 'unknown';
  return <span
    className={`status-tag status-tag--${state}${compact ? ' status-tag--compact' : ''}`}
    title={t(`${STATUS_LABEL_KEY[state]}Hint`)}
  >
    <span className="status-tag__dot" aria-hidden="true"></span>
    <span>{t(STATUS_LABEL_KEY[state])}</span>
  </span>;
}

/**
 * A person's VITAL status, shown only when it is `deceased` — deliberately
 * separate from `StatusTag` above, which answers a different question
 * (office-holding, not whether someone is alive). Rendering nothing for
 * `alive`/`unknown` means every profile that is not confirmed deceased looks
 * exactly as it did before this existed; only a record with reliable
 * evidence of death (`PersonView.vitalStatus === "deceased"`) ever shows it,
 * so it can never be confused with "former", "historical" or "status not
 * recorded", which say nothing about whether someone is alive.
 */
export function VitalStatusTag({ vitalStatus, compact=false }) {
  const { t } = useI18n();
  if (vitalStatus !== 'deceased') return null;
  return <span
    className={`status-tag status-tag--deceased${compact ? ' status-tag--compact' : ''}`}
    title={t('common.statusDeceasedHint')}
  >
    <span className="status-tag__dot" aria-hidden="true"></span>
    <span>{t('common.statusDeceased')}</span>
  </span>;
}

/**
 * Link to the evidence behind a claim.
 *
 * Points straight at the official source — the exact document URL when the
 * evidence is that precise, otherwise the institution's own site — rather
 * than an internal Javora page. Javora doesn't run a source-management UI for
 * ordinary readers; the evidence for a claim should lead off-site to the
 * authority itself. What the pill shows is what the evidence actually is:
 * evidence that names only an institution is labelled as such rather than
 * presented as a citation, which is the whole point of the evidence model.
 */
export function EvidencePill({ evidence }) {
  const { t } = useI18n();
  if (!evidence?.length) {
    return <span className="source-pill" title={t('common.noSourceForItem')}><Icon name="slash" /><span>{t('common.noSource')}</span></span>;
  }
  const first = evidence[0];
  const source = getSource(first.sourceId);
  const precise = hasPreciseEvidence(first);
  const label = source ? source.id : first.sourceId;
  // `source.url` is a hardcoded institution address from src/data/sources.ts;
  // `first.sourceUrl` is scraped. Only the scraped one needs checking, but
  // both go through the same guard so a later edit to sources.ts cannot
  // quietly become the exception.
  const href = safeExternalHref(first.sourceUrl) ?? safeExternalHref(source?.url) ?? null;
  const title = precise
    ? `${source?.name ?? first.sourceId}${first.locator ? ` — ${first.locator}` : ''}`
    : t('common.institutionReferenceTitle', { name: source?.name ?? first.sourceId });

  if (!href) {
    return <span className="source-pill" title={title}><Icon name="slash"/><span>{label}</span></span>;
  }

  // The icon carries the precise/imprecise distinction visually, and `title`
  // spells it out. A separate marker glyph would be noise — and meaningless to
  // a screen reader, which is exactly who needs the distinction stated.
  return <a className={`source-pill u-plain${precise ? '' : ' source-pill--weak'}`} href={href} target="_blank" rel="noopener noreferrer" title={title}>
    <Icon name={precise ? 'link' : 'document'} />
    <span>{label}</span>
    <span className="visually-hidden">{precise ? t('common.opensSourceDocument') : t('common.opensInstitutionSite')}</span>
  </a>;
}

/**
 * `counts`, when given, is a state → claim-count map (see
 * `repository.ts`'s `verificationStateCounts`): each state then shows
 * whether it is actually attached to any claim in the loaded dataset today,
 * rather than listing all seven as if equally real. Labels and descriptions
 * always come from `VERIFICATION_PRESENTATION` — never restated by a caller.
 */
export function VerificationLegend({ states, counts=null }) {
  const { t, n } = useI18n();
  return <dl className="definition-grid">{states.map(state => {
    const presentation = presentVerification(state);
    const count = counts ? (counts[state] ?? 0) : null;
    return <div className="definition-grid__item" key={state}>
      <dt><span className="definition-grid__icon" aria-hidden="true"><Icon name={presentation.icon}/></span>{presentation.label}</dt>
      <dd>{presentation.description}</dd>
      {counts ? <p className="definition-grid__status">
        {count > 0 ? t('common.inUseCount', { count: n(count) }) : t('common.notInUseYet')}
      </p> : null}
    </div>;
  })}</dl>;
}

export function Notice({ tone='neutral', title=null, body=[], iconName='info', className='' }) {
  const modifier = tone === 'neutral' ? '' : ` notice--${tone}`;
  const lines = Array.isArray(body) ? body : [body];
  return <div className={`notice${modifier}${className ? ` ${className}` : ''}`} role={tone === 'warning' ? 'note' : undefined}><Icon name={iconName}/><div className="notice__body">{title ? <p><strong>{title}</strong></p> : null}{lines.map((line, i) => <p key={i}>{line}</p>)}</div></div>;
}

export function EmptyState({ title, message, iconName='search', action=null }) {
  const { t } = useI18n();
  return <div className="empty-state" role="status"><Icon name={iconName}/><h3>{title ?? t('directory.noMatching')}</h3><p>{message ?? t('directory.noMatchingMessage')}</p>{action ? <div className="empty-state__actions">{action}</div> : null}</div>;
}

/**
 * `value` is formatted as a grouped count (`n()` — see `lib/i18n.jsx`) when
 * it is a number, and printed as-is otherwise. A caller with a value that
 * looks numeric but must NOT be grouped — a year, most notably: "1931" must
 * never become "1,931" — passes it already as a string.
 */
export function StatsCard({ value, label, note=null, iconName=null }) {
  const { n } = useI18n();
  const display = typeof value === 'number' ? n(value) : String(value);
  return <div className="stat">
    {iconName ? <span className="stat__icon" aria-hidden="true"><Icon name={iconName}/></span> : null}
    <p className="stat__value">{display}</p>
    <p className="stat__label">{label}</p>
    {note ? <p className="stat__note">{note}</p> : null}
  </div>;
}

export function SectionHead({ title, description=null, action=null, id=null }) {
  return <div className="section-head"><div className="section-head__text"><h2 id={id || undefined}>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</div>;
}

export function ActionLink({ label, href, back=false }) {
  return <a className={`action-link${back ? ' action-link--back' : ''} u-plain`} href={href}>{back ? <Icon name="arrowLeft"/> : null}<span>{label}</span>{back ? null : <Icon name="arrowRight"/>}</a>;
}

/**
 * `step` is how many records the next press actually reveals — NOT
 * `page.perPage`, which is how many are revealed in total.
 *
 * The directory calls `paginate(results, { perPage: shown })`, so `perPage`
 * grows with every press while the batch size stays twelve. The button read
 * its count from `perPage` and so promised "Load 24 more", then "Load 36
 * more", while each press still added twelve: a control that misstates its
 * own effect, and the reader has no way to tell except by counting cards.
 * `step` defaults to `page.perPage` so the figure is unchanged for a caller
 * that paginates conventionally, where the two genuinely are the same
 * number.
 */
export function Pagination({ page, onMore, step = null }) {
  const { t } = useI18n();
  if (page.total === 0) return null;
  const batch = Math.min(step ?? page.perPage, page.total - page.shown);
  return <div className="pagination"><p className="pagination__status" role="status">{t('common.showingOfRecords', { shown: page.shown, total: page.total })}</p>{page.hasMore ? <button type="button" className="btn btn--secondary" onClick={onMore}>{t('common.loadMore', { count: batch })}</button> : null}</div>;
}

export function Fact({ iconName, text, muted=false, label=null }) {
  if (!text) return null;
  return <p className={muted ? 'fact-line fact-line--muted' : 'fact-line'}><Icon name={iconName} label={label}/><span>{text}</span></p>;
}

/** Renders a value, or an explicit "not recorded" marker — never a blank. */
export function Unavailable({ children }) {
  const { t } = useI18n();
  return <span className="unavailable">{children ?? t('common.notRecorded')}</span>;
}

/**
 * Javora protects a three-way distinction across these missing-value
 * components, and none of the three may be merged into another:
 *   Unavailable  — "not recorded HERE" (inline, e.g. a single Fact row)
 *   Unrecorded   — "not recorded here", compact block form, with an
 *                  optional `why` shown in a title attribute
 *   NotVerified  — "not published by ANYONE", the full explanatory block,
 *                  for when the ABSENCE itself needs explaining
 *   EmptyState   — "no results", a search/filter finding nothing — a
 *                  different situation from all three above
 * "Not recorded" and "not published by anyone" are different claims about
 * the world, and collapsing them would turn an honest gap into either an
 * overclaim or an underclaim.
 */

/**
 * The COMPACT unavailable state.
 *
 * A profile has ten or so sections and most people have data for a few of
 * them, so the full explanatory box — correct as it is — turned an honest
 * record into a wall of grey. This keeps the honesty (it still says what is
 * missing) at one line, and moves the reasoning into a title attribute for
 * anyone who wants it.
 *
 * The full `NotVerified` block is still used where the ABSENCE is the point
 * and needs explaining — examination grades, which are unpublished for every
 * citizen, rather than merely unrecorded for this one.
 */
export function Unrecorded({ children, why = null }) {
  return <p className="unrecorded" title={why ?? undefined}>
    <Icon name="slash"/><span>{children}</span>
  </p>;
}

/**
 * Shown wherever a section is genuinely empty.
 *
 * It always says WHY. A blank Education section invites the reader to
 * conclude the person has none, which is a different and much stronger claim
 * than "no authoritative source publishes this".
 */
export function NotVerified({ children }) {
  return <p className="unverified-note">
    <Icon name="slash"/>
    <span><strong>Not published anywhere.</strong> {children}</span>
  </p>;
}

/**
 * Four levels, and they are meant to look like four levels.
 *
 *   1  name            — the record being offered
 *   2  current office  — what the reader is actually scanning for
 *   3  party · district, tenure — supporting context, one quiet line each
 *   4  provenance      — the verification badge, in the card's foot
 *
 * The previous version rendered name, office, party and district as four
 * `Fact` rows of identical size, weight and icon, with the verification badge
 * as the loudest thing in the card. The facts are unchanged; only which ones
 * shout is.
 */
export function ProfileCard({ view, today }) {
  const { t } = useI18n();
  const headline = view.headline;
  const roleText = headline ? headline.title : t('common.officeNotRecorded');
  const tenure = headline ? formatTenure(headline, today) : null;
  // Party and district are one line, not two rows: they answer the same
  // "which seat" question and neither is worth a row of its own here.
  const context = [view.partyLabel, view.districtLabel].filter(Boolean).join(' · ');
  return <article className="profile-card"><div className="profile-card__body">
    <div className="profile-card__top">
      <Avatar name={view.person.canonicalName} portraitUrl={view.person.portrait?.url} size="sm"/>
      <StatusTag status={view.status} compact/>
    </div>
    <h3 className="profile-card__name"><a href={personHref(view)} className="u-plain">{view.person.canonicalName}</a></h3>
    <p className={`profile-card__office${headline ? '' : ' profile-card__office--muted'}`}>{roleText}</p>
    <p className="profile-card__context">{context || t('common.partyNotRecorded')}</p>
    {tenure ? <p className="profile-card__tenure"><Icon name="clock"/><span>{tenure}</span></p> : null}
  </div><div className="profile-card__foot">
    <VerifiedBadge state={view.verification} compact/>
    <span className="action-link" aria-hidden="true"><span>{t('common.viewRecord')}</span><Icon name="arrowRight"/></span>
  </div></article>;
}

/**
 * `hidden` defaults to false and is set by the directory list, not by this
 * component deciding anything about itself — see DirectoryPage's comment on
 * why every result renders (a real `<a href>` in the static HTML) and only
 * visibility past the "Show more" threshold is deferred to `hidden`.
 */
export function ProfileResult({ view, hidden = false, revealing = false, revealIndex = 0 }) {
  const { t } = useI18n();
  const headline = view.headline;
  const party = view.partyId ? view.partyLabel : null;
  /*
    Four chips of identical weight — role type, party, district, and the
    current/former status — is what this card used to end with, and the
    temporal one (the single most consequential fact on a political record)
    was indistinguishable from the other three. The role-type chip is gone
    outright rather than restyled: for most records it restated the office
    line directly above it verbatim ("President" under "President"), so it
    was competing for attention while adding nothing. Role type remains a
    directory FILTER, which is where it does work.
  */
  const context = [party, view.districtLabel].filter(Boolean).join(' · ');
  return <article
    className={`profile-card profile-card--result${revealing ? ' profile-card--revealing' : ''}`}
    hidden={hidden}
    style={revealing ? { '--reveal-index': revealIndex } : undefined}
  ><div className="profile-card__body">
    <Avatar name={view.person.canonicalName} portraitUrl={view.person.portrait?.url} size="sm"/>
    <div className="profile-card__col">
      <h3 className="profile-card__name"><a href={personHref(view)} className="u-plain">{view.person.canonicalName}</a></h3>
      <p className={`profile-card__office${headline ? '' : ' profile-card__office--muted'}`}>
        {headline ? headline.title : t('common.officeNotRecorded')}
      </p>
      {/* Status leads this line rather than sharing the name's row: a name
          long enough to wrap (most of them are) was squeezing the tag into
          a column two words wide. */}
      <p className="profile-card__status-row">
        <StatusTag status={view.status} compact/>
        {context ? <span className="profile-card__context">{context}</span> : null}
      </p>
      <p className="profile-card__provenance"><VerifiedBadge state={view.verification} compact/></p>
    </div>
  </div></article>;
}

/**
 * The cheap stand-in for a result past the "Show more" threshold.
 *
 * `DirectoryPage` renders every matching result so each has a real `<a href>`
 * in the static HTML — see the comment there. Rendering all of them as full
 * `ProfileResult` cards was measured (renderToString over the unfiltered
 * 1,624-person directory) at 2.44 MB of HTML, ~39,900 opening tags and ~555ms
 * of render time for that one subtree; almost none of it is visible; a card
 * past the threshold exists solely to be a link a crawler can follow. Past
 * the threshold this renders ONLY that link — no avatar, badge, chips — which
 * measured at 152 KB, ~1,950 tags and ~20ms for the same dataset. Always
 * `hidden`, same as a hidden `ProfileResult` — this is never the visible
 * state past "Show more"; growing `shown` swaps the person from here to a
 * real `ProfileResult`, it does not reveal this element.
 */
export function ProfileResultLink({ view }) {
  return <a href={personHref(view)} hidden>{view.person.canonicalName}</a>;
}

/**
 * Filter groups, in the order a reader actually reaches for them, and split
 * into the four that answer an ordinary question about a politician and the
 * one that answers a question about the RECORD.
 *
 * Everything here was previously one flat list of five equally-weighted
 * groups, every one expanded, every one internally scrollable — a database
 * control panel where a reader wanted "JJB, Colombo". No filtering
 * capability is removed: "Record state" still filters exactly what it always
 * did, it now sits behind one disclosure because almost nobody arrives
 * wanting to filter by evidence state, and the people who do know to look.
 */
const FILTER_GROUPS = [
  { key: 'statuses', titleKey: 'directory.status', primary: true },
  { key: 'parties', titleKey: 'directory.politicalParty', primary: true },
  { key: 'roles', titleKey: 'directory.role', primary: true },
  { key: 'districts', titleKey: 'directory.district', primary: true },
  { key: 'verification', titleKey: 'directory.recordState', primary: false },
];

/** How many options a group shows before "Show all" — see FilterGroup. */
const VISIBLE_OPTIONS = 6;

/**
 * One filter group.
 *
 * Two things make a 30-party list usable without taking anything away:
 *
 *  - Options are ordered by how many records carry them, not alphabetically.
 *    The old alphabetical order put "All Ceylon Makkal Congress" (2 records)
 *    at the top of the party list and the two parties that actually run the
 *    country below the fold of an inner scrollbar. The count column beside
 *    each row is what makes that order legible rather than arbitrary.
 *  - Only the first few show until the reader asks for the rest. A selected
 *    option is always in the visible set, whatever its rank, so a filter can
 *    never be active while its checkbox is hidden.
 *
 * The inner scroll area this replaces is gone from the CSS: a scrollable box
 * inside a scrollable sidebar inside a scrolling page is three nested scroll
 * contexts, and on a trackpad it was routinely the wrong one that moved.
 */
function FilterGroup({ group, options, selected, onToggle, t, n }) {
  const [expanded, setExpanded] = React.useState(false);
  /*
    Reordering by count only earns its keep when the list is long enough to
    be truncated — that is the whole reason for it (see the comment above:
    the visible six must be the six worth seeing). A short group is shown
    whole, so it keeps the order the data declares, which for Status means
    "Currently serving" before "Former" rather than the larger bucket first.
  */
  const ordered = React.useMemo(
    () => (options.length > VISIBLE_OPTIONS
      ? [...options].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'))
      : options),
    [options],
  );
  const visible = expanded
    ? ordered
    : ordered.filter((option, index) => index < VISIBLE_OPTIONS || selected.includes(option.id));
  const hiddenCount = ordered.length - visible.length;
  const activeInGroup = selected.length;

  return <details className="filter-group" open={group.primary || activeInGroup > 0}>
    <summary>
      <span className="filter-group__title">
        {t(group.titleKey)}
        {activeInGroup ? <span className="filter-group__active">{activeInGroup}</span> : null}
      </span>
      <Icon name="chevronDown" className="filter-group__chevron"/>
    </summary>
    <div className="filter-group__list">
      {visible.map(option => {
        const checked = selected.includes(option.id);
        return <label className="filter-option" key={option.id}>
          <input type="checkbox" name={group.key} value={option.id} checked={checked} onChange={e => onToggle(group.key, option.id, e.target.checked)}/>
          <span className="filter-option__name">{option.name}</span>
          <span className="filter-option__count" aria-hidden="true">{n(option.count)}</span>
          <span className="visually-hidden">{t('common.records', { count: n(option.count) })}</span>
        </label>;
      })}
      {hiddenCount > 0 || expanded
        ? <button type="button" className="filter-group__more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? t('directory.showFewer') : t('directory.showAllOptions', { count: ordered.length })}
          </button>
        : null}
    </div>
  </details>;
}

export function FilterSidebar({ facets, options, onToggle, onReset }) {
  const { t, n } = useI18n();
  const activeCount = Object.values(facets).reduce((sum, list) => sum + list.length, 0);
  const groupsWithOptions = FILTER_GROUPS.filter(group => (options[group.key] ?? []).length > 0);
  const primary = groupsWithOptions.filter(group => group.primary);
  const secondary = groupsWithOptions.filter(group => !group.primary);
  const secondaryActive = secondary.some(group => (facets[group.key] ?? []).length > 0);

  const renderGroup = group => <FilterGroup
    key={group.key}
    group={group}
    options={options[group.key] ?? []}
    selected={facets[group.key] ?? []}
    onToggle={onToggle}
    t={t}
    n={n}
  />;

  return <form className="filters" aria-label="Filter records" onSubmit={e => e.preventDefault()}>
    <div className="filters__head">
      <span className="filters__title"><Icon name="filter"/><span>{t('common.filters')}</span></span>
      <button type="button" className="filters__reset" disabled={activeCount === 0} onClick={onReset}>{activeCount ? t('common.clearCount', { count: activeCount }) : t('common.clear')}</button>
    </div>
    {primary.map(renderGroup)}
    {secondary.length
      // Open when something inside it is already filtering, so a filter is
      // never applied from behind a closed door the reader cannot see.
      ? <details className="filters__more" open={secondaryActive}>
          <summary>
            <span>{t('directory.moreFilters')}</span>
            <Icon name="chevronDown" className="filter-group__chevron"/>
          </summary>
          <div className="filters__more-body">{secondary.map(renderGroup)}</div>
        </details>
      : null}
  </form>;
}

/**
 * The answer to "why am I seeing these results?".
 *
 * Each tag now names its DIMENSION as well as its value — "Party: JJB", not
 * a bare "JJB" — because the values alone are ambiguous across groups
 * (Colombo is a district; "President" is both a role type and an office) and
 * because a reader who has forgotten what they clicked gets no help from a
 * list of bare nouns.
 */
export function ActiveFilters({ facets, options, onToggle, onReset }) {
  const { t } = useI18n();
  const tags = [];
  for (const group of FILTER_GROUPS) {
    for (const id of facets[group.key] ?? []) {
      const option = (options[group.key] ?? []).find(o => o.id === id);
      if (!option) continue;
      const groupName = t(group.titleKey);
      tags.push(<span className="filter-tag" key={`${group.key}-${id}`}>
        <span className="filter-tag__group">{groupName}:</span>
        <span className="filter-tag__value">{option.name}</span>
        <button type="button" aria-label={t('directory.removeFilter', { group: groupName, value: option.name })} onClick={() => onToggle(group.key, id, false)}><Icon name="close"/></button>
      </span>);
    }
  }
  if (!tags.length) return null;
  return <div className="active-filters">
    <span className="active-filters__label">{t('directory.filteredBy')}</span>
    {tags}
    <button type="button" className="filters__reset" onClick={onReset}>{t('common.clearAll')}</button>
  </div>;
}

export function SearchBar({ value='', placeholder, label, compact=false, submitButton=true, id='javora-search', onSubmit, onInput }) {
  const { t } = useI18n();
  // The field is locally controlled so typing stays responsive, but it must
  // re-sync when `value` changes from outside (a cleared filter, a back
  // navigation). Adjusting during render rather than in an effect avoids
  // painting one frame with the stale text before correcting it.
  const [text, setText] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }
  const handleSubmit = e => { e.preventDefault(); onSubmit?.(text.trim()); };
  const clear = () => { setText(''); onInput?.(''); onSubmit?.(''); };
  // Icon, input and clear button live inside their own positioning context
  // (`search__field`) so the icon stays glued to the input regardless of
  // whether the submit button sits beside it or wraps to a row below. When
  // all four were siblings of `.search` directly, the icon's position was
  // computed against the *whole* container — including the submit button's
  // row on mobile — and it would drift down to float between the input and
  // the button instead of staying centred on the input.
  return <form className={compact ? 'search search--compact' : 'search'} role="search" onSubmit={handleSubmit}>
    <label className="visually-hidden" htmlFor={id}>{label}</label>
    <SearchField
      id={id}
      value={text}
      placeholder={placeholder}
      onChange={e => { setText(e.target.value); onInput?.(e.target.value); }}
      onClear={clear}
    />
    {submitButton ? <button type="submit" className="btn btn--primary search__submit">{t('common.search')}</button> : null}
  </form>;
}

/** Tenure with its precision made visible — a range renders as a range. */
export function TenureValue({ position, today }) {
  const { t } = useI18n();
  const tenure = formatTenure(position, today);
  if (!tenure) return <Unavailable>{t('common.datesNotRecorded')}</Unavailable>;
  const duration = tenureOf(position, today);
  const length = formatDuration(duration);
  return <span className="tenure"><Icon name="calendar"/><span>{tenure}</span>
    {length ? <span className="derived" title={duration.kind === 'range' ? 'Range, because the recorded dates are not precise enough for an exact figure' : 'Calculated from the recorded dates'}> · {length}</span> : null}
  </span>;
}

/** Age with its precision made visible. */
export function AgeValue({ age }) {
  const text = formatAge(age.duration, age.atDeath);
  if (!text) return null;
  return <span className="derived" title={age.duration.kind === 'range' ? 'Approximate, because only part of the birth date is recorded' : 'Calculated from the recorded date'}> ({text})</span>;
}

export { isCurrent };
