import { useEffect, useState } from 'react';

/** Folio's public routes. Everything else is the workspace at /app. */
export type Route = 'landing' | 'app' | 'privacy' | 'terms' | 'notFound';

const paths: Record<Exclude<Route, 'notFound'>, string> = { landing: '/', app: '/app', privacy: '/privacy', terms: '/terms' };

export function routeOf(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'landing';
  if (path === '/app' || path.startsWith('/app/')) return 'app';
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  return 'notFound';
}

/** Auth links (Google return, email confirmation, password reset) must land in the workspace. */
export function carriesAuthReturn(location: Pick<Location, 'search' | 'hash'>) {
  return /[?&]auth_region=/.test(location.search) || /access_token=|error_description=/.test(location.hash);
}

export function navigate(route: Exclude<Route, 'notFound'>, options: { replace?: boolean; keepQuery?: boolean } = {}) {
  const url = paths[route] + (options.keepQuery ? window.location.search + window.location.hash : '');
  if (options.replace) window.history.replaceState(null, '', url); else window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo?.(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(routeOf(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return route;
}

/** In-site link that avoids a full page load. */
export function linkProps(route: Exclude<Route, 'notFound'>) {
  return {
    href: paths[route],
    onClick: (event: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }) => {
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault(); navigate(route);
    },
  };
}
