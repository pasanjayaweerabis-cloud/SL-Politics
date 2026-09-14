import './home-hero.css';
import { Icon } from '../../lib/icons.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.tsx';
import { SearchPill } from './SearchPill.jsx';
import { datasetStats } from '../../services/repository.ts';

/**
 * The four offices a reader most often arrives looking for, as real links
 * into a pre-filtered directory.
 *
 * Every `href` is a facet the directory genuinely supports — the `role`
 * parameter and these four ids come straight from `RoleType`
 * (src/types/models.ts) via DirectoryPage's PARAM map — so each one lands on
 * a real, populated result set rather than an empty page. They are plain
 * anchors, present in the prerendered HTML, which is also what makes them
 * crawlable entry points into the register.
 */
const POPULAR_SEARCHES = [
  { key: 'home.hero.pillPresident', href: '/directory?role=president' },
  { key: 'home.hero.pillPrimeMinister', href: '/directory?role=prime-minister' },
  { key: 'home.hero.pillMinisters', href: '/directory?role=cabinet-minister' },
  { key: 'home.hero.pillParliament', href: '/directory?role=member-of-parliament' },
];

/**
 * The home hero: full-viewport Sigiriya photo and search. Everything here must
 * render in the static HTML (see CLAUDE.md's prerender/crawlability invariants)
 * — no client-only gating, every link a real `<a href>`.
 */
export function HomeHero() {
  const { t } = useI18n();
  const stats = datasetStats(new Date());

  const go = query => navigate(query ? `/directory?q=${encodeURIComponent(query)}` : '/directory');

  return <section className="home-hero" aria-labelledby="home-hero-heading">
    <div className="home-hero__media">
      {/* AVIF deliberately omitted: `sips`'s AVIF encoder (the only AVIF path
          available in this environment) produced a file that decodes fine
          but renders visibly washed out in the browser, silently, with no
          console error — confirmed by swapping the <img> to each candidate
          source directly and comparing. WebP (via cwebp) renders correctly
          and already cuts the ~2.2MB PNG to ~161KB on its own. */}
      <picture>
        <source srcSet="/wallpaper1.webp" type="image/webp"/>
        <img src="/wallpaper1.png" alt="" width="1748" height="899" fetchPriority="high" loading="eager" decoding="async"/>
      </picture>
    </div>
    <div className="home-hero__veil" aria-hidden="true"></div>

    <div className="home-hero__content">
      <p className="home-hero__eyebrow">
        <span className="home-hero__rule home-hero__rule--short" aria-hidden="true"></span>
        <span>{t('home.hero.eyebrow')}</span>
        <span className="home-hero__rule home-hero__rule--long" aria-hidden="true"></span>
      </p>

      <h1 id="home-hero-heading" className="home-hero__title">
        {t('home.hero.titleLine1')}<br aria-hidden="true"/>
        {t('home.hero.titleBeforeAccent')}<span className="home-hero__title-accent">{t('home.hero.titleAccent')}</span>{t('home.hero.titleAfterAccent')}
      </h1>

      <p className="home-hero__sub">{t('home.hero.sub')}</p>

      <SearchPill
        id="home-hero-search-input"
        placeholder={t('home.hero.searchPlaceholder')}
        label={t('home.hero.searchLabel')}
        onSubmit={go}
      />

      {/* What can I search for, in four real examples rather than a
          sentence describing the scope. */}
      <nav className="home-hero__popular" aria-label={t('home.hero.popularLabel')}>
        <span className="home-hero__popular-label" aria-hidden="true">{t('home.hero.popularLabel')}</span>
        {POPULAR_SEARCHES.map(item => (
          <a className="home-hero__pill" key={item.href} href={item.href}>{t(item.key)}</a>
        ))}
      </nav>

      <div className="home-hero__bottom">
        {/*
          Was a button reading "Scroll to explore" — a sentence about the
          browser, not about the register, whose only effect was to move the
          page down by one viewport. This is a real link to the real
          destination, and it says how much is behind it. The hero no longer
          fills the viewport exactly (see `min-height` in home-hero.css), so
          the next section shows at the fold and does the job the scroll
          affordance was doing.
        */}
        <a className="home-hero__cta" href="/directory">
          <span className="home-hero__scroll-circle" aria-hidden="true"><Icon name="arrowRight"/></span>
          <span>{t('home.hero.exploreCta', { count: stats.people.toLocaleString('en-US') })}</span>
        </a>
        <p className="home-hero__bottom-tagline">
          <span className="home-hero__bottom-rule" aria-hidden="true"></span>
          <span>{t('home.hero.bottomTagline')}</span>
        </p>
      </div>
    </div>
  </section>;
}
