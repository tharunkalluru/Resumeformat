import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AuthDialog, type AuthMode } from './AuthDialog';
import { signOut as signOutRegion } from './authActions';
import { REGION_IDS, regionClient, regionFromUrl, rememberRegion, rememberedRegion, type RegionId } from './regions';

export interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  region: RegionId | null;
  openAuth: (mode?: AuthMode) => void;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
/** For components rendered both with and without the provider (tests, isolated views). */
export function useOptionalAuth(): AuthContextValue | null { return useContext(AuthContext); }

function readUrlError(): string {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  const description = params.get('error_description');
  return description ? description.replace(/\+/g, ' ') : '';
}
function cleanAuthParams() {
  const url = new URL(window.location.href);
  const had = url.searchParams.has('auth_region') || url.searchParams.has('auth_flow') || /access_token|error_description/.test(url.hash);
  url.searchParams.delete('auth_region'); url.searchParams.delete('auth_flow');
  if (/access_token|error_description|refresh_token/.test(url.hash)) url.hash = '';
  if (had) window.history.replaceState(window.history.state, '', url.toString());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ session: Session; region: RegionId } | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [dialog, setDialog] = useState<{ mode: AuthMode; message?: string } | null>(null);

  useEffect(() => {
    let active = true;
    const urlRegion = regionFromUrl();
    const recoveryLink = new URLSearchParams(window.location.search).get('auth_flow') === 'recovery';
    const urlError = readUrlError();
    const subscriptions = REGION_IDS.map(region => regionClient(region).auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (next) { setSession({ session: next, region }); setStatus('signedIn'); rememberRegion(region); }
      else setSession(current => { if (current?.region === region) { setStatus('signedOut'); return null; } return current; });
      if (event === 'PASSWORD_RECOVERY') setDialog({ mode: 'reset' });
    }));
    (async () => {
      // The region named in a returning link goes first, then the remembered one.
      const order = [urlRegion, rememberedRegion(), ...REGION_IDS].filter((region, index, all): region is RegionId => !!region && all.indexOf(region) === index);
      for (const region of order) {
        const { data } = await regionClient(region).auth.getSession();
        if (!active) return;
        if (data.session) {
          setSession({ session: data.session, region }); setStatus('signedIn'); rememberRegion(region);
          if (recoveryLink && region === urlRegion) setDialog({ mode: 'reset' });
          cleanAuthParams(); return;
        }
      }
      setStatus('signedOut');
      if (urlError) setDialog({ mode: 'signin', message: urlError });
      cleanAuthParams();
    })();
    return () => { active = false; subscriptions.forEach(({ data }) => data.subscription.unsubscribe()); };
  }, []);

  const openAuth = useCallback((mode: AuthMode = 'signin') => setDialog({ mode }), []);
  const signOut = useCallback(async () => {
    if (!session) return;
    await signOutRegion(session.region);
    setSession(null); setStatus('signedOut');
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    status, user: session?.session.user ?? null, region: session?.region ?? null, openAuth, signOut,
  }), [status, session, openAuth, signOut]);

  return <AuthContext.Provider value={value}>
    {children}
    {dialog && <AuthDialog initialMode={dialog.mode} initialMessage={dialog.message} signedInRegion={session?.region ?? null}
      onClose={() => setDialog(null)} />}
  </AuthContext.Provider>;
}
