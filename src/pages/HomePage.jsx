import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { ProfileCard, SectionHead, ActionLink } from '../components/Primitives.jsx';
import { HomeHero } from '../components/home/HomeHero.jsx';
import {
  discoverablePeople, datasetStats, directoryStats, sortForDisplay,
} from '../services/repository.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';

/**
 * The four places this site can take you, stated before the reader has to
 * go looking for them.
 *
 * The homepage used to be a full-viewport photograph followed directly by
 * six profile cards: nothing on it said that a Current Government page
 * existed, that corrections could be filed, or where the records come
 * from — the nav bar named them, in 14px, above the fold of a photo. This
 * is the site's information architecture, written out once, in the order a
 * reader needs it. Editorial rows rather than cards on purpose: four
 * equally-sized boxes with icons would say "product features", and these
 * are destinations.
 *
 * Every `href` is a route in lib/routeManifest.ts. Nothing here links to a
 * page that does not exist.
 */
const QUICK_ACCESS = [
  { href: '/directory', titleKey: 'home.quickDirectoryTitle', bodyKey: 'home.quickDirectoryBody', icon: 'users' },
  { href: '/government', titleKey: 'home.quickGovernmentTitle', bodyKey: 'home.quickGovernmentBody', icon: 'building' },
  { href: '/about', titleKey: 'home.quickAboutTitle', bodyKey: 'home.quickAboutBody', icon: 'shield' },
  { href: '/corrections', titleKey: 'home.quickCorrectionsTitle', bodyKey: 'home.quickCorrectionsBody', icon: 'alert' },
];

export default function HomePage() {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  // Discovery surface: excludes confirmed deceased people, same pool the
  // directory and search draw from. `stats` below stays the FULL dataset —
  // it is a coverage/provenance figure, not a discovery listing.
  const people = discoverablePeople(today);
  const featured = React.useMemo(() => sortForDisplay(people, today).slice(0, 6), [people, today]);
  const stats = React.useMemo(() => datasetStats(today), [today]);
  const dirStats = React.useMemo(() => directoryStats(today), [today]);
  const number = value => (typeof value === 'number' ? value.toLocaleString('en-US') : String(value ?? '—'));

  React.useEffect(() => { applyPageMeta(routeMeta('home')); }, []);

  return <>
    <HomeHero/>

    <section className="section" id="explore" aria-labelledby="explore-heading">
      <div className="container">
        <SectionHead
          id="explore-heading"
          title={t('home.exploreHeading')}
          description={t('home.exploreDescription')}
        />
        <nav className="quick-access" aria-labelledby="explore-heading">
          {QUICK_ACCESS.map(item => (
            <a className="quick-access__item" key={item.href} href={item.href}>
              <span className="quick-access__icon" aria-hidden="true"><Icon name={item.icon}/></span>
              <span className="quick-access__text">
                <span className="quick-access__title">{t(item.titleKey)}</span>
                <span className="quick-access__body">
                  {t(item.bodyKey, { people: number(dirStats.people), serving: number(dirStats.serving) })}
                </span>
              </span>
              <Icon name="arrowRight" className="quick-access__go"/>
            </a>
          ))}
        </nav>
      </div>
    </section>

    <section className="section section--tight" aria-labelledby="directory-heading">
      <div className="container">
        <SectionHead
          id="directory-heading"
          title={t('home.directoryHeading')}
          description={t('home.directoryDescription')}
          action={<ActionLink label={t('common.viewAll')} href="/directory"/>}
        />
        <div className="grid-cards">{featured.map(view => <ProfileCard key={view.person.id} view={view} today={today}/>)}</div>
        <p className="divider-note"><Icon name="layers"/><span>{t('home.showingOfDirectory', { shown: featured.length, total: number(dirStats.people) })}</span></p>
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
              <dt>{t('home.statPeople')}</dt>
              <dd>{number(stats.people)}</dd>
              <p>{t('home.statPeopleNote', { count: number(stats.serving) })}</p>
            </div>
            <div className="home-trust__figure">
              <dt>{t('home.statPositions')}</dt>
              <dd>{number(stats.positions)}</dd>
              <p>{t('home.statPositionsNote', { count: number(stats.distinctOffices) })}</p>
            </div>
            <div className="home-trust__figure">
              <dt>{t('home.statSources')}</dt>
              <dd>{number(stats.sources)}</dd>
              <p>{stats.connectedSources ? t('home.statSourcesConnected', { count: stats.connectedSources }) : t('home.statSourcesNone')}</p>
            </div>
            <div className="home-trust__figure">
              <dt>{t('home.statEarliest')}</dt>
              <dd>{stats.earliestYear ?? '—'}</dd>
              <p>{stats.earliestYear ? t('home.statEarliestRetained') : t('home.statEarliestNone')}</p>
            </div>
          </dl>
        </div>
      </div>
    </section>
  </>;
}
