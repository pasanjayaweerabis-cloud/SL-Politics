import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { SectionHead, ActionLink, StatsCard, Notice, VerificationLegend } from '../components/Primitives.jsx';
import { datasetStats, DATASET } from '../services/repository.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';

/**
 * The verification states, in the order a reader meets them: the two that
 * describe a checked record first, then the qualified ones, then the two
 * kinds of absence.
 *
 * Listing them here is the second rung of the audit's three-level
 * methodology path — a badge on a profile carries the word and a `title`,
 * this page carries the definitions, and docs/data-model-principles.md
 * carries the model. The labels and descriptions come from
 * VERIFICATION_PRESENTATION (lib/verification.ts) rather than being restated,
 * so the page and the badges can never disagree about what a state means.
 */
const VERIFICATION_STATES = [
  'verified',
  'source-linked',
  'secondary-corroborated',
  'pending-review',
  'conflicting',
  'unverified',
  'unavailable',
];

const PRINCIPLES = [
  ['building', 'principle1Title', 'principle1Body'],
  ['link', 'principle2Title', 'principle2Body'],
  ['archive', 'principle3Title', 'principle3Body'],
  ['scale', 'principle4Title', 'principle4Body'],
];

/**
 * What this dataset holds and the sourcing principles behind it — moved here
 * from the homepage so the "About" nav item names a real page instead of an
 * anchor on Home (see the note above NAV_ITEMS in Chrome.jsx). Content and
 * i18n keys are unchanged from their original home.* namespace.
 */
export default function AboutPage() {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const stats = React.useMemo(() => datasetStats(today), [today]);
  const demonstration = DATASET.mode === 'demonstration';

  React.useEffect(() => { applyPageMeta(routeMeta('about')); }, []);

  return <>
    <header className="section section--tight">
      <div className="container">
        <p className="eyebrow">{t('about.eyebrow')}</p>
        <h1>{t('about.title')}</h1>
        <p className="lede">{t('about.lede')}</p>
      </div>
    </header>

    <section className="section section--tight section--alt" aria-labelledby="figures-heading">
      <div className="container">
        <SectionHead id="figures-heading" title={t('home.datasetHeading')} description={t('home.datasetDescription')}/>
        <div className="grid-stats">
          <StatsCard iconName="users" value={stats.people} label={t('home.statPeople')} note={t('home.statPeopleNote', { count: stats.serving })}/>
          <StatsCard iconName="layers" value={stats.positions} label={t('home.statPositions')} note={t('home.statPositionsNote', { count: stats.distinctOffices })}/>
          <StatsCard iconName="link" value={stats.sources} label={t('home.statSources')} note={stats.connectedSources ? t('home.statSourcesConnected', { count: stats.connectedSources }) : t('home.statSourcesNone')}/>
          <StatsCard iconName="calendar" value={stats.earliestYear ?? '—'} label={t('home.statEarliest')} note={stats.earliestYear ? t('home.statEarliestRetained') : t('home.statEarliestNone')}/>
        </div>
        <p className="meta u-mt-5">
          {demonstration
            ? t('home.figuresDemo')
            : t('home.figuresReal', { serving: stats.serving, former: stats.former })}
        </p>
      </div>
    </section>

    {/*
      What the words on a record actually claim.

      The audit's finding was that a visitor meets five or six parallel
      vocabularies — source-linked, verified, not established, unavailable,
      not recorded — with no single place that defines any of them. None of
      them can be merged (they are different claims about the world), so the
      fix is a definition list, once, where a reader who wants it can find
      it, and plain wording plus a `title` everywhere else.
    */}
    <section className="section section--tight" id="labels" aria-labelledby="labels-heading">
      <div className="container">
        <SectionHead
          id="labels-heading"
          title={t('about.labelsHeading')}
          description={t('about.labelsDescription')}
        />
        <VerificationLegend states={VERIFICATION_STATES}/>

        <div className="u-mt-8">
          <h3 className="about-subheading">{t('about.missingHeading')}</h3>
          <dl className="about-terms">
            <div><dt>{t('about.missingNotRecordedTerm')}</dt><dd>{t('about.missingNotRecordedBody')}</dd></div>
            <div><dt>{t('about.missingNotPublishedTerm')}</dt><dd>{t('about.missingNotPublishedBody')}</dd></div>
            <div><dt>{t('about.missingNoResultsTerm')}</dt><dd>{t('about.missingNoResultsBody')}</dd></div>
          </dl>
        </div>
      </div>
    </section>

    <section className="section" id="methodology" aria-labelledby="methodology-heading">
      <div className="container">
        <div className="trust">
          <div className="trust__text">
            <p className="eyebrow">{t('home.methodologyLabel')}</p>
            <h2 id="methodology-heading">{t('home.methodologyTitle')}</h2>
            <p className="lede">{t('home.methodologyLede')}</p>
            <div className="u-mt-5"><ActionLink label={t('home.browseDirectoryAction')} href="/directory"/></div>
          </div>
          <div className="principles">
            {PRINCIPLES.map(([icon, titleKey, bodyKey]) => (
              <div className="principle" key={titleKey}>
                <span className="principle__icon" aria-hidden="true"><Icon name={icon}/></span>
                <div><h3>{t(`home.${titleKey}`)}</h3><p>{t(`home.${bodyKey}`)}</p></div>
              </div>
            ))}
            {demonstration ? <Notice
              tone="warning"
              iconName="alert"
              title={t('home.demoNoticeTitle')}
              body={[t('home.demoNoticeBody')]}
            /> : <Notice
              tone="info"
              iconName="info"
              title={t('home.infoNoticeTitle')}
              body={[
                t('home.infoNoticeBody1', { people: stats.people, serving: stats.serving, former: stats.former }),
                t('home.infoNoticeBody2', { year: stats.earliestYear }),
                t('home.infoNoticeBody3'),
              ]}
            />}
          </div>
        </div>
      </div>
    </section>

    {/* The end of the page a reader reaches after learning how the records
        are made is exactly where "and here is what to do when one is wrong"
        belongs. */}
    <section className="section section--tight section--alt" aria-labelledby="corrections-heading">
      <div className="container">
        <SectionHead
          id="corrections-heading"
          title={t('about.correctionsHeading')}
          description={t('about.correctionsDescription')}
          action={<ActionLink label={t('common.reportError')} href="/corrections"/>}
        />
      </div>
    </section>
  </>;
}
