import React from 'react';
import { EmptyState } from '../components/Primitives.jsx';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';

const NEVER_CHANGES = () => () => {};

/**
 * False during prerendering and on the first client render, true afterwards.
 *
 * `useSyncExternalStore` takes a separate server snapshot, which is precisely
 * the distinction needed: content that only the browser can know must be absent
 * from the first render, or it will not match the prerendered markup.
 */
function useHydrated() {
  return React.useSyncExternalStore(NEVER_CHANGES, () => true, () => false);
}

/**
 * A real 404. Unknown paths resolve here rather than silently rendering the
 * homepage, which would present a broken link as though it were a valid page.
 * Marked noindex so search engines do not accumulate soft-404 entries.
 */
export default function NotFoundPage({ path }) {
  const { t } = useI18n();
  React.useEffect(() => { applyPageMeta(routeMeta('not-found')); }, []);

  /*
   * The address is filled in after mount, not during the first render.
   *
   * 404.html is prerendered once and served for every unknown URL, so the
   * static file cannot name the address the reader actually asked for. Echoing
   * `path` on the first render would therefore differ from the prerendered
   * markup and fail hydration for every 404. Showing it a tick later costs
   * nothing and keeps the detail that makes the page useful.
   */
  const shownPath = useHydrated() ? path ?? null : null;

  return <>
    <header className="page-head page-head--centered">
      <div className="container page-head__inner">
        <p className="eyebrow">{t('notFound.eyebrow')}</p>
        <h1>{t('notFound.title')}</h1>
        <p className="lede">{t('notFound.lede')}</p>
      </div>
    </header>

    <section className="section section--tight">
      <div className="container">
        <EmptyState
          iconName="slash"
          title={t('notFound.emptyTitle')}
          message={shownPath ? t('notFound.emptyMessageWithPath', { path: shownPath }) : t('notFound.emptyMessage')}
          action={<>
            <a className="btn btn--primary" href="/directory">{t('common.browseDirectory')}</a>
            <a className="btn btn--secondary" href="/">{t('common.returnHome')}</a>
          </>}
        />
      </div>
    </section>
  </>;
}
