import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { AuthFailure, passwordProblem, sendPasswordReset, signInWithGoogle, signInWithPassword, signUp, updatePassword, validEmail } from './authActions';
import { REGIONS, REGION_IDS, detectRegion, rememberedRegion, type RegionId } from './regions';
import './auth.css';

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';
type View = AuthMode | 'checkEmail' | 'resetSent' | 'passwordUpdated';

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>;
}

export function AuthDialog({ initialMode, initialMessage, signedInRegion, onClose }: { initialMode: AuthMode; initialMessage?: string; signedInRegion: RegionId | null; onClose: () => void }) {
  const id = useId();
  const [view, setView] = useState<View>(initialMode);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [region, setRegion] = useState<RegionId>(() => rememberedRegion() ?? detectRegion());
  const [busy, setBusy] = useState<'' | 'form' | 'google'>(''), [error, setError] = useState(initialMessage ?? ''), [notice, setNotice] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => { panel.current?.querySelector<HTMLInputElement>('input:not([type=hidden])')?.focus(); }, [view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function go(next: View) { setView(next); setError(''); setNotice(''); setPassword(''); }

  async function run(kind: 'form' | 'google', task: () => Promise<void>) {
    setBusy(kind); setError(''); setNotice('');
    try { await task(); }
    catch (reason) { setError(reason instanceof AuthFailure ? reason.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(''); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (view !== 'reset' && !validEmail(email)) { setError('Enter a valid email address.'); return; }
    if (view === 'signin') {
      if (!password) { setError('Enter your password.'); return; }
      void run('form', async () => { await signInWithPassword(email, password, region); onClose(); });
    } else if (view === 'signup') {
      const problem = passwordProblem(password); if (problem) { setError(problem); return; }
      void run('form', async () => {
        const result = await signUp(email, password, name, region);
        if (result.alreadyRegistered) { go('signin'); setNotice('You already have an account with this email. Sign in below.'); return; }
        if (result.needsConfirmation) go('checkEmail'); else onClose();
      });
    } else if (view === 'forgot') {
      void run('form', async () => { await sendPasswordReset(email); go('resetSent'); });
    } else if (view === 'reset') {
      const problem = passwordProblem(password); if (problem) { setError(problem); return; }
      if (!signedInRegion) { setError('This reset link has expired. Request a new one.'); return; }
      void run('form', async () => { await updatePassword(signedInRegion, password); go('passwordUpdated'); });
    }
  }

  const titles: Record<View, string> = {
    signin: 'Sign in to Folio', signup: 'Create your Folio account', forgot: 'Reset your password', reset: 'Choose a new password',
    checkEmail: 'Check your email', resetSent: 'Check your email', passwordUpdated: 'Password updated',
  };
  const showForm = view === 'signin' || view === 'signup' || view === 'forgot' || view === 'reset';
  const showGoogle = view === 'signin' || view === 'signup';

  return <div className="auth-overlay" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={panel} className="auth-panel" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <button type="button" className="auth-close" aria-label="Close" onClick={onClose} disabled={!!busy}><X size={18} /></button>
      <span className="auth-logo" aria-hidden="true">F</span>
      <h2 id={`${id}-title`}>{titles[view]}</h2>

      {view === 'checkEmail' && <><p className="auth-lead">We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your account.</p><p className="auth-hint">No email after a few minutes? Check spam, or <button type="button" className="auth-link" onClick={() => go('signup')}>try again</button>.</p><button type="button" className="auth-primary" onClick={onClose}>Done</button></>}
      {view === 'resetSent' && <><p className="auth-lead">If an account exists for <strong>{email}</strong>, a password reset link is on its way.</p><button type="button" className="auth-primary" onClick={() => go('signin')}>Back to sign in</button></>}
      {view === 'passwordUpdated' && <><p className="auth-lead">Your new password is saved and you’re signed in.</p><button type="button" className="auth-primary" onClick={onClose}>Continue</button></>}

      {showGoogle && <>
        <button type="button" className="auth-google" disabled={!!busy} onClick={() => void run('google', () => signInWithGoogle(region))}>
          {busy === 'google' ? <LoaderCircle className="spin" size={18} /> : <GoogleMark />}Continue with Google
        </button>
        <div className="auth-divider"><span>or use email</span></div>
      </>}

      {showForm && <form onSubmit={submit} noValidate>
        {view === 'signup' && <label className="auth-field"><span>Full name</span><input autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label>}
        {view !== 'reset' && <label className="auth-field"><span>Email</span><input type="email" autoComplete="email" inputMode="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>}
        {view !== 'forgot' && <label className="auth-field"><span>{view === 'reset' ? 'New password' : 'Password'}</span><input type="password" autoComplete={view === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} />{(view === 'signup' || view === 'reset') && <small>At least 8 characters, with letters and numbers.</small>}</label>}
        {view === 'signin' && <button type="button" className="auth-link auth-forgot" onClick={() => go('forgot')}>Forgot password?</button>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="auth-primary" disabled={!!busy}>{busy === 'form' && <LoaderCircle className="spin" size={16} />}{view === 'signin' ? 'Sign in' : view === 'signup' ? 'Create account' : view === 'forgot' ? 'Send reset link' : 'Save new password'}</button>
      </form>}

      {(view === 'signup' || view === 'signin') && <label className="auth-region"><span>{view === 'signup' ? 'Store my data in' : 'Account region'}</span>
        <select value={region} onChange={event => setRegion(event.target.value as RegionId)} disabled={!!busy}>{REGION_IDS.map(option => <option key={option} value={option}>{REGIONS[option].label}</option>)}</select>
        <small>{view === 'signup' ? 'Pick where you live for the fastest experience. Your data stays in this region.' : 'Email sign-in checks both regions automatically. For Google, choose the region you signed up in.'}</small>
      </label>}

      {view === 'signin' && <p className="auth-switch">New to Folio? <button type="button" className="auth-link" onClick={() => go('signup')}>Create an account</button></p>}
      {view === 'signup' && <p className="auth-switch">Already have an account? <button type="button" className="auth-link" onClick={() => go('signin')}>Sign in</button></p>}
      {view === 'forgot' && <p className="auth-switch"><button type="button" className="auth-link" onClick={() => go('signin')}>Back to sign in</button></p>}
      {showForm && view !== 'reset' && <p className="auth-fineprint">You can keep using Folio without an account. Signing in saves your work to your account.</p>}
    </div>
  </div>;
}
