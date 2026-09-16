import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { activeTheme, applyTheme } from '../lib/theme.js';
import { LANGUAGES, useI18n } from '../lib/i18n.jsx';
import { Drawer } from './Primitives.jsx';
import { Dropdown } from './Dropdown.jsx';

/**
 * Javora stays to one loop — Home, Current Government, Directory, a Person
 * profile — deliberately.
 *
 * Current Government earns a tab because it answers a different question from
 * the Directory: "who runs the country now" rather than "who is in the
 * record". Cabinet, ministries and parliamentary leadership all live INSIDE
 * it rather than becoming tabs of their own, and party, election and source
 * information still live in the directory filters and the profile page; see
 * the note above `legacyRedirect` in `lib/router.tsx`.
 *
 * The home hero build (see HOMEPAGE_BUILD_PROMPT.md) asked for one more nav
 * word — "Institutions" — that names no route this app has, and CLAUDE.md's
 * build-time rules forbid adding one ("do not change routes, the route
 * manifest"; Javora's one-loop nav above is a deliberate decision, not an
 * oversight). It gets the closest REAL destination already established
 * elsewhere rather than a dead link: source/institution information lives in
 * the Directory's filters — the same place the old standalone /sources route
 * was consolidated into, see `legacyRedirect`. It does not participate in the
 * active-page underline: it aliases an existing page rather than naming a
 * distinct one, so marking it "current" would be true only by coincidence of
 * sharing a target with a different, real tab.
 *
 * "About" DOES name a real route (`/about` — see routeManifest.ts and
 * AboutPage.jsx), so unlike "Institutions" it takes part in the active-page
 * underline like any other tab.
 */
const NAV_ITEMS = [
  { href: '/',           key: 'nav.home',       match: 'home' },
  { href: '/government', key: 'nav.government', match: 'government' },
  { href: '/directory',  key: 'nav.directory',  match: 'directory' },
  { href: '/about',      key: 'nav.about',      match: 'about' },
];

/**
 * The footer, grouped rather than in one undifferentiated row.
 *
 * Two groups, not the six a sitemap-footer would have: every destination
 * here is a route this app actually serves (see lib/routeManifest.ts), and
 * there are only five of them. The split is by the reader's question —
 * "show me the records" versus "why should I believe them" — which is the
 * same division the site's own trust story runs on, so the footer states
 * the second half rather than leaving corrections and methodology as two
 * more words in a line of five.
 *
 * `/about#methodology` is a real anchor on the About page (see
 * AboutPage.jsx's `id="methodology"` section), not an invented URL.
 */
const FOOTER_GROUPS = [
  {
    titleKey: 'footer.exploreHeading',
    links: [
      { href: '/', key: 'nav.home' },
      { href: '/government', key: 'nav.government' },
      { href: '/directory', key: 'nav.directory' },
    ],
  },
  {
    titleKey: 'footer.trustHeading',
    links: [
      { href: '/about', key: 'nav.howItWorks' },
      { href: '/corrections', key: 'common.reportError' },
    ],
  },
];

/**
 * `highlight`, when it names a substring actually present in `name`, wraps
 * just that word in `.brand__name-shine` (the sweeping-light animation in
 * layout.css) instead of the whole lockup — the header's plain "SL Politics"
 * never opts in, only the footer's "SL Politics By Javora" call below does.
 */
export function BrandLockup({ href='/', markSize=34, name='SL Politics', highlight }) {
  const splitAt = highlight ? name.indexOf(highlight) : -1;
  return <a className="brand u-plain" href={href} aria-label="SL Politics — home">
    <img className="brand__mark brand__mark--light" src="/lion-logo-light-128.png" alt="" width={markSize} height={markSize} decoding="async"/>
    <img className="brand__mark brand__mark--dark" src="/lion-logo-dark-128.png" alt="" width={markSize} height={markSize} decoding="async"/>
    <span className="brand__name">
      {splitAt >= 0 ? <>
        {name.slice(0, splitAt)}
        <span className="brand__name-shine">{highlight}</span>
        {name.slice(splitAt + highlight.length)}
      </> : name}
    </span>
  </a>;
}

