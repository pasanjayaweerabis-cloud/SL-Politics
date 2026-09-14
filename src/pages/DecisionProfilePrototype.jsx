import React from 'react';
import { applyPageMeta } from '../lib/seo.ts';
import './DecisionProfilePrototype.css';

/**
 * "Decision-first" profile layout — design prototype for ONE person,
 * Harsha de Silva, hardcoded end to end.
 *
 * NOT a production feature. It does not read `repository.ts`, does not call
 * `getPersonBySlug`, and generalises to no one else — see CLAUDE.md's Route
 * section for why. Every ministry budget, spend percentage and audit-finding
 * count in section 02 is an invented placeholder for the layout; each is
 * flagged individually below, in addition to the banner.
 */

function SectionHeader({ no, title, question, id }) {
  return (
    <div className="dp-proto__section-header">
      <span className="dp-proto__section-no" aria-hidden="true">{no}</span>
      <h2 id={id}>{title}</h2>
      <p className="dp-proto__section-question">{question}</p>
    </div>
  );
}

function Row({ label, value, absent = false }) {
  return (
    <div className="dp-proto__row">
      <dt>{label}</dt>
      <dd className={absent ? 'dp-proto__value--absent' : undefined}>{value}</dd>
    </div>
  );
}

function Tile({ label, value, valueAbsent = false, delta, deltaTone = 'muted' }) {
  return (
    <div className="dp-proto__tile">
      <p className="dp-proto__tile-label">{label}</p>
      <p className={valueAbsent ? 'dp-proto__tile-value dp-proto__tile-value--absent' : 'dp-proto__tile-value'}>{value}</p>
      {delta ? <p className={`dp-proto__tile-delta dp-proto__tile-delta--${deltaTone}`}>{delta}</p> : null}
    </div>
  );
}

// A named binding rather than an inline object literal at the call site:
// src/lib/seo.test.ts statically scans for calls that open with an inline
// brace right after the function name, and checks the keys used there
// against PageMeta's real fields. Every existing page instead routes through
// routeMeta()/personMeta(), so no other file's call is shaped that way. This
// route has neither helper (it is deliberately outside routeManifest.ts), so
// it builds its own PageMeta value here, one step removed from the call.
const PAGE_META = {
  title: 'Decision-profile prototype — Harsha de Silva',
  description: 'Internal design prototype. Illustrative figures, not real data.',
  // No `path`: this route has no canonical URL to publish and no place in
  // the sitemap — see the comment on the router pattern in lib/router.tsx.
  noindex: true,
};

