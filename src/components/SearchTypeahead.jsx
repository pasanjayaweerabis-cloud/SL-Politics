import React from 'react';
import { Avatar, VerifiedBadge, personHref } from './Primitives.jsx';
import {
  suggestPeopleRanked, queryPeople, facetOptions, emptyFacets, discoverablePeople, sortForDisplay, currentGovernment,
} from '../services/repository.ts';
import { navigate } from '../lib/router.tsx';
import { moveActiveIndex, resolveKeyAction, shouldAutoJump, didYouMean } from '../lib/typeahead.ts';
import { featuredOfficeHolders } from '../lib/featuredOffices.ts';
import { useRecentProfiles } from '../lib/recentProfiles.ts';
import { SearchField } from './SearchField.jsx';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Javora's primary search box: a name/alias/party/role/district combobox
 * that suggests matching people while the user types, and jumps straight to
 * a profile on selection — no separate search-results page.
 *
 * The combobox pattern (role="combobox" on the input, role="listbox" on the
 * panel, role="option" per row, aria-activedescendant tracking the
 * highlighted row) follows the WAI-ARIA authoring practice for a listbox
 * autocomplete: only the input is ever focusable, so screen-reader and
 * keyboard behaviour is identical to typing into any other search field.
 * `aria-activedescendant` runs as ONE flat index across every group
 * (People/Jump to/Or, or Recent/Offices/Try searching) — grouping is visual
 * and structural (`role="group"`), not a second index space.
 *
 * Two different result sets share this shell:
 *  - Empty text, panel open on focus: Recent (client-only, last 3 profiles),
 *    Offices (the same featured office-holders as the homepage rail), and
 *    Try searching (three real examples pulled from the live dataset).
 *  - Non-empty text: People (direct/alias/office hits, rank 0-2), Jump to
 *    (district/office NAME matches, linking into a filtered directory
 *    search), and a single "See all N matches" row.
 *
 * The top PEOPLE suggestion is highlighted automatically once a result set
 * arrives, exactly as before — but a bare Enter on that auto-highlighted row
 * only jumps straight to the profile when `shouldAutoJump` (lib/typeahead.ts)
 * says the match is unambiguous; otherwise Enter falls through to a full
 * directory search, since a highlighted district or role name is not a
 * confident guess about which PERSON the reader meant. Arrow-key or mouse
 * selection always jumps, whatever the rank — the reader pointing at a row
 * is itself the confidence signal that a bare Enter does not have.
 *
 * The interaction *decisions* — what Enter/Escape/arrows do, and the
 * confidence gate itself — live in `lib/typeahead.ts` as pure functions;
 * this component only wires them to state and DOM events.
 */
