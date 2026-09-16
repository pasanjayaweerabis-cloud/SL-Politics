import './home-hero.css';
import { Icon } from '../../lib/icons.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.tsx';
import { SearchPill } from './SearchPill.jsx';

/**
 * "Try:" chips: two people, two categories.
 *
 * The people chips name whoever currently holds the office, not an editorial
 * pick — `gov.president`/`gov.primeMinister` come from `currentGovernment()`,
 * the same derivation the Current Government section itself uses, so this
 * updates on its own after an election with no code change. When an office is
 * vacant (`null`), the slot falls back to the old role-search pill rather than
 * rendering nothing.
 *
 * The two category chips are directory facets, not people, on purpose:
 * featuring a party here would be an editorial act this platform doesn't take
 * (see CLAUDE.md). Every `href` is a facet DirectoryPage's PARAM map actually
 * supports, so each chip lands on a real, populated result set.
 */
function personOrRoleChip(t, member, roleKey, roleHref) {
  if (!member) return { key: roleHref, href: roleHref, label: t(roleKey) };
  return {
    key: member.personId,
    href: `/person/${encodeURIComponent(member.slug)}`,
    label: t('home.hero.personChip', { name: member.name, role: t(roleKey) }),
  };
}

/**
 * The home hero: full-viewport Sigiriya photo and search. Everything here must
 * render in the static HTML (see CLAUDE.md's prerender/crawlability invariants)
 * — no client-only gating, every link a real `<a href>`.
 *
 * `government` and `peopleCount` are computed once in HomePage, with the same
 * `today`/memo it uses for the Current Government section and the trust
 * figures — not recomputed here — so a prerendered page and its first client
 * render can never read two different `new Date()` calls and disagree.
 * `scrollTargetId` is likewise HomePage's own decision about which section
 * actually rendered below, so the hero never links to an id that isn't there.
 */
export function HomeHero({ government, peopleCount, scrollTargetId }) {
  const { t } = useI18n();

  const go = query => navigate(query ? `/directory?q=${encodeURIComponent(query)}` : '/directory');

  const chips = [
    personOrRoleChip(t, government.president, 'home.hero.pillPresident', '/directory?role=president'),
    personOrRoleChip(t, government.primeMinister, 'home.hero.pillPrimeMinister', '/directory?role=prime-minister'),
    { key: 'cabinet-ministers', href: '/directory?role=cabinet-minister', label: t('home.hero.pillMinisters') },
    { key: 'members-of-parliament', href: '/directory?role=member-of-parliament', label: t('home.hero.pillParliament') },
  ];

  const scrollingToGovernment = scrollTargetId === 'current-government';

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
        {t('home.hero.titleBeforeAccent')}<span className="home-hero__title-accent">{t('home.hero.titleAccent')}</span>{t('home.hero.titleAfterAccent')}
      </h1>

      <p className="home-hero__sub">{t('home.hero.sub', { count: peopleCount })}</p>

      <SearchPill
        id="home-hero-search-input"
        placeholder={t('home.hero.searchPlaceholder')}
        label={t('home.hero.searchLabel')}
        onSubmit={go}
      />

      {/* Two people (whoever holds the office today) plus two directory
          categories, rather than a "Popular searches" claim this site has no
          analytics to back. */}
      <nav className="home-hero__popular" aria-label={t('home.hero.popularAriaLabel')}>
        <span className="home-hero__popular-label" aria-hidden="true">{t('home.hero.popularLabel')}</span>
        {chips.map(chip => (
          <a className="home-hero__pill" key={chip.key} href={chip.href}>{chip.label}</a>
        ))}
      </nav>

      <div className="home-hero__bottom">
        <a className="home-hero__scroll-cue" href={`#${scrollTargetId}`}>
          <span className="home-hero__bottom-rule" aria-hidden="true"></span>
          <span>{t(scrollingToGovernment ? 'home.hero.scrollCue' : 'home.hero.scrollCueFallback')}</span>
          <Icon name="arrowDown"/>
        </a>
      </div>
    </div>
  </section>;
}
