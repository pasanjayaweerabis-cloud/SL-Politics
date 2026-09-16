import React from 'react';
import { SectionHead, ActionLink } from '../components/Primitives.jsx';
import { HomeHero } from '../components/home/HomeHero.jsx';
import { MemberCard } from './GovernmentPage.jsx';
import {
  datasetStats, directoryStats, queryPeople, emptyFacets, currentGovernment, sourcesInUse,
} from '../services/repository.ts';
import { featuredOfficeHolders } from '../lib/featuredOffices.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';

export default function HomePage() {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const government = React.useMemo(() => currentGovernment(today), [today]);
  const featuredGovernment = React.useMemo(() => featuredOfficeHolders(government), [government]);
  const stats = React.useMemo(() => datasetStats(today), [today]);
  const dirStats = React.useMemo(() => directoryStats(today), [today]);
  // Facet counts for the browse tiles, computed from the same pool and
  // filter logic the Directory page itself uses — never typed in — so a
  // tile can never claim a count the Directory wouldn't also show for that
  // same filter.
  const browseCounts = React.useMemo(() => ({
    cabinet: queryPeople({ facets: { ...emptyFacets(), roles: ['cabinet-minister'] } }, today).length,
    currentMPs: queryPeople({ facets: { ...emptyFacets(), roles: ['member-of-parliament'], statuses: ['serving'] } }, today).length,
    formerMPs: queryPeople({ facets: { ...emptyFacets(), roles: ['member-of-parliament'], statuses: ['former'] } }, today).length,
  }), [today]);
  const number = value => (typeof value === 'number' ? value.toLocaleString('en-US') : String(value ?? '—'));
  const usedSourceNames = React.useMemo(() => sourcesInUse().map(s => s.institution).join(' · '), []);
  // Where the hero's scroll cue points: the Current Government section when
  // it actually rendered, otherwise the next real section below it — never
  // an id that isn't on the page.
  const scrollTargetId = featuredGovernment.length ? 'current-government' : 'trust-heading';

  React.useEffect(() => { applyPageMeta(routeMeta('home')); }, []);

  return <>
    <HomeHero government={government} peopleCount={number(stats.people)} scrollTargetId={scrollTargetId}/>

    {/* Rendered only when the derivation actually resolved someone — an empty
        heading over nothing would read as "no current government" rather
        than "no source check has completed yet", the same rule
        GovernmentPage's own `Section` applies. */}
    {featuredGovernment.length ? <section className="section section--tight" id="current-government" aria-labelledby="government-heading">
      <div className="container">
        <SectionHead
          id="government-heading"
          title={t('home.governmentHeading')}
          description={t('home.governmentDescription')}
          action={<ActionLink label={t('home.governmentAction')} href="/government"/>}
        />
        <div className="gov-grid">{featuredGovernment.map(member => <MemberCard key={member.personId} member={member}/>)}</div>
      </div>
    </section> : null}

    <section className="section section--tight" aria-labelledby="directory-heading">
      <div className="container">
        <SectionHead
          id="directory-heading"
          title={t('home.directoryHeading')}
          description={t('home.directoryDescription')}
        />
        <nav className="browse-tiles" aria-labelledby="directory-heading">
          <a className="browse-tile" href="/directory?role=cabinet-minister">
            <span className="browse-tile__label">{t('home.browseCabinet')}</span>
            <span className="browse-tile__count">{t('home.browseCount', { count: number(browseCounts.cabinet) })}</span>
          </a>
          <a className="browse-tile" href="/directory?role=member-of-parliament&status=serving">
            <span className="browse-tile__label">{t('home.browseCurrentMPs')}</span>
            <span className="browse-tile__count">{t('home.browseCount', { count: number(browseCounts.currentMPs) })}</span>
          </a>
          <a className="browse-tile" href="/directory?role=member-of-parliament&status=former">
            <span className="browse-tile__label">{t('home.browseFormerMPs')}</span>
            <span className="browse-tile__count">{t('home.browseCount', { count: number(browseCounts.formerMPs) })}</span>
          </a>
          <a className="browse-tile browse-tile--all" href="/directory">
            <span className="browse-tile__label">{t('home.browseViewAll')}</span>
            <span className="browse-tile__count">{t('home.browseCount', { count: number(dirStats.people) })}</span>
          </a>
        </nav>
      </div>
    </section>

    {/*
      The trust answer, in figures counted from the records actually loaded
      rather than claimed — `datasetStats` walks the dataset, and the
      "connected sources" figure deliberately reports how many of the
      declared sources are really connected, which is currently fewer than
      all of them. A civic record that overstated its own coverage here
      would be undermining the thing it exists to do.
    */}
    <section className="section section--tight section--alt" aria-labelledby="trust-heading">
      <div className="container">
        <div className="home-trust">
          <div className="home-trust__text">
            <p className="eyebrow">{t('home.trustEyebrow')}</p>
            <h2 id="trust-heading">{t('home.trustHeading')}</h2>
            <p className="lede">{t('home.trustLede')}</p>
            <div className="u-mt-5"><ActionLink label={t('home.trustAction')} href="/about#methodology"/></div>
          </div>
          <dl className="home-trust__figures">
            <div className="home-trust__figure">
              <dt>{t('dataset.statPeople')}</dt>
              <dd>{number(stats.people)}</dd>
              <p>{t('dataset.statPeopleNote', { count: number(stats.serving) })}</p>
            </div>
            <div className="home-trust__figure">
              <dt>{t('dataset.statPositions')}</dt>
              <dd>{number(stats.positions)}</dd>
              <p>{t('dataset.statPositionsNote', { count: number(stats.distinctOffices) })}</p>
            </div>
            <div className="home-trust__figure">
              <dt>{t('dataset.statSourcesInUse')}</dt>
              <dd>{number(stats.connectedSources)}</dd>
              <p>{stats.connectedSources ? t('dataset.statSourcesInUseNote', { names: usedSourceNames }) : t('dataset.statSourcesNone')}</p>
            </div>
            <div className="home-trust__figure">
              <dt>{t('dataset.statEarliest')}</dt>
              <dd>{stats.earliestYear ?? '—'}</dd>
              <p>{stats.earliestYear ? t('dataset.statEarliestNote', { year: stats.earliestYear }) : t('dataset.statEarliestNone')}</p>
            </div>
          </dl>
        </div>
      </div>
    </section>
  </>;
}