export function SearchTypeahead({
  id = 'javora-search',
  placeholder,
  label,
  onSubmit,
  /*
    Presentation seams, so the home hero can wear its own pill without a
    second copy of this component's behaviour. Only the INLINE form is
    restyled: the mobile sheet below keeps the site-wide `.search` look,
    because the hero's translucent 74px pill exists to sit on a photograph
    and there is no photograph inside a full-screen dialog.
  */
  rootClassName = '',
  formClassName = 'search',
  submitClassName = 'btn btn--primary search__submit',
  submitContent = null,
}) {
  const { t } = useI18n();
  const [text, setText] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // Whether the current highlight came from the reader explicitly pointing
  // at a row (arrow key or hover) rather than the automatic top-result
  // highlight — see the confidence gate on Enter, below.
  const [userMoved, setUserMoved] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const dialogRef = React.useRef(null);
  const mobileInputRef = React.useRef(null);
  // useId gives a stable, SSR-safe unique id without touching a ref during
  // render (a ref's `.current` may not be read while rendering).
  const listId = `${id}-listbox-${React.useId()}`;
  const today = React.useMemo(() => new Date(), []);

  /*
    `text` still drives everything the reader sees typed and the panel's
    open/closed state instantly - only the suggestion QUERY itself waits for
    a short pause, since suggestPeopleRanked() runs a full ranked search over
    the corpus on every call and this runs on every keystroke with no other
    throttle.
  */
  const debouncedText = useDebouncedValue(text, 150);
  const debouncedTrimmed = debouncedText.trim();
  const ranked = React.useMemo(
    () => suggestPeopleRanked(debouncedText),
    [debouncedText],
  );
  const totalMatches = React.useMemo(
    () => (debouncedTrimmed ? queryPeople({ query: debouncedText }, today).length : 0),
    [debouncedText, debouncedTrimmed, today],
  );
  const jumpToChips = React.useMemo(() => {
    if (!debouncedTrimmed) return [];
    const options = facetOptions(emptyFacets(), debouncedText, today);
    const q = debouncedTrimmed.toLowerCase();
    const districts = options.districts
      .filter(d => d.count > 0 && d.name.toLowerCase().includes(q))
      .map(d => ({ id: `district-${d.id}`, label: d.name, href: `/directory?district=${encodeURIComponent(d.id)}` }));
    const roles = options.roles
      .filter(r => r.count > 0 && r.name.toLowerCase().includes(q))
      .map(r => ({ id: `role-${r.id}`, label: r.name, href: `/directory?role=${encodeURIComponent(r.id)}` }));
    return [...districts, ...roles].slice(0, 3);
  }, [debouncedText, debouncedTrimmed, today]);

  const govOffices = React.useMemo(() => featuredOfficeHolders(currentGovernment(today)), [today]);
  const recent = useRecentProfiles();
  const exampleChips = React.useMemo(() => {
    const facets = facetOptions(emptyFacets(), '', today);
    const topParty = [...facets.parties].sort((a, b) => b.count - a.count)[0];
    const topDistrict = [...facets.districts].sort((a, b) => b.count - a.count)[0];
    const person = sortForDisplay(discoverablePeople(today), today)[0];
    return [
      person ? { id: 'ex-name', value: person.person.canonicalName } : null,
      topParty ? { id: 'ex-party', value: topParty.name } : null,
      topDistrict ? { id: 'ex-district', value: topDistrict.name } : null,
    ].filter(Boolean);
  }, [today]);

  const didYouMeanNames = React.useMemo(() => {
    if (!debouncedTrimmed || ranked.length) return [];
    const names = discoverablePeople(today).map(v => v.person.canonicalName);
    return didYouMean(debouncedText, names);
  }, [debouncedText, debouncedTrimmed, ranked.length, today]);

  /**
   * The flat, keyboard-navigable row list for whichever content is showing —
   * built once per relevant state change so `aria-activedescendant` and the
   * confidence gate can both index into it the same way.
   */
  const flatOptions = React.useMemo(() => {
    if (debouncedTrimmed) {
      const people = ranked.filter(entry => entry.rank <= 2).slice(0, 5);
      const options = people.map(entry => ({ kind: 'person', id: entry.view.person.id, view: entry.view, rank: entry.rank }));
      for (const chip of jumpToChips) options.push({ kind: 'link', id: chip.id, href: chip.href, label: chip.label });
      if (totalMatches > 0) {
        options.push({
          kind: 'link',
          id: 'see-all',
          href: `/directory?q=${encodeURIComponent(debouncedText)}`,
          label: t('home.seeAllMatches', { count: totalMatches }),
        });
      }
      return options;
    }
    const options = [];
    for (const entry of recent) options.push({ kind: 'link', id: `recent-${entry.slug}`, href: `/person/${encodeURIComponent(entry.slug)}`, label: entry.name });
    for (const member of govOffices) options.push({ kind: 'link', id: `office-${member.personId}`, href: `/person/${encodeURIComponent(member.slug)}`, label: member.name, portraitUrl: member.portraitUrl, meta: member.offices[0]?.title });
    for (const chip of exampleChips) options.push({ kind: 'trySearch', id: chip.id, value: chip.value });
    return options;
  }, [debouncedTrimmed, ranked, jumpToChips, totalMatches, debouncedText, t, recent, govOffices, exampleChips]);

  const peopleRanks = React.useMemo(
    () => flatOptions.filter(o => o.kind === 'person').map(o => o.rank),
    [flatOptions],
  );

  // Highlight the top row as soon as a query is typed (matches the previous
  // behaviour for the People group); the empty-state groups start with
  // nothing highlighted; nothing highlighted while results are unknown
  // (mid-debounce). Compared during render, not in an effect, so the
  // correction lands in the same paint as the new rows rather than one
  // frame late — the same idiom `Drawer` and `Chrome`'s route-close use.
  const [lastFlatOptions, setLastFlatOptions] = React.useState(flatOptions);
  if (flatOptions !== lastFlatOptions) {
    setLastFlatOptions(flatOptions);
    setUserMoved(false);
    setActiveIndex(debouncedTrimmed && flatOptions.length ? 0 : -1);
  }

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const selectResult = view => {
    setOpen(false);
    setActiveIndex(-1);
    setText('');
    closeMobile();
    navigate(personHref(view));
  };

  const activateOption = option => {
    if (option.kind === 'person') { selectResult(option.view); return; }
    if (option.kind === 'link') {
      setOpen(false);
      setActiveIndex(-1);
      setText('');
      closeMobile();
      navigate(option.href);
      return;
    }
    // 'trySearch': fills the query rather than navigating, so the reader
    // sees what that example actually returns.
    setText(option.value);
    setUserMoved(false);
    setActiveIndex(-1);
  };

  const handleChange = event => {
    const value = event.target.value;
    setText(value);
    setOpen(true);
    setUserMoved(false);
    setActiveIndex(-1);
  };

  const handleFocus = event => {
    if (isMobileViewport()) {
      // A native <dialog> closed via `close()` restores focus to whatever
      // was focused when `showModal()` ran — the very field this handler is
      // on. Left alone, that refocus re-fires this handler and immediately
      // reopens the sheet the reader just closed. Blurring first means the
      // browser has nothing of this field's to restore focus to.
      event.target.blur();
      openMobile();
      return;
    }
    setOpen(true);
  };

  const handleKeyDown = event => {
    // The mobile sheet tracks its own `mobileOpen`, not `open` (the desktop
    // dropdown's state), so `resolveKeyAction` — which only knows `open` —
    // never sees an Escape here as anything to act on. A native <dialog>
    // closes on Escape on its own, but explicitly closing it here removes
    // any doubt rather than depending entirely on that default action still
    // being live after this handler has already inspected the keydown.
    if (mobileOpen && event.key === 'Escape') {
      event.preventDefault();
      closeMobile();
      return;
    }
    const action = resolveKeyAction(event.key, { open, activeIndex, resultCount: flatOptions.length });
    if (action.type === 'move') {
      event.preventDefault();
      if (!open) setOpen(true);
      setUserMoved(true);
      setActiveIndex(index => moveActiveIndex(index, action.direction, flatOptions.length));
    } else if (action.type === 'select') {
      event.preventDefault();
      const option = flatOptions[action.index];
      if (!option) return;
      if (option.kind === 'person' && !userMoved && !shouldAutoJump(peopleRanks)) {
        // Auto-highlighted, not confidently a person match: a bare Enter
        // searches the directory instead of guessing which profile to open.
        setOpen(false);
        onSubmit?.(text.trim());
        return;
      }
      activateOption(option);
    } else if (action.type === 'close') {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleSubmit = event => {
    event.preventDefault();
    setOpen(false);
    closeMobile();
    onSubmit?.(text.trim());
  };

  const clear = () => {
    setText('');
    setActiveIndex(-1);
    setUserMoved(false);
  };

  function isMobileViewport() {
    return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
  }

  function openMobile() {
    setMobileOpen(true);
    dialogRef.current?.showModal?.();
  }

  function closeMobile() {
    if (!mobileOpen) return;
    dialogRef.current?.close?.();
  }

  React.useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  const activeId = activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;
  const showPanel = open && !mobileOpen;

  // Keeps the panel mounted through its closing fade instead of vanishing
  // instantly, mirroring the `data-open`-transition idiom `Drawer` uses in
  // Primitives.jsx. Caught during render, not in an effect, for the same
  // reason as the correction above.
  const [mounted, setMounted] = React.useState(showPanel);
  const [lastShowPanel, setLastShowPanel] = React.useState(showPanel);
  if (showPanel !== lastShowPanel) {
    setLastShowPanel(showPanel);
    if (showPanel) setMounted(true);
  }

  const renderRow = (option, index) => {
    const active = index === activeIndex;
    // `key` is never part of this: React 19 warns (and a future version will
    // error) if a spread props object carries `key` — it must be passed
    // directly on the JSX element, not spread onto it.
    const rowProps = {
      id: `${listId}-option-${index}`,
      role: 'option',
      'aria-selected': active,
      className: `typeahead__option${active ? ' typeahead__option--active' : ''}`,
      onMouseDown: event => event.preventDefault(),
      onMouseEnter: () => { setUserMoved(true); setActiveIndex(index); },
    };
    if (option.kind === 'person') {
      const view = option.view;
      return <div key={option.id} {...rowProps} onClick={() => activateOption(option)}>
        <Avatar name={view.person.canonicalName} portraitUrl={view.person.portrait?.url} size="sm"/>
        <span className="typeahead__text">
          <span className="typeahead__name">{view.person.canonicalName}</span>
          <span className="typeahead__meta">{suggestionMeta(t, view)}</span>
        </span>
        <VerifiedBadge state={view.verification} compact/>
      </div>;
    }
    if (option.kind === 'link') {
      return <div key={option.id} {...rowProps} onClick={() => activateOption(option)}>
        {option.portraitUrl !== undefined
          ? <Avatar name={option.label} portraitUrl={option.portraitUrl} size="sm"/>
          : null}
        <span className="typeahead__text">
          <span className="typeahead__name">{option.label}</span>
          {option.meta ? <span className="typeahead__meta">{option.meta}</span> : null}
        </span>
      </div>;
    }
    // 'trySearch'
    return <div key={option.id} {...rowProps} onClick={() => activateOption(option)}>
      <span className="typeahead__text"><span className="typeahead__name">{option.value}</span></span>
    </div>;
  };

  const renderGroups = () => {
    if (debouncedTrimmed && !ranked.length) {
      return <NoResults t={t} query={debouncedText} names={didYouMeanNames} onPickName={name => { setText(name); setUserMoved(false); setActiveIndex(-1); }}/>;
    }

    let index = -1;
    const group = (labelKey, options) => {
      if (!options.length) return null;
      const headingId = `${listId}-group-${labelKey}`;
      return <div className="typeahead__group" role="group" aria-labelledby={headingId} key={labelKey}>
        <p className="typeahead__group-label" id={headingId}>{t(labelKey)}</p>
        {options.map(option => renderRow(option, ++index))}
      </div>;
    };

    if (debouncedTrimmed) {
      const people = flatOptions.filter(o => o.kind === 'person');
      const links = flatOptions.filter(o => o.kind === 'link' && o.id !== 'see-all');
      const seeAll = flatOptions.find(o => o.id === 'see-all');
      return <>
        {group('home.peopleGroupLabel', people)}
        {group('home.jumpToGroupLabel', links)}
        {seeAll ? <div className="typeahead__group">{renderRow(seeAll, ++index)}</div> : null}
      </>;
    }

    const recentOptions = flatOptions.filter(o => o.id.startsWith('recent-'));
    const officeOptions = flatOptions.filter(o => o.id.startsWith('office-'));
    const tryOptions = flatOptions.filter(o => o.kind === 'trySearch');
    return <>
      {group('home.recentSearchesLabel', recentOptions)}
      {group('home.officesRailLabel', officeOptions)}
      {group('home.trySearchingLabel', tryOptions)}
    </>;
  };

  const formInner = (inputRef, dialogMode) => <form className={dialogMode ? 'search' : formClassName} role="search" onSubmit={handleSubmit} autoComplete="off">
    <label className="visually-hidden" htmlFor={dialogMode ? `${id}-mobile` : id}>{label}</label>
    <SearchField
      id={dialogMode ? `${id}-mobile` : id}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={handleChange}
      onClear={clear}
      enableSlashShortcut={!dialogMode}
      inputRef={inputRef ?? undefined}
      inputProps={{
        role: 'combobox',
        'aria-expanded': dialogMode ? true : showPanel,
        'aria-controls': listId,
        'aria-autocomplete': 'list',
        'aria-activedescendant': activeId,
        onKeyDown: handleKeyDown,
        onFocus: dialogMode ? undefined : handleFocus,
      }}
    />
    {dialogMode ? null : <button type="submit" className={submitClassName}>{submitContent ?? t('common.search')}</button>}
  </form>;

  return <div className={`typeahead${rootClassName ? ` ${rootClassName}` : ''}`} ref={rootRef}>
    {formInner(null, false)}

    {mounted ? <div
      className="typeahead__panel"
      data-open={showPanel ? 'true' : 'false'}
      id={listId} role="listbox" aria-label={t('corrections.matchingPeople')}
      onTransitionEnd={event => { if (!showPanel && event.target === event.currentTarget) setMounted(false); }}
    >
      {renderGroups()}
    </div> : null}

    <dialog
      ref={dialogRef}
      className="search-sheet"
      aria-label={t('home.searchDialogLabel')}
      onClose={() => { setMobileOpen(false); setOpen(false); }}
    >
      <div className="search-sheet__head">
        {formInner(mobileInputRef, true)}
        <button type="button" className="btn btn--secondary search-sheet__cancel" onClick={() => dialogRef.current?.close()}>{t('common.cancel')}</button>
      </div>
      <div className="search-sheet__results" role="listbox" id={`${listId}-mobile`} aria-label={t('corrections.matchingPeople')}>
        {renderGroups()}
      </div>
    </dialog>
  </div>;
}

function NoResults({ t, query, names, onPickName }) {
  return <div className="typeahead__empty" role="status">
    {names.length ? <p className="typeahead__didyoumean">
      {t('home.didYouMeanLabel')}{' '}
      {names.map((name, i) => <React.Fragment key={name}>
        {i > 0 ? ', ' : ''}
        <button type="button" className="u-plain typeahead__didyoumean-name" onMouseDown={e => e.preventDefault()} onClick={() => onPickName(name)}>{name}</button>
      </React.Fragment>)}
    </p> : <p>{t('common.noMatchingPressEnter')}</p>}
    <p><a href="/directory">{t('home.browseInsteadLabel')}</a></p>
    <p>{t('home.recordMissingLabel')} <a href={`/corrections?q=${encodeURIComponent(query)}`}>{t('home.recordMissingLink')}</a></p>
  </div>;
}

/**
 * The short supporting line under a suggestion's name.
 *
 * Now that the directory spans sitting and former office-holders, the office
 * alone is ambiguous: "Prime Minister" reads as the current one whether the
 * person left in 1978 or holds it today. A former holder's line is prefixed
 * with "Former", and where they held several notable offices the highest two
 * are shown — searching "Ranil" should say *Former President · Former Prime
 * Minister*, not just whichever office happened to sort first.
 */
function suggestionMeta(t, view) {
  if (!view.headline) return t('common.officeNotRecorded');

  const former = view.status !== 'current';
  // Distinct KINDS of office, best-precedence first. Deduping by title would
  // show two ministries and omit the premiership; deduping by role type gives
  // "Prime Minister · Minister of Finance", which says more in the same space.
  // `positions` is already sorted, so this preserves that order.
  const notable = [...new Map(
    view.positions
      .filter(p => p.precedence <= NOTABLE_PRECEDENCE)
      .map(p => [p.roleType, p]),
  ).values()].slice(0, 2);

  const titles = (notable.length ? notable : [view.headline]).map(p => p.title);
  // `title` is the office as the SOURCE recorded it — never translated (see
  // lib/i18n.jsx's note on what the chrome does and does not translate).
  // Only "Former" is Javora's own word, so only it goes through `t`.
  const offices = titles.map(title => (former ? `${t('common.former')} ${title}` : title)).join(' · ');

  const context = view.partyLabel ?? view.districtLabel;
  return context ? `${offices} · ${context}` : offices;
}

/**
 * Offices worth naming in a one-line summary.
 *
 * Head of state and government, the Speaker, party and parliamentary
 * leadership — not "Member of Parliament", which nearly everyone here has
 * held and which therefore distinguishes nobody.
 */
const NOTABLE_PRECEDENCE = 20;
