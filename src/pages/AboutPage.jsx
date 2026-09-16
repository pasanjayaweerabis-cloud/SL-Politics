import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { SectionHead, ActionLink, StatsCard, Notice, VerificationLegend } from '../components/Primitives.jsx';
import { datasetStats, DATASET, sourcesInUse, verificationStateCounts } from '../services/repository.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';
import { isApiEnabled } from '../services/apiClient.ts';

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

const CORRECTION_STEPS = ['stepOpen', 'stepReview', 'stepDecision', 'stepPublished'];

/**
 * What this dataset holds and the sourcing principles behind it.
 *
 * Section order (see the About-page cleanup prompt's Task 7): header, what's
 * in the records, what's covered and what isn't, how records are sourced,
 * what the labels mean, then corrections — a normal reader's order, rather
 * than the researcher order ("methodology" first) this page used to open
 * with.
 */
export default function AboutPage() {
  const { t, n } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const stats = React.useMemo(() => datasetStats(today), [today]);
  const verificationCounts = React.useMemo(() => verificationStateCounts(today), [today]);
  const demonstration = DATASET.mode === 'demonstration';
  const connected = isApiEnabled();

  const usedSources = sourcesInUse();
  const usedSourceNames = usedSources.map(s => s.institution).join(' · ');

  React.useEffect(() => { applyPageMeta(routeMeta('about')); }, []);

  return <>
    <header className="section section--tight">
      <div className="container">
        <p className="eyebrow">{t('about.eyebrow')}</p>
        <h1>{t('about.title')}</h1>
        <p className="lede">{t('about.lede')}</p>
      </div>
    </header>

    <section className="section section--tight section--alt" aria-labelledby="records-heading">
      <div className="container">
        <SectionHead id="records-heading" title={t('about.recordsHeading')} description={t('about.recordsDescription')}/>
        <div className="grid-stats">
          <StatsCard iconName="users" value={stats.people} label={t('dataset.statPeople')} note={t('dataset.statPeopleNote', { count: n(stats.serving) })}/>
          <StatsCard iconName="layers" value={stats.positions} label={t('dataset.statPositions')} note={t('dataset.statPositionsNote', { count: n(stats.distinctOffices) })}/>
          <StatsCard
            iconName="link"
            value={stats.connectedSources}
            label={t('dataset.statSourcesInUse')}
            note={stats.connectedSources ? t('dataset.statSourcesInUseNote', { names: usedSourceNames }) : t('dataset.statSourcesNone')}
          />
          <StatsCard
            iconName="calendar"
            value={stats.earliestYear ? String(stats.earliestYear) : '—'}
            label={t('dataset.statEarliest')}
            note={stats.earliestYear ? t('dataset.statEarliestNote', { year: stats.earliestYear }) : t('dataset.statEarliestNone')}
          />
        </div>
      </div>
    </section>

    {/*
      Scope and limitations, merged into one section (previously split
      across a `Notice` in the methodology column and a separate
      "Limitations" section at the foot of the page — the same topic said
      twice). `id="limitations"` stays the anchor id so a bookmarked or
      shared `/about#limitations` link keeps resolving to the right place.
    */}
    <section className="section section--tight" id="limitations" aria-labelledby="scope-heading">
      <div className="container">
        <SectionHead id="scope-heading" title={t('about.scopeHeading')} description={t('about.scopeDescription')}/>
        {demonstration
          ? <Notice
              tone="warning"
              iconName="alert"
              title={t('about.demoNoticeTitle')}
              body={[t('about.demoNoticeBody')]}
            />
          : <ul className="bullet-list">
              <li>{t('about.scopeWho')}</li>
              <li>{t('about.scopeNotYet')}</li>
              <li>{t('about.scopeUpdates')}</li>
              <li>{t('about.scopeStale')}</li>
              <li>{t('about.scopeHistorical')}</li>
              <li>{t('about.scopeVerification')}</li>
            </ul>}
      </div>
    </section>

    <section className="section" id="methodology" aria-labelledby="methodology-heading">
      <div className="container">
        <SectionHead id="methodology-heading" title={t('about.methodologyHeading')}/>
        <dl className="definition-grid">
          {PRINCIPLES.map(([icon, titleKey, bodyKey]) => (
            <div className="definition-grid__item" key={titleKey}>
              <dt><span className="definition-grid__icon" aria-hidden="true"><Icon name={icon}/></span>{t(`about.${titleKey}`)}</dt>
              <dd>{t(`about.${bodyKey}`)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>

    <section className="section section--alt" id="labels" aria-labelledby="labels-heading">
      <div className="container">
        <SectionHead
          id="labels-heading"
          title={t('about.labelsHeading')}
          description={t('about.labelsDescription')}
        />
        <VerificationLegend states={VERIFICATION_STATES} counts={verificationCounts}/>

        <div className="u-mt-8">
          <h3 className="about-subheading">{t('about.missingHeading')}</h3>
          <dl className="definition-grid">
            <div className="definition-grid__item"><dt>{t('about.missingNotRecordedTerm')}</dt><dd>{t('about.missingNotRecordedBody')}</dd></div>
            <div className="definition-grid__item"><dt>{t('about.missingNotPublishedTerm')}</dt><dd>{t('about.missingNotPublishedBody')}</dd></div>
            <div className="definition-grid__item"><dt>{t('about.missingNoResultsTerm')}</dt><dd>{t('about.missingNoResultsBody')}</dd></div>
          </dl>
        </div>
      </div>
    </section>

    {/* The end of the page a reader reaches after learning how the records
        are made is exactly where "and here is what to do when one is wrong"
        belongs. Two states, and the page always says which it is in — the
        same honesty rule CorrectionsPage itself follows: a "Report an
        error" button that turns out to lead nowhere would be worse than
        naming the disconnected state plainly. */}
    <section className="section section--tight" aria-labelledby="corrections-heading">
      <div className="container">
        <SectionHead
          id="corrections-heading"
          title={t('about.correctionsHeading')}
          description={t('about.correctionsDescription')}
          action={<ActionLink label={connected ? t('common.reportError') : t('about.correctionsDisconnectedLink')} href="/corrections"/>}
        />
        {connected
          ? <>
              <p className="meta u-mt-5">{t('corrections.reviewStatesConnected')}</p>
              <ol className="about-stepper u-mt-3">
                {CORRECTION_STEPS.map(step => (
                  <li key={step}>
                    <p className="about-stepper__title">{t(`corrections.${step}Title`)}</p>
                    <p className="about-stepper__body">{t(`corrections.${step}Body`)}</p>
                  </li>
                ))}
              </ol>
            </>
          : <p className="meta u-mt-5">{t('about.correctionsDisconnectedLine')}</p>}
      </div>
    </section>
  </>;
}