function ThemeToggle() {
  /*
   * Starts false unconditionally, even in the browser, where the real theme is
   * knowable.
   *
   * Hydration compares the client's FIRST render against the prerendered HTML
   * and throws the markup away if they differ. Reading the actual theme here
   * would produce exactly that mismatch for every reader whose theme is dark,
   * since a build cannot know a future reader's preference. The effect below
   * corrects it on mount, before paint — and the visible theme never depended
   * on this state anyway, only <html data-theme> does.
   */
  const { t } = useI18n();
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const listener = () => setDark(activeTheme() === 'dark');
    listener();
    window.addEventListener('javora:themechange', listener);
    return () => window.removeEventListener('javora:themechange', listener);
  }, []);
  const switchTimer = React.useRef(null);
  React.useEffect(() => () => window.clearTimeout(switchTimer.current), []);
  const next = dark ? 'light' : 'dark';
  const label = dark ? t('nav.switchToLight') : t('nav.switchToDark');
  const handleClick = () => {
    // `.theme-switching` turns on the colour/shadow transition in base.css for
    // just this flip, then turns it back off — see the comment there for why
    // it isn't left on permanently.
    document.documentElement.classList.add('theme-switching');
    document.body.classList.add('theme-switching');
    window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => {
      document.documentElement.classList.remove('theme-switching');
      document.body.classList.remove('theme-switching');
    }, 260);
    applyTheme(next);
    setDark(next === 'dark');
  };
  return <button type="button" className="icon-btn theme-toggle" aria-label={label} title={label} aria-pressed={dark} onClick={handleClick}>
    <span className="icon-moon"><Icon name="moon"/></span>
    <span className="icon-sun"><Icon name="sun"/></span>
  </button>;
}

/**
 * Switches the interface CHROME between English, Sinhala and Tamil — see the
 * note at the top of lib/i18n.jsx for what this does and, just as
 * importantly, does not translate.
 *
 * Was a native `<select>` until this component replaced it: its open popup
 * is drawn by the OS and, on Windows, ignores CSS on `<option>` entirely —
 * confirmed by inspecting the popup, where the computed styles were correct
 * but the paint wasn't. `Dropdown` reproduces the native control's
 * accessibility contract (only the trigger is focusable, no focus trap
 * needed) without the unstylable native popup.
 */
function LanguageSwitcher({ compact = false }) {
  const { lang, setLang, t } = useI18n();
  const uid = React.useId();
  const current = LANGUAGES.find(l => l.code === lang);
  return <Dropdown
    id={`lang-switch-${uid}`}
    value={lang}
    options={LANGUAGES.map(l => ({ value: l.code, label: l.nativeLabel }))}
    onChange={setLang}
    label={t('nav.chooseLanguage')}
    triggerClassName={compact ? 'lang-switch lang-switch--compact' : 'lang-switch'}
    panelClassName="lang-switch__panel"
    renderTrigger={() => <>
      <Icon name="globe" className="lang-switch__icon"/>
      {/* Keyed by `lang` so a language switch remounts these spans — the
          crossfade is `@starting-style`'s entrance for the fresh element,
          not a transition on the text itself. Hydration never remounts
          them: the server and first client render share the same key. */}
      <span key={`full-${lang}`} className="lang-switch__label lang-switch__label--full">{current?.nativeLabel}</span>
      <span key={`short-${lang}`} className="lang-switch__label lang-switch__label--short">{current?.shortLabel}</span>
    </>}
  />;
}

