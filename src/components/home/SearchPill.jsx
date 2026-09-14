import { Icon } from '../../lib/icons.jsx';
import { SearchTypeahead } from '../SearchTypeahead.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * The hero's single white search pill.
 *
 * It used to be a plain field whose only outcome was a full page navigation
 * to `/directory?q=…`: the primary action of the whole site, and it could
 * not tell you whether the person you were typing exists until the next
 * page loaded. This is now the site's real combobox (`SearchTypeahead` —
 * ranked people, "jump to" district/role links, recent profiles, a
 * did-you-mean on a miss, and the phone-width full-screen sheet), wearing
 * the hero build's pill instead of the site-wide `.search` look. Nothing
 * about the pill's appearance changes; the difference is that it answers.
 *
 * The suggestion panel is client-only by construction (it renders nothing
 * until the reader focuses the field), so the prerendered HTML a crawler
 * reads is unchanged: a real `<form role="search">` with a real input.
 */
export function SearchPill({ id, placeholder, label, onSubmit }) {
  const { t } = useI18n();
  return <SearchTypeahead
    id={id}
    placeholder={placeholder}
    label={label}
    onSubmit={onSubmit}
    rootClassName="home-hero__search-root"
    formClassName="home-hero__search"
    submitClassName="home-hero__search-submit"
    submitContent={<><span>{t('home.hero.searchButton')}</span><Icon name="arrowRight"/></>}
  />;
}
