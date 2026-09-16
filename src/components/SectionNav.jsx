import React from 'react';

/**
 * A compact "on this page" row for a long page, plus the hook that marks
 * which section the reader is currently inside.
 *
 * Shared rather than written twice: the Government page and the portfolio
 * profile have the same problem — ten-ish sections in one column, no way to
 * enter in the middle, no way to tell where you are once you have scrolled.
 * Solving it in one place is also what keeps the two from drifting into
 * slightly different keyboard and `aria-current` behaviour.
 *
 * The nav is plain `<a href="#…">` markup: it works with JavaScript off, it
 * is in the prerendered HTML, and every target is a real element id on the
 * page. `useActiveSection` only adds the "you are here" marking on top.
 */
export function SectionNav({ sections, activeId, label, sticky = true }) {
  // One destination is not navigation.
  if (sections.length < 2) return null;
  return <nav className={`section-nav${sticky ? '' : ' section-nav--static'}`} aria-label={label}>
    <ul className="section-nav__list">
      {sections.map(section => (
        <li key={section.id}>
          <a
            className="section-nav__link"
            href={`#${section.id}`}
            aria-current={section.id === activeId ? 'true' : undefined}
          >
            <span className="section-nav__link-label--full">{section.title}</span>
            {/* Optional short form, same contract as Tabs.jsx's `shortLabel`:
                only rendered when a caller supplies one, so callers that
                never pass `shortTitle` (Government page) get exactly the
                markup this had before. */}
            {section.shortTitle ? <span className="section-nav__link-label--short">{section.shortTitle}</span> : null}
            {typeof section.count === 'number' ? <span className="section-nav__count">{section.count}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  </nav>;
}

/**
 * Which of `ids` is the section the reader is currently reading.
 *
 * Effect-only, so it has no bearing on the prerendered HTML, and the initial
 * value is the first id unconditionally — matching a fresh load at scroll 0,
 * for the same hydration reason `ThemeToggle` starts `dark=false`.
 *
 * The visibility of EVERY tracked section is kept across callbacks, because
 * an IntersectionObserver callback reports only the entries that CHANGED
 * since the last one. Deciding from `entries` alone leaves the marker on
 * whichever section last changed state rather than on the topmost visible
 * one.
 *
 * A section inside a `hidden` tab panel has no layout box at all, so it can
 * never be reported as intersecting — which is exactly the behaviour the
 * portfolio profile needs: the active section is always one in the panel the
 * reader can actually see.
 *
 * Returns `[active, setActive]`, like `useState`: switching to a panel that
 * was `hidden` a moment ago does not reliably re-fire the observer on the
 * same frame (a `hidden` removal is a display change, not a scroll, and
 * nothing here forces a synchronous re-check), so a reader who opens a tab
 * without scrolling could see no "on this page" link marked current at all
 * until they scrolled. Exposing the setter lets a caller that already knows
 * which section a tab switch or a hash jump lands on say so immediately; the
 * observer still takes over the moment the reader actually scrolls.
 */
export function useActiveSection(ids) {
  const [active, setActive] = React.useState(ids[0] ?? null);
  const key = ids.join('|');

  React.useEffect(() => {
    const tracked = ids
      .map(id => ({ id, element: document.getElementById(id)?.closest('section') }))
      .filter(entry => entry.element);
    if (!tracked.length) return undefined;

    const visible = new Map();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) visible.set(entry.target, entry.isIntersecting);
        const current = tracked
          .filter(entry => visible.get(entry.element))
          .sort((a, b) => a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top)[0];
        if (current) setActive(current.id);
      },
      // The band is the strip just under the sticky header: a section becomes
      // "current" once it reaches that line, which is what reading downward
      // actually feels like.
      { rootMargin: '-140px 0px -55% 0px', threshold: 0 },
    );
    for (const entry of tracked) observer.observe(entry.element);
    return () => observer.disconnect();
    // `key` is the identity of the id LIST; re-running on the array's
    // reference would re-observe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [active, setActive];
}