/*
 * Tracks whether the fixed home header is still floating over the wallpaper
 * photo (`.home-hero`) or has been scrolled past it. Chrome and HomeHero sit
 * in different branches of the tree (Chrome renders outside `<main>`, see
 * `Layout` below), so there is no ref to share — an IntersectionObserver
 * against the hero section by selector is the only link between them.
 *
 * Starts `true` unconditionally, matching every reader's actual starting
 * scroll position (top of page, hero fully in view) rather than reading
 * anything from the DOM up front — same hydration-safe shape as
 * `ThemeToggle` above: the value is correct on first paint for the case that
 * matters (a fresh load) and the observer only has to correct it for scroll
 * restoration, after mount.
 *
 * Read through `useSyncExternalStore` rather than `useState` + an effect: the
 * hero's position is external DOM state, and the missing-hero fallback used
 * to call setState synchronously in the effect body
 * (react-hooks/set-state-in-effect). `subscribe` runs after mount, exactly
 * where that effect did, and notifies React from there, so the same
 * `true` -> corrected-after-mount sequence holds.
 * The server snapshot is `true`, so prerendered HTML and hydration agree.
 */
function useOverHero(active) {
  const store = React.useMemo(() => createOverHeroStore(active), [active]);
  const overHero = React.useSyncExternalStore(store.subscribe, store.getSnapshot, getOverHeroServerSnapshot);
  return active && overHero;
}

const getOverHeroServerSnapshot = () => true;

/** One store per `active` value; `useOverHero` above is its only reader. */
function createOverHeroStore(active) {
  let overHero = true;
  return {
    subscribe(onChange) {
      if (!active) return () => {};
      const hero = document.querySelector('.home-hero');
      if (!hero) {
        overHero = false;
        onChange();
        return () => {};
      }
      // Flips once the hero's bottom edge scrolls above the fixed bar itself
      // (16px top offset + its own height), not merely when the hero leaves
      // the viewport entirely — matching "passes the wallpaper section", not
      // "scrolls the whole page".
      const observer = new IntersectionObserver(
        ([entry]) => {
          overHero = entry.isIntersecting;
          onChange();
        },
        { rootMargin: '-108px 0px 0px 0px', threshold: 0 }
      );
      observer.observe(hero);
      return () => observer.disconnect();
    },
    getSnapshot: () => overHero,
  };
}

