import React from 'react';
import { Icon } from '../lib/icons.jsx';

/**
 * Javora — accessible tab set.
 *
 * Follows the WAI-ARIA tabs pattern with MANUAL activation: arrow keys move
 * focus between tabs, and Enter/Space activates. Automatic activation (where
 * merely focusing a tab switches the panel) is the more common
 * implementation, but it is the wrong choice here — a keyboard user arrowing
 * past "Political Career" to reach it would swap the whole panel underneath
 * them on the way, which a screen reader then announces. Manual activation
 * lets someone browse the tabs before committing to one.
 *
 * Roving tabindex: exactly one tab is in the tab order at a time, so Tab
 * moves *past* the tab strip to the panel rather than through every tab.
 */
export function Tabs({ tabs, active, onChange, label, idPrefix = 'javora-tab' }) {
  const refs = React.useRef([]);

  const focusTab = index => {
    const next = (index + tabs.length) % tabs.length;
    refs.current[next]?.focus();
  };

  const onKeyDown = (event, index) => {
    switch (event.key) {
      case 'ArrowRight': event.preventDefault(); focusTab(index + 1); break;
      case 'ArrowLeft':  event.preventDefault(); focusTab(index - 1); break;
      case 'Home':       event.preventDefault(); focusTab(0); break;
      case 'End':        event.preventDefault(); focusTab(tabs.length - 1); break;
      // Space and Enter commit the focused tab. `onClick` already handles
      // Enter on a <button>, but Space needs the explicit case.
      case ' ':
      case 'Enter':      event.preventDefault(); onChange(tabs[index].id); break;
      default: break;
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={element => { refs.current[index] = element; }}
            type="button"
            role="tab"
            id={`${idPrefix}-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            // Roving tabindex — only the active tab is reachable by Tab.
            tabIndex={selected ? 0 : -1}
            className={`tabs__tab${selected ? ' tabs__tab--active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            {tab.icon ? <Icon name={tab.icon} /> : null}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A tab panel.
 *
 * EVERY panel renders its children, including the inactive ones, and `hidden`
 * does the hiding. The obvious-looking alternative — `{selected ? children :
 * null}` — was what this did, and it silently cost the site half of every
 * profile: these pages are statically prerendered, so a panel that renders
 * nothing at render time produces an empty <div> in the HTML file a crawler
 * reads. On a politician profile that meant the entire Political Career tab —
 * the offices, terms and dates that are the substance of the record — was
 * absent from the public HTML, visible only after JavaScript ran.
 *
 * `hidden` is the correct mechanism regardless: it removes the panel from the
 * accessibility tree and from view, which is exactly the WAI-ARIA tabs
 * pattern, while leaving the content in the document. Nothing here is hidden
 * from crawlers that a reader cannot reach by clicking a tab, so this is
 * ordinary progressive enhancement, not cloaking.
 */
export function TabPanel({ id, active, labelledBy, idPrefix = 'javora-tab', children }) {
  const selected = id === active;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={labelledBy ?? `${idPrefix}-${id}`}
      hidden={!selected}
      // Focusable so that Tab from the tab strip lands in the panel, which is
      // what lets a keyboard user actually reach the content they selected.
      tabIndex={selected ? 0 : -1}
    >
      {children}
    </div>
  );
}
