/**
 * Javora — inline icon set.
 *
 * Icons are inlined rather than loaded from a font or sprite sheet: there are
 * few of them, they inherit `currentColor` so they theme for free, and it keeps
 * the network cost at zero.
 *
 * No React import — the project uses the automatic JSX runtime.
 */

const paths = {
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  shield: <path d="M12 3 5 6v5.5c0 4.2 2.9 8 7 9.5 4.1-1.5 7-5.3 7-9.5V6l-7-3Z"/>,
  shieldCheck: <><path d="M12 3 5 6v5.5c0 4.2 2.9 8 7 9.5 4.1-1.5 7-5.3 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
  building: <><path d="M4 21h16"/><path d="M6 21V6l6-3 6 3v15"/><path d="M10 21v-4h4v4"/><path d="M10 9h.01M14 9h.01M10 13h.01M14 13h.01"/></>,
  document: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></>,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 10h16"/></>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></>,
  mapPin: <><path d="M12 21s6.5-5.7 6.5-10.3A6.5 6.5 0 0 0 5.5 10.7C5.5 15.3 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.4"/></>,
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></>,
  users: <><circle cx="9.5" cy="8" r="3.2"/><path d="M3.5 20a6 6 0 0 1 12 0"/><path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9"/><path d="M18 14.6a6 6 0 0 1 2.5 5.4"/></>,
  link: <><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3"/></>,
  external: <><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18.5 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h4.5"/></>,
  filter: <><path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/></>,
  moon: <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  arrowRight: <><path d="M5 12h13"/><path d="m12.5 6 6 6-6 6"/></>,
  arrowLeft: <><path d="M19 12H6"/><path d="m11.5 6-6 6 6 6"/></>,
  chevronDown: <path d="m6 9.5 6 6 6-6"/>,
  info: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/></>,
  alert: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V13"/><path d="M12 16.4h.01"/></>,
  scale: <><path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 8h14"/><path d="m5 8-2.5 5.5a3 3 0 0 0 5 0L5 8Z"/><path d="m19 8-2.5 5.5a3 3 0 0 0 5 0L19 8Z"/></>,
  archive: <><rect x="3.5" y="4" width="17" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></>,
  layers: <><path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-13.7-5.2L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 13.7 5.2L20 16"/><path d="M20 20v-4h-4"/></>,
  award: <><circle cx="12" cy="9" r="5"/><path d="m8.5 13.2-1.3 7 4.8-2.5 4.8 2.5-1.3-7"/></>,
  bookOpen: <><path d="M12 6.5S10.2 5 7 5H3.5v13H7c3.2 0 5 1.5 5 1.5"/><path d="M12 6.5S13.8 5 17 5h3.5v13H17c-3.2 0-5 1.5-5 1.5"/><path d="M12 6.5v13"/></>,
  slash: <><circle cx="12" cy="12" r="8.5"/><path d="m6.5 17.5 11-11"/></>,
  globe: <><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5a13 13 0 0 1 3.3 8.5A13 13 0 0 1 12 20.5 13 13 0 0 1 8.7 12 13 13 0 0 1 12 3.5Z"/></>,
  check: <path d="M5 12.5 10 17.5 19 6.5"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  halfCircle: <><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5A8.5 8.5 0 0 1 12 20.5Z" fill="currentColor" stroke="none"/></>,
  quote: <><path d="M8 7c-2.2 0-4 1.8-4 4v6h4v-6H6a2 2 0 0 1 2-2V7Z" fill="currentColor" stroke="none"/><path d="M18 7c-2.2 0-4 1.8-4 4v6h4v-6h-2a2 2 0 0 1 2-2V7Z" fill="currentColor" stroke="none"/></>,
  // Two nested open arcs, each turning a little further than the last — a
  // plain hand-drawn "two-turn spiral" for the home-hero logo disc. Added
  // here rather than a separate icons module: this file already is one, and
  // duplicating it would just fork the same abstraction in two places.
  spiral: <><path d="M12 4.2a7.8 7.8 0 1 0 7.8 7.8"/><path d="M12 8a4 4 0 1 0 4 4"/></>,
  chevronRight: <path d="m9.5 6 6 6-6 6"/>,
  arrowDown: <><path d="M12 5v13"/><path d="m6 12.5 6 6 6-6"/></>,
};

export function Icon({ name, label = null, className = '' }) {
  const content = paths[name];
  if (!content) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} focusable="false">
      {label ? <title>{label}</title> : null}
      {content}
    </svg>
  );
}