export function Chrome({ route }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Close the drawer whenever the route changes, so a link inside it does not
  // leave the overlay covering the page it just navigated to. Adjusted during
  // render rather than in an effect: an effect would leave the drawer visible
  // over the new page for a frame before closing it.
  const routeKey = `${route?.name}:${JSON.stringify(route?.params ?? {})}`;
  const [lastRouteKey, setLastRouteKey] = React.useState(routeKey);
  if (routeKey !== lastRouteKey) {
    setLastRouteKey(routeKey);
    setMenuOpen(false);
  }

  const isActive = item => {
    const matches = Array.isArray(item.match) ? item.match : [item.match];
    return matches.includes(route?.name);
  };

  /*
   * Overlay mode is Home-only: there the hero photo starts at the true top
   * of the viewport and this bar floats over it with `position: fixed` (see
   * `.nav--overlay` in layout.css), so the hero never has to reserve empty
   * space under a bar that isn't in flow there. Every OTHER route keeps the
   * exact sticky-in-flow behaviour this bar always had — restyled, but
   * occupying the same row above `<main>` it always did — so no other
   * page's layout shifts as a side effect of this build.
   */
  const overlay = route?.name === 'home';
  const overHero = useOverHero(overlay);

  const navClassName = overlay
    ? `nav nav--overlay${overHero ? ' nav--hero' : ''}`
    : 'nav';

  return <>
    <a href="#main" className="skip-link">{t('nav.skipToContent')}</a>
    <nav className={navClassName} aria-label="Primary navigation">
      <div className="nav__inner">
        <a className="nav__logo u-plain" href="/" aria-label="SL Politics — home">
          <img className="nav__logo-img nav__logo-img--light" src="/lion-logo-light-128.png" alt="" width={28} height={28} decoding="async"/>
          <img className="nav__logo-img nav__logo-img--dark" src="/lion-logo-dark-128.png" alt="" width={28} height={28} decoding="async"/>
          <span className="nav__logo-name">SL Politics</span>
        </a>
        <span className="nav__hairline" aria-hidden="true"></span>
        <p className="nav__tagline">{t('nav.tagline')}</p>
        <div className="nav__links">
          {NAV_ITEMS.map(item => (
            <a key={item.key} className="nav__link" href={item.href} aria-current={isActive(item) ? 'page' : undefined}>{t(item.key)}</a>
          ))}
        </div>
        <div className="nav__actions">
          <LanguageSwitcher/>
          {/* Home already leads with its own big search field one section down
              (see HomeHero.jsx) — a second search entry point directly above
              it, going to a different experience (`/directory#search`), was
              redundant there. Every other route still gets it: `route?.name`
              is known identically on the server (prerender of `/`) and the
              client's first render, so this never causes a hydration
              mismatch, and the mobile drawer's search link is unaffected. */}
          {route?.name !== 'home'
            ? <a className="icon-btn" href="/directory#search" aria-label={t('nav.searchRecords')} title={t('nav.searchRecords')}><Icon name="search"/></a>
            : null}
          <ThemeToggle/>
          <button className="icon-btn nav__burger" type="button" aria-label={t('nav.openMenu')} aria-expanded={menuOpen} aria-controls="javora-drawer" onClick={() => setMenuOpen(true)}><Icon name="menu"/></button>
        </div>
      </div>
    </nav>

    <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} id="javora-drawer" label={t('nav.menu')}>
      <div className="drawer__head">
        <BrandLockup markSize={30}/>
        <button type="button" className="icon-btn" aria-label={t('nav.closeMenu')} onClick={() => setMenuOpen(false)}><Icon name="close"/></button>
      </div>
      <div className="drawer__body">
        {NAV_ITEMS.map(item => (
          <a key={item.href} href={item.href} className="drawer__link" aria-current={isActive(item) ? 'page' : undefined}>{t(item.key)}</a>
        ))}
        <div className="drawer__section">
          <a href="/directory#search" className="drawer__link">{t('nav.searchRecords')}</a>
          <a href="/about" className="drawer__link">{t('nav.howItWorks')}</a>
          <a href="/corrections" className="drawer__link">{t('common.reportError')}</a>
        </div>
        <div className="drawer__section">
          <LanguageSwitcher compact/>
        </div>
      </div>
    </Drawer>
  </>;
}

export function Footer() {
  const { t } = useI18n();
  // Same `useMemo(() => new Date(), [])` idiom `HomePage`/`AboutPage` already
  // use for `today`: computed once per render pass, identically on the
  // server and the client's first render, so this carries no new hydration
  // risk despite calling `new Date()`.
  const year = React.useMemo(() => new Date().getFullYear(), []);
  return <footer className="footer"><div className="container footer__inner">
    <div className="footer__brand">
      <BrandLockup markSize={30} name={t('footer.brandName')} highlight="Javora"/>
      <p className="footer__tagline">{t('footer.tagline')}</p>
    </div>
    <nav className="footer__nav" aria-label="Footer">
      {FOOTER_GROUPS.map(group => (
        <div className="footer__group" key={group.titleKey}>
          <h2 className="footer__group-title">{t(group.titleKey)}</h2>
          <ul className="footer__links">
            {group.links.map(link => <li key={link.href}><a href={link.href}>{t(link.key)}</a></li>)}
          </ul>
        </div>
      ))}
    </nav>
    <p className="footer__copyright">{t('footer.copyright', { year })}</p>
  </div></footer>;
}

export function Layout({ route, children }) {
  return <>
    <Chrome route={route}/>
    <main id="main">{children}</main>
    <Footer/>
  </>;
}
