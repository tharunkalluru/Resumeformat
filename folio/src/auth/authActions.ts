import type { AuthError, User } from '@supabase/supabase-js';
import { REGION_IDS, regionClient, rememberRegion, returnUrl, type RegionId } from './regions';

export class AuthFailure extends Error {}

/** Plain-language messages for the errors people actually hit. */
export function friendlyAuthError(error: AuthError | Error | null | undefined): string {
  const message = error?.message ?? '';
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account. Check them, or reset your password.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first. We sent a link to your inbox.';
  if (/user already registered/i.test(message)) return 'An account with this email already exists. Sign in instead.';
  if (/password should be at least|weak password/i.test(message)) return 'Choose a stronger password: at least 8 characters, mixing letters and numbers.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute, then try again.';
  if (/fetch|network/i.test(message)) return 'Can’t reach Folio’s servers. Check your connection and try again.';
  return message || 'Something went wrong. Please try again.';
}

export const MIN_PASSWORD = 8;
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return 'Mix letters and numbers.';
  return null;
}
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/**
 * Sign in with email and password. Each region has its own accounts, so try the
 * likely region first and the other one if the credentials are not found there.
 */
export async function signInWithPassword(email: string, password: string, preferred: RegionId): Promise<{ user: User; region: RegionId }> {
  const order: RegionId[] = [preferred, ...REGION_IDS.filter(region => region !== preferred)];
  let lastError: AuthError | null = null;
  for (const region of order) {
    const { data, error } = await regionClient(region).auth.signInWithPassword({ email: email.trim(), password });
    if (!error && data.user) { rememberRegion(region); return { user: data.user, region }; }
    lastError = error;
    // Only "not found here" is worth retrying in the other region.
    if (error && !/invalid login credentials/i.test(error.message)) break;
  }
  throw new AuthFailure(friendlyAuthError(lastError));
}

export async function signUp(email: string, password: string, fullName: string, region: RegionId): Promise<{ needsConfirmation: boolean; alreadyRegistered: boolean }> {
  const { data, error } = await regionClient(region).auth.signUp({
    email: email.trim(), password,
    options: { emailRedirectTo: returnUrl(region), data: { full_name: fullName.trim() } },
  });
  if (error) throw new AuthFailure(friendlyAuthError(error));
  rememberRegion(region);
  // With email confirmation on, an existing address returns a user with no identities.
  const alreadyRegistered = !!data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
  return { needsConfirmation: !data.session, alreadyRegistered };
}

export async function signInWithGoogle(region: RegionId): Promise<void> {
  rememberRegion(region);
  const { error } = await regionClient(region).auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: returnUrl(region), queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new AuthFailure(friendlyAuthError(error));
}

/** The account may live in either region; each region only emails addresses it knows. */
export async function sendPasswordReset(email: string): Promise<void> {
  const results = await Promise.all(REGION_IDS.map(region =>
    regionClient(region).auth.resetPasswordForEmail(email.trim(), { redirectTo: returnUrl(region, 'recovery') })));
  const failures = results.filter(result => result.error);
  if (failures.length === results.length) throw new AuthFailure(friendlyAuthError(failures[0].error));
}

export async function updatePassword(region: RegionId, password: string): Promise<void> {
  const { error } = await regionClient(region).auth.updateUser({ password });
  if (error) throw new AuthFailure(friendlyAuthError(error));
}

export async function signOut(region: RegionId): Promise<void> {
  await regionClient(region).auth.signOut();
}