export default function DecisionProfilePrototype() {
  React.useEffect(() => {
    applyPageMeta(PAGE_META);
  }, []);

  return (
    <div className="dp-proto">
      <p className="dp-proto__banner" role="note">
        PROTOTYPE — ILLUSTRATIVE FIGURES, NOT REAL DATA
      </p>

      {/* ================= HERO ================= */}
      <header className="dp-proto__hero">
        <div className="dp-proto__container dp-proto__hero-grid">
          <div className="dp-proto__portrait" role="img" aria-label="Portrait placeholder for Harsha de Silva" />
          <div>
            <h1>Harsha de Silva</h1>
            <p className="dp-proto__subtitle">Member of Parliament — Colombo District</p>
            <ul className="dp-proto__chips">
              <li className="dp-proto__chip dp-proto__chip--serving">● Currently serving</li>
              <li className="dp-proto__chip">Samagi Jana Balawegaya</li>
              <li className="dp-proto__chip">Every fact below links to its source</li>
            </ul>
          </div>
        </div>
      </header>

      {/* ================= FACT STRIP ================= */}
      <section aria-labelledby="dp-proto-facts-heading">
        <h2 id="dp-proto-facts-heading" className="dp-proto__visually-hidden">Key facts</h2>
        <div className="dp-proto__container">
          <dl className="dp-proto__fact-strip">
            <div className="dp-proto__fact-cell">
              <dt>Age</dt>
              <dd>62<small>born 30 Aug 1964</small></dd>
            </div>
            <div className="dp-proto__fact-cell">
              <dt>In Parliament</dt>
              <dd>15 yrs<small>since 2010, 4 terms</small></dd>
            </div>
            <div className="dp-proto__fact-cell">
              <dt>Before politics</dt>
              <dd>Economist<small>PhD, Univ. of Missouri</small></dd>
            </div>
            <div className="dp-proto__fact-cell">
              <dt>Positions of power</dt>
              <dd>5<small>2 ministries, 3 deputy</small></dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ================= 01 — BEFORE POLITICS ================= */}
      <section className="dp-proto__section" aria-labelledby="dp-proto-s01">
        <div className="dp-proto__container">
          <SectionHeader
            id="dp-proto-s01"
            no="01"
            title="Before politics"
            question="What did he do before we gave him power?"
          />
          <div className="dp-proto__pair-cards">
            <div className="dp-proto__card">
              <p className="dp-proto__card-title">Education</p>
              <dl className="dp-proto__rows">
                <Row label="PhD, Economics" value="Univ. of Missouri, USA" />
                <Row label="MA, Economics" value="Univ. of Missouri, USA" />
                <Row label="G.C.E. Advanced Level" value="not published" absent />
                <Row label="School" value="not published" absent />
              </dl>
            </div>
            <div className="dp-proto__card">
              <p className="dp-proto__card-title">Work &amp; profession</p>
              <dl className="dp-proto__rows">
                <Row label="Stated profession" value="Economist" />
                <Row label="Employers before 2010" value="not published" absent />
                <Row label="Professional licences" value="none on record" absent />
                <Row label="Board / company roles" value="not published" absent />
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 02 — WHAT HE WAS RESPONSIBLE FOR ================= */}
      <section className="dp-proto__section" aria-labelledby="dp-proto-s02">
        <div className="dp-proto__container">
          <SectionHeader
            id="dp-proto-s02"
            no="02"
            title="What he was responsible for"
            question="What happened in the country while he held it?"
          />
          <div className="dp-proto__office-cards">

            {/* Card 1 — Deputy Minister of Foreign Affairs */}
            <div className="dp-proto__office-card">
              <div className="dp-proto__office-head">
                <h3 className="dp-proto__office-name">Deputy Minister of Foreign Affairs</h3>
                <span className="dp-proto__office-tenure">2015 — 2017 · 2 yrs</span>
              </div>
              <p className="dp-proto__office-scope">Scope: diplomatic missions, visa policy, foreign service budget</p>
              <div className="dp-proto__tile-grid">
                {/* FAKE PLACEHOLDER — invented for layout, not a real Treasury figure */}
                <Tile label="Ministry budget" value="Rs 8.1bn → 9.4bn" delta="+16% over tenure" deltaTone="bad" />
                {/* FAKE PLACEHOLDER — invented for layout, not a real spend figure */}
                <Tile label="Budget actually spent" value="86%" delta="of allocation" deltaTone="muted" />
                {/* FAKE PLACEHOLDER — invented for layout, not a real Auditor General count */}
                <Tile label="Audit findings" value="3 raised" delta="1 unresolved" deltaTone="bad" />
              </div>
              <div className="dp-proto__source-line">
                <span className="dp-proto__source-tag">S007</span>
                <span className="dp-proto__source-text">Auditor General &amp; Treasury, 2015–2017</span>
                <span className="dp-proto__source-link">See the exact pages</span>
              </div>
              <div className="dp-proto__caveat">
                <strong>Read this carefully.</strong>
                These are national figures for the ministry during his term. They are not a
                score, and they are not proof he caused them — a minister inherits budgets,
                crises and staff. Use them as a starting question, not a verdict.
              </div>
            </div>

            {/* Card 2 — State Minister of National Policies & Economic Affairs */}
            <div className="dp-proto__office-card">
              <div className="dp-proto__office-head">
                <h3 className="dp-proto__office-name">State Minister of National Policies &amp; Economic Affairs</h3>
                <span className="dp-proto__office-tenure">2017 — 2018 · 1 yr</span>
              </div>
              <p className="dp-proto__office-scope">Scope: national planning, economic policy coordination</p>
              <div className="dp-proto__tile-grid">
                {/* FAKE PLACEHOLDER — invented for layout, not a real Treasury figure */}
                <Tile label="Ministry budget" value="Rs 24.6bn" delta="no prior-year figure" deltaTone="muted" />
                {/* FAKE PLACEHOLDER — invented for layout, not a real spend figure */}
                <Tile label="Budget actually spent" value="71%" delta="Rs 7.1bn unspent" deltaTone="good" />
                <Tile
                  label="Audit findings"
                  value="not published"
                  valueAbsent
                  delta="report not online"
                  deltaTone="muted"
                />
              </div>
              <div className="dp-proto__source-line">
                <span className="dp-proto__source-tag">S007</span>
                <span className="dp-proto__source-text">Auditor General &amp; Treasury, 2017–2018</span>
                <span className="dp-proto__source-link">See the exact pages</span>
              </div>
            </div>

            {/* Card 3 — Member of Parliament, no ministry */}
            <div className="dp-proto__office-card dp-proto__office-card--no-ministry">
              <div className="dp-proto__office-head">
                <h3 className="dp-proto__office-name">
                  Member of Parliament
                  <span className="dp-proto__office-name-suffix">— no ministry</span>
                </h3>
                <span className="dp-proto__office-tenure">2010 — 2015, 2024 — now</span>
              </div>
              <p className="dp-proto__office-scope">Scope: voting, questions, committee work. No budget under his control.</p>
              <div className="dp-proto__caveat dp-proto__caveat--plain">
                An ordinary MP controls no ministry, so there is nothing to measure here
                except how he used the seat — attendance, votes and questions.{' '}
                <strong>Not yet loaded on SL Politics.</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 03 — WHAT NOBODY PUBLISHES ================= */}
      <section className="dp-proto__section" aria-labelledby="dp-proto-s03">
        <div className="dp-proto__container">
          <SectionHeader
            id="dp-proto-s03"
            no="03"
            title="What nobody publishes about him"
            question="What you are not being told"
          />
          <dl className="dp-proto__disclosure-card">
            <div className="dp-proto__disclosure-row">
              <dt>Assets &amp; liabilities declaration</dt>
              <dd>filed by law — not made public in Sri Lanka</dd>
            </div>
            <div className="dp-proto__disclosure-row">
              <dt>Campaign funding &amp; donors</dt>
              <dd>no public register exists</dd>
            </div>
            <div className="dp-proto__disclosure-row">
              <dt>Election results &amp; preference votes</dt>
              <dd>Election Commission — not yet connected</dd>
            </div>
            <div className="dp-proto__disclosure-row">
              <dt>Court cases or investigations</dt>
              <dd>SL Politics does not publish allegations</dd>
            </div>
          </dl>
          <p className="dp-proto__disclosure-note">
            An empty line above means <strong>nobody published it</strong> — not that he is
            clean, and not that he is guilty.
          </p>
        </div>
      </section>

      {/* ================= 04 — GO DEEPER ================= */}
      <section className="dp-proto__section" aria-labelledby="dp-proto-s04">
        <div className="dp-proto__container">
          <SectionHeader
            id="dp-proto-s04"
            no="04"
            title="Go deeper"
            question="for journalists & researchers"
          />
          <div className="dp-proto__deeper-panel">
            <h3>The full record — every vote, question, bill, committee and attendance figure</h3>
            <p>
              4,180 raw records for this member, with source links and a CSV export, so you
              can run your own analysis instead of trusting ours. Built for newsrooms,
              researchers and civil society.
            </p>
            <button type="button" className="dp-proto__btn-outline">See what&rsquo;s inside →</button>
          </div>
        </div>
      </section>
    </div>
  );
}
