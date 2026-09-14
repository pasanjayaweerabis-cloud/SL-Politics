import React from 'react';
import { Icon } from '../lib/icons.jsx';
import {
  SearchBar, FilterSidebar, ActiveFilters, ProfileResult, ProfileResultLink,
  EmptyState, Pagination, Notice, Drawer,
} from '../components/Primitives.jsx';
import { Dropdown } from '../components/Dropdown.jsx';
import {
  DATASET, emptyFacets, queryPeople, facetOptions, paginate, directoryStats,
  initialCounts, ALPHABET,
} from '../services/repository.ts';
import {
  pushSearch, replaceSearch, readViewState, mergeViewState, useIsomorphicLayoutEffect,
} from '../lib/router.tsx';
import { rememberDirectorySearch } from '../lib/directoryReturn.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';

/** Facet key → URL parameter. Kept short so shared links stay readable. */
const PARAM = {
  parties: 'party',
  districts: 'district',
  roles: 'role',
  statuses: 'status',
  verification: 'state',
};

const PER_PAGE = 12;

/**
 * Ordering.
 *
 * `relevance` is what this page always did and stays the default: serving
 * office-holders first, then by office precedence, then alphabetically (see
 * `sortForDisplay` in repository.ts), with a typed query re-ranking by how
 * directly it matched. That is the right default and a poor way to find
 * "Wickramasinghe" in a register of 1,623 people, which is what the two
 * alphabetical orders are for.
 *
 * Sorting is applied HERE rather than in the repository on purpose: it is a
 * presentation choice over an already-computed result set, and pushing it
 * into `queryPeople` would make every other caller (the typeahead, the
 * sitemap, the tests) inherit a parameter none of them wants.
 */
const SORTS = {
  relevance: null,
  'name-asc': (a, b) => a.person.canonicalName.localeCompare(b.person.canonicalName, 'en'),
  'name-desc': (a, b) => b.person.canonicalName.localeCompare(a.person.canonicalName, 'en'),
};

const DEFAULT_SORT = 'relevance';

/** Read filter state out of the URL, so a shared link restores exactly. */
function readState(search) {
  const params = new URLSearchParams(search);
  const facets = emptyFacets();
  for (const [key, param] of Object.entries(PARAM)) {
    facets[key] = params.getAll(param).filter(Boolean);
  }
  const sort = params.get('sort') ?? DEFAULT_SORT;
  const initial = (params.get('letter') ?? '').toUpperCase();
  return {
    query: params.get('q') ?? '',
    facets,
    sort: sort in SORTS ? sort : DEFAULT_SORT,
    initial: initial === '#' || ALPHABET.includes(initial) ? initial : '',
  };
}

function toSearchString(state) {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  for (const [key, param] of Object.entries(PARAM)) {
    for (const value of state.facets[key]) params.append(param, value);
  }
  // The default order is the absence of the parameter, so the plain
  // /directory URL a reader shares stays plain.
  if (state.sort && state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.initial) params.set('letter', state.initial);
  return params.toString();
}

