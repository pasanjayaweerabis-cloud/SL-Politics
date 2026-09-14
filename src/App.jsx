import React from 'react';
import { Layout } from './components/Chrome.jsx';
import { Notice } from './components/Primitives.jsx';
import { Toaster } from './components/Toast.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import { useRoute, useRouteTransition } from './lib/router.tsx';
import HomePage from './pages/HomePage.jsx';
import GovernmentPage from './pages/GovernmentPage.jsx';
import DirectoryPage from './pages/DirectoryPage.jsx';
import PersonPage, { PortfolioPersonPage } from './pages/PersonPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import CorrectionsPage from './pages/CorrectionsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import DecisionProfilePrototype from './pages/DecisionProfilePrototype.jsx';
import { HARSHA_DE_SILVA } from './data/harshaDeSilva.ts';

/**
 * Catches render errors so a malformed record shows a recoverable notice
 * instead of a blank page. Must be a class component — React has no hook
 * equivalent of getDerivedStateFromError.
 */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('SL Politics: unhandled render error', error, info); }

  render() {
    if (!this.state.error) return this.props.children;
    return <div className="section"><div className="container">
      <Notice
        tone="warning"
        iconName="alert"
        title="Something went wrong displaying this page"
        body={['An unexpected error occurred while rendering this page. Reloading, or returning to the homepage, usually resolves it.']}
      />
      <div className="u-mt-5"><a className="btn btn--primary" href="/">Return home</a></div>
    </div></div>;
  }
}

function Router({ route }) {
  switch (route.name) {
    case 'government':  return <GovernmentPage/>;
    case 'directory':   return <DirectoryPage route={route}/>;
    case 'person':      return <PersonPage slug={route.params.slug} route={route}/>;
    case 'about':       return <AboutPage/>;
    case 'corrections': return <CorrectionsPage route={route}/>;
    case 'decision-profile-prototype': return <DecisionProfilePrototype/>;
    // Retired standalone route — the profile itself now lives at the
    // canonical /person/harsha-de-silva. Renders the exact same component so
    // this address keeps resolving instead of 404ing; personMeta (applied via
    // PortfolioPersonPage) declares the canonical URL, not this one. See
    // routeManifest.ts's LEGACY_ROUTES and pageMeta.ts's routeMeta.
    case 'harsha-de-silva-profile': return <PortfolioPersonPage slug="harsha-de-silva" content={HARSHA_DE_SILVA}/>;
    case 'home':        return <HomePage/>;
    default:            return <NotFoundPage path={route.path}/>;
  }
}

export default function App({ ssrRoute }) {
  const route = useRoute(ssrRoute);
  useRouteTransition(route);
  return <I18nProvider>
    <Layout route={route}>
      {/* Keyed on the route so a page's local state cannot leak across a
          navigation, and so the error boundary resets when the user moves on. */}
      <ErrorBoundary key={`${route.name}:${JSON.stringify(route.params)}`}>
        <Router route={route}/>
      </ErrorBoundary>
    </Layout>
    {/* Mounted once, beside Layout rather than inside it, so it never sits
        under a transformed ancestor (the drawer panel, a route transition)
        that would clip or misplace a fixed-position toast. */}
    <Toaster/>
  </I18nProvider>;
}
