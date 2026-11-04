import { useEffect, type ReactNode } from 'react';
import App from '../App';
import { useOptionalAuth } from '../auth/AuthProvider';
import { rememberedRegion } from '../auth/regions';
import { Landing } from './Landing';
import { LegalPage } from './LegalPage';
import { carriesAuthReturn, linkProps, navigate, useRoute } from './router';
import './site.css';

const TITLES = { landing: 'Folio — Tailor your resume to every job, in your own layout', app: 'Folio — Workspace', privacy: 'Privacy — Folio', terms: 'Terms — Folio', notFound: 'Page not found — Folio' };

export function Site() {
  const route = useRoute();
  const auth = useOptionalAuth();
  const signedIn = !!auth?.user;

  // Returning users, signed-in users and auth links go straight to the workspace.
  useEffect(() => {
    if (route !== 'landing') return;
    if (carriesAuthReturn(window.location)) navigate('app', { replace: true, keepQuery: true });
    else if (signedIn || rememberedRegion()) navigate('app', { replace: true });
  }, [route, signedIn]);

  useEffect(() => { document.title = TITLES[route]; }, [route]);

  if (route === 'app' || (route === 'landing' && carriesAuthReturn(window.location))) return <App />;
  if (route === 'privacy') return <LegalPage kind="privacy" />;
  if (route === 'terms') return <LegalPage kind="terms" />;
  if (route === 'notFound') return <NotFound />;
  return <Landing />;
}

export function SiteHeader({ children }: { children?: ReactNode }) {
  return <header className="site-header">
    <a className="site-brand" {...linkProps('landing')}><span className="site-logo" aria-hidden="true">F</span>Folio</a>
    <nav className="site-nav" aria-label="Main">{children}</nav>
  </header>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <span>© {new Date().getFullYear()} Folio</span>
    <nav aria-label="Legal"><a {...linkProps('privacy')}>Privacy</a><a {...linkProps('terms')}>Terms</a><a {...linkProps('app')}>Open Folio</a></nav>
  </footer>;
}

function NotFound() {
  return <div className="site">
    <SiteHeader />
    <main className="site-main site-narrow"><h1>Page not found</h1><p className="site-lead">That page doesn’t exist.</p>
      <p><a className="site-button" {...linkProps('landing')}>Go to the home page</a></p></main>
    <SiteFooter />
  </div>;
}