export default function DirectoryPage({ route }) {
  const { t, n } = useI18n();
  const today = React.useMemo(() => new Date(), []);

  // The URL is the source of truth for filter state. Deriving from `route`
  // means back/forward restores filters without any extra bookkeeping.
  const state = React.useMemo(() => readState(route.search), [route.search]);
  const [filterOpen, setFilterOpen] = React.useState(false);

  /*
    Keep the chosen letter in view inside the A-Z strip.

    The strip scrolls horizontally on narrow screens, so arriving on
    /directory?letter=W showed "All A B C D E F" with the active letter
    somewhere off to the right and nothing on screen to say which one was
    applied. `block: 'nearest'` so this only ever moves the strip's own
    horizontal scroll, never the page.
  */
  const azRef = React.useRef(null);
  React.useEffect(() => {
    const active = azRef.current?.querySelector('[aria-current]');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [state.initial]);

  /**
   * How many records are revealed, reset whenever the query changes.
   *
   * Stored alongside the search string it belongs to and RESET during render
   * rather than in an effect: resetting via useEffect would render one frame
   * showing the previous page size against the new result set, then
   * immediately re-render — a visible flash and a wasted pass.
   *
   * It starts at PER_PAGE and is RESTORED from the history entry by the
   * layout effect below.
   *
   * It used to start at twelve and stay there: someone who pressed "Load
   * more" six times to reach the W's, opened a name and came back was handed
   * the first twelve records again — and now that the browser restores their
   * scroll offset as well (see `useRouteTransition` in router.tsx), that
   * offset would point past the end of a list that had silently shrunk back
   * to one screen. `lib/router.tsx`'s view state carries the count; a filter
   * change starts a fresh entry with none, which is the reset this needs.
   *
   * Restored in an effect rather than in this initialiser, even though an
   * initialiser would be the obvious place, because this page is prerendered
   * with twelve cards and the FIRST client render has to match that HTML
   * exactly or hydration fails and React throws the whole prerendered tree
   * away (see CLAUDE.md's prerender invariants). A reader who reloads
   * /directory after revealing forty-eight records is exactly the case that
   * would have hit it. A LAYOUT effect, so the correction is flushed before
   * the browser paints and there is no visible step from twelve to
   * forty-eight.
   */
  const [paging, setPaging] = React.useState({ search: route.search, shown: PER_PAGE });
  const shown = paging.search === route.search ? paging.shown : PER_PAGE;
  if (paging.search !== route.search) {
    setPaging({ search: route.search, shown: PER_PAGE });
  }

  useIsomorphicLayoutEffect(() => {
    const stored = readViewState().shown;
    if (!Number.isInteger(stored) || stored <= PER_PAGE) return;
    setPaging(current => (current.search === route.search && current.shown >= stored
      ? current
      : { search: route.search, shown: stored }));
  }, [route.search]);

  /**
   * Which cards, if any, were just revealed by a "Show more" click — an
   * index range, not a flag, so only the newly-shown batch gets the
   * entrance stagger and the first PER_PAGE on initial paint never animate.
   * Set directly in `showMore`, which already has both the old and new
   * `shown` value to hand; cleared whenever the search changes underneath
   * it so a fresh query never inherits a stale reveal range.
   */
  const [reveal, setReveal] = React.useState(null);
  if (reveal && reveal.search !== route.search) setReveal(null);

  const showMore = () => {
    const next = shown + PER_PAGE;
    setReveal({ search: route.search, from: shown, to: next });
    setPaging({ search: route.search, shown: next });
    // Recorded against THIS history entry, without touching the URL — so the
    // reader comes back to the list they built. See the layout effect above.
    mergeViewState({ shown: next });
  };

  /*
    The search TEXT is debounced before it drives queryPeople()/facetOptions()
    - both walk up to 1,624 records, and typing has no natural throttle. The
    URL (via commit(), below), the search box's own displayed value, and
    facet toggles are all deliberately NOT debounced here: only the expensive
    read waits for a short pause in typing, so search stays instantly
    shareable and facet clicks stay instantly responsive.
  */
  const debouncedQuery = useDebouncedValue(state.query, 150);

  /**
   * A brief opacity dip on the result grid whenever the debounced query or
   * the facet set actually changes the result set — never on "Show more",
   * which changes `shown` but not either of these. Comparing during render
   * (rather than in an effect) catches the swap on the same render the new
   * results appear, and the double-rAF clear is the same idiom Drawer uses
   * for its entrance in Primitives.jsx: one frame to let the lowered-opacity
   * state actually paint before transitioning back up.
   */
  const swapSignature = JSON.stringify([debouncedQuery, state.facets, state.sort, state.initial]);
  const [lastSwapSignature, setLastSwapSignature] = React.useState(swapSignature);
  const [swapping, setSwapping] = React.useState(false);
  if (swapSignature !== lastSwapSignature) {
    setLastSwapSignature(swapSignature);
    setSwapping(true);
  }
  React.useEffect(() => {
    if (!swapping) return;
    let raf2 = null;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setSwapping(false)); });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [swapping]);

  const results = React.useMemo(
    () => {
      const matched = queryPeople({ query: debouncedQuery, facets: state.facets, initial: state.initial }, today);
      const comparator = SORTS[state.sort];
      return comparator ? [...matched].sort(comparator) : matched;
    },
    [debouncedQuery, state.facets, state.sort, state.initial, today],
  );
  const options = React.useMemo(
    () => facetOptions(state.facets, debouncedQuery, today, state.initial),
    [state.facets, debouncedQuery, state.initial, today],
  );
  /*
    Per-letter counts, computed against the search and filters but NOT
    against the letter itself — so each letter reports what choosing it
    would give, and a letter with nothing behind it is visibly empty rather
    than a link to a blank page.
  */
  const letterCounts = React.useMemo(
    () => initialCounts(state.facets, debouncedQuery, today),
    [state.facets, debouncedQuery, today],
  );
  const page = React.useMemo(() => paginate(results, { page: 1, perPage: shown }), [results, shown]);
  // The directory's own totals, not the dataset's: confirmed deceased people
  // are excluded from queryPeople/facetOptions/initialCounts above, and the
  // "Showing all N" / "N of M" summary below must compare against the same
  // eligible total or it can never say "all" even when nothing is filtered.
  const stats = React.useMemo(() => directoryStats(today), [today]);

  React.useEffect(() => { applyPageMeta(routeMeta('directory')); }, []);

  /*
    Remember this exact view of the register so a profile's "Back to
    Directory" returns to it rather than to the unfiltered 1,623 — see
    lib/directoryReturn.ts. An effect rather than a render-time call because
    it notifies subscribers, and a store may not be written to during render.
  */
  React.useEffect(() => { rememberDirectorySearch(route.search); }, [route.search]);

  /**
   * Toggling a filter pushes a history entry, so back steps through filter
   * choices. Typing in the search box replaces instead — otherwise every
   * keystroke would become its own entry and the back button would be useless.
   */
  const commit = (next, { push }) => {
    const search = toSearchString(next);
    if (push) pushSearch(search);
    else replaceSearch(search);
  };

  const toggle = (group, id, checked) => {
    const current = state.facets[group] ?? [];
    const nextGroup = checked
      ? [...new Set([...current, id])]
      : current.filter(value => value !== id);
    commit({ ...state, facets: { ...state.facets, [group]: nextGroup } }, { push: true });
  };

  const setQuery = query => commit({ ...state, query }, { push: false });
  const setSort = sort => commit({ ...state, sort }, { push: false });
  // Picking a letter pushes, like a facet: stepping back through A-Z is
  // exactly the kind of navigation the back button should undo.
  const setInitial = initial => commit({ ...state, initial: initial === state.initial ? '' : initial }, { push: true });
  const reset = () => commit({ query: '', facets: emptyFacets(), sort: state.sort, initial: '' }, { push: true });
  // Clears the FILTERS while keeping whatever was typed — the empty-state
  // offers both, because "no results" has two different causes and telling
  // the reader to throw away their search when the filters were the problem
  // is the wrong half of the advice.
  const clearFilters = () => commit({ ...state, facets: emptyFacets(), initial: '' }, { push: true });

  // The mobile "Filters" button counts FACETS only: the A-Z letter is chosen
  // on the page itself, not inside that drawer, so counting it there would
  // send a reader into a drawer with nothing ticked in it.
  const activeFilterCount = Object.values(state.facets).reduce((sum, list) => sum + list.length, 0);
  // Whether anything at all is narrowing the register — what the empty state
  // needs to know before offering a way out.
  const isNarrowed = activeFilterCount > 0 || Boolean(state.initial);

  const demonstration = DATASET.mode === 'demonstration';
  const filters = <FilterSidebar facets={state.facets} options={options} onToggle={toggle} onReset={reset}/>;

  const datasetNotice = demonstration ? <Notice
    tone="warning"
    iconName="alert"
    title={t('directory.demoNoticeTitle')}
    body={[t('directory.demoNoticeBody', { count: stats.people })]}
  /> : <Notice
    tone="info"
    iconName="info"
    title={t('directory.infoNoticeTitle', { count: stats.people, serving: stats.serving, former: stats.former })}
    body={[
      t('directory.infoNoticeBody1', { year: stats.earliestYear }),
      t('directory.infoNoticeBody2'),
    ]}
  />;

  return <>
    <header className="section section--tight">
      <div className="container">
        <p className="eyebrow">{t('directory.eyebrow')}</p>
        <h1>{t('directory.title')}</h1>
        <p className="lede">{t('directory.lede')}</p>
      </div>
    </header>

    <section className="section section--tight section--joined" aria-labelledby="results-heading">
      <div className="container">
        <div className="directory">
          <aside className="directory__aside" aria-label="Filters">{filters}</aside>

          <div className="directory__main">
            <h2 className="visually-hidden" id="results-heading">{t('directory.resultsHeading')}</h2>

            <div className="directory__toolbar" id="search">
              <div className="u-grow">
                <SearchBar
                  id="directory-search-input"
                  value={state.query}
                  compact
                  submitButton={false}
                  placeholder={t('directory.refinePlaceholder')}
                  label={t('directory.refineLabel')}
                  onInput={setQuery}
                  onSubmit={setQuery}
                />
              </div>
              <button
                type="button"
                className="btn btn--secondary btn--sm filter-drawer-btn"
                aria-expanded={filterOpen}
                aria-controls="filters-drawer"
                onClick={() => setFilterOpen(true)}
              >
                {activeFilterCount ? t('directory.filtersWithCount', { count: activeFilterCount }) : t('common.filters')}
              </button>
              <div className="directory__sort-wrap">
                <span className="directory__sort-label" id="directory-sort-label">{t('directory.sortLabel')}</span>
                <Dropdown
                  id="directory-sort"
                  value={state.sort}
                  options={[
                    { value: 'relevance', label: t('directory.sortProminence') },
                    { value: 'name-asc', label: t('directory.sortNameAsc') },
                    { value: 'name-desc', label: t('directory.sortNameDesc') },
                  ]}
                  onChange={setSort}
                  label={t('directory.sortLabel')}
                  labelledBy="directory-sort-label"
                  triggerClassName="directory__sort"
                />
              </div>
            </div>

            {/*
              An A-Z index over a register of 1,623 people.

              "Load more", twelve at a time, is 135 clicks from A to W. Search
              answers "I know who I am looking for"; this answers "show me the
              part of the register I want to read", which is the other half of
              what a public register is for. Every letter is a real `<a href>`
              carrying the current search, filters and sort, so it is
              shareable, crawlable and undoable with the back button — and a
              letter with no records behind it is rendered as plain text, not
              as a link to an empty page.
            */}
            <nav className="az-index" aria-label={t('directory.azLabel')} ref={azRef}>
              <a
                className="az-index__letter"
                href={`?${toSearchString({ ...state, initial: '' })}`}
                aria-current={state.initial ? undefined : 'true'}
                onClick={event => { event.preventDefault(); setInitial(''); }}
              >{t('directory.azAll')}</a>
              {[...ALPHABET, '#'].map(letter => {
                const count = letterCounts.get(letter) ?? 0;
                if (!count) {
                  return <span className="az-index__letter az-index__letter--empty" key={letter} aria-disabled="true">{letter}</span>;
                }
                return <a
                  className="az-index__letter"
                  key={letter}
                  href={`?${toSearchString({ ...state, initial: letter })}`}
                  aria-current={state.initial === letter ? 'true' : undefined}
                  title={t('directory.azCount', { count, letter })}
                  onClick={event => { event.preventDefault(); setInitial(letter); }}
                >{letter}</a>;
              })}
            </nav>

            {/*
              One line that explains the result set before the reader has to
              infer it from the grid: how many of how many, what was typed,
              and — via ActiveFilters below — which filters are doing it.
              `role="status"` so the count is announced when it changes,
              which is the only signal a screen-reader user gets that
              typing or a filter click did anything at all.
            */}
            <div className="directory__summary">
              <p className="results-count" role="status" aria-live="polite">
                {results.length
                  ? <>
                      <strong>
                        {results.length === stats.people
                          ? t('directory.resultSummaryAll', { total: n(stats.people) })
                          : t('directory.resultSummaryFiltered', {
                              count: n(results.length),
                              total: n(stats.people),
                            })}
                      </strong>
                      {debouncedQuery ? <span className="results-count__term">{t('directory.searchTerm', { query: debouncedQuery })}</span> : null}
                      {state.initial ? <span className="results-count__term">{t('directory.startingWith', { letter: state.initial })}</span> : null}
                    </>
                  : t('common.noRecords')}
              </p>
            </div>

            <ActiveFilters facets={state.facets} options={options} onToggle={toggle} onReset={reset}/>

            {results.length === 0
              ? <EmptyState
                  title={t('directory.noMatching')}
                  message={t('directory.noMatchingMessage')}
                  action={<>
                    {/* Two different causes, two different exits: the filters
                        may be too narrow, or the search term may be wrong.
                        One "clear everything" button made the reader throw
                        away both to test either. */}
                    {isNarrowed
                      ? <button type="button" className="btn btn--primary" onClick={clearFilters}>{t('directory.clearFiltersOnly')}</button>
                      : null}
                    {state.query
                      ? <button type="button" className="btn btn--secondary" onClick={() => setQuery('')}>{t('directory.broadenSearch')}</button>
                      : null}
                    {isNarrowed || state.query
                      ? <button type="button" className="btn btn--ghost" onClick={reset}>{t('directory.clearSearchAndFilters')}</button>
                      : null}
                  </>}
                />
              : <>
                  {/*
                    Every matching person renders here — a real <a href> to
                    every profile in the static HTML — and `hidden` past the
                    "Show more" threshold controls VISIBILITY only, exactly
                    the pattern used to fix the Political Career tab (see
                    Tabs.jsx): this page is statically prerendered, so a card
                    this component declines to render is a profile with no
                    crawlable link from the directory at all, regardless of
                    what the sitemap separately lists. `results`, not
                    `page.items`, is mapped for that reason; `page` still
                    drives the "Showing X of Y" status text below.

                    A result past the threshold is rendered as the cheap
                    ProfileResultLink, not the full ProfileResult card, purely
                    for render cost — see the comment on ProfileResultLink for
                    the measurement. It is still a real `<a href>`, still
                    `hidden`, still one entry per result: nothing about which
                    profiles have a crawlable link changes, only how much
                    markup the ones nobody can see yet cost to produce.
                  */}
                  <div className="grid-cards" data-swapping={swapping ? 'true' : undefined}>
                    {results.map((view, index) => {
                      if (index >= shown) return <ProfileResultLink key={view.person.id} view={view}/>;
                      const revealing = Boolean(reveal) && reveal.search === route.search && index >= reveal.from && index < reveal.to;
                      return <ProfileResult
                        key={view.person.id}
                        view={view}
                        revealing={revealing}
                        revealIndex={revealing ? index - reveal.from : undefined}
                      />;
                    })}
                  </div>
                  <Pagination page={page} onMore={showMore} step={PER_PAGE}/>
                  <div className="u-mt-8">
                    {datasetNotice}
                    <p className="divider-note">
                      <Icon name="info"/><span>{t('common.somethingWrong')} </span><a href="/corrections">{t('common.reportError')}</a>
                    </p>
                  </div>
                </>}
          </div>
        </div>
      </div>
    </section>

    <Drawer open={filterOpen} onClose={() => setFilterOpen(false)} id="filters-drawer" label={t('common.filters')} panelClassName="drawer__panel--filters">
      <div className="drawer__head">
        <span className="filters__title"><Icon name="filter"/><span>{t('common.filters')}</span></span>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setFilterOpen(false)}><Icon name="close"/></button>
      </div>
      <div className="drawer__body">{filters}</div>
      {/*
        "Show results" read like a commit step — as if the filters behind it
        were staged and nothing had happened yet. They are applied the
        instant they are ticked, on mobile exactly as on desktop, so this
        button only closes the sheet and now says so. The live count above
        it is what actually reports the effect of a tick, without the
        reader having to close the sheet to find out.
      */}
      <div className="drawer__foot">
        <p className="drawer__foot-count" role="status" aria-live="polite">
          {results.length === 1
            ? t('directory.resultsCountOne', { count: n(results.length) })
            : t('directory.resultsCount', { count: n(results.length) })}
        </p>
        <button type="button" className="btn btn--primary btn--block" onClick={() => setFilterOpen(false)}>{t('common.done')}</button>
      </div>
    </Drawer>
  </>;
}
