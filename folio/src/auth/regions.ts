import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Folio keeps each user's data in one home region. Each region is a separate
 * Supabase project with the same schema (see supabase/migrations).
 * Publishable keys are safe in the browser; row-level security protects data.
 */
export type RegionId = 'in' | 'us';

export interface RegionConfig { id: RegionId; label: string; url: string; publishableKey: string }

const env = import.meta.env;
export const REGIONS: Record<RegionId, RegionConfig> = {
  in: {
    id: 'in', label: 'India',
    url: env.VITE_SUPABASE_IN_URL ?? 'https://asjgodeofdxtncyeband.supabase.co',
    publishableKey: env.VITE_SUPABASE_IN_KEY ?? 'sb_publishable__JJvvk3Jr8TrjlHDMS1iiA_vx92pCT8',
  },
  us: {
    id: 'us', label: 'United States',
    url: env.VITE_SUPABASE_US_URL ?? 'https://nocejvdlrazsvopyjrvo.supabase.co',
    publishableKey: env.VITE_SUPABASE_US_KEY ?? 'sb_publishable_HQUz99GOCVyu7pXijAsHjw_wkjOpnV7',
  },
};
export const REGION_IDS: RegionId[] = ['in', 'us'];
export const isRegionId = (value: unknown): value is RegionId => value === 'in' || value === 'us';

const clients = new Map<RegionId, SupabaseClient>();
/** One client per region, each with its own stored session. */
export function regionClient(region: RegionId): SupabaseClient {
  let client = clients.get(region);
  if (!client) {
    const { url, publishableKey } = REGIONS[region];
    client = createClient(url, publishableKey, {
      auth: {
        storageKey: `folio-auth-${region}`,
        persistSession: true,
        autoRefreshToken: true,
        // Only the region named in a returning link reads tokens from the URL.
        detectSessionInUrl: region === regionFromUrl(),
      },
    });
    clients.set(region, client);
  }
  return client;
}

/** Links Folio sends (Google return, email confirmation, password reset) carry ?auth_region=. */
export function regionFromUrl(): RegionId | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('auth_region');
  return isRegionId(value) ? value : null;
}

const REGION_KEY = 'folio.authRegion';
export function rememberedRegion(): RegionId | null {
  try { const value = window.localStorage.getItem(REGION_KEY); return isRegionId(value) ? value : null; } catch { return null; }
}
export function rememberRegion(region: RegionId) {
  try { window.localStorage.setItem(REGION_KEY, region); } catch { /* storage unavailable: region is asked again next time */ }
}

/** Best guess for a new visitor: India time zones and locales go to India, everyone else to the US. */
export function detectRegion(): RegionId {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta') return 'in';
  } catch { /* fall through */ }
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages ?? [];
  if (languages.some(language => /-IN$/i.test(language))) return 'in';
  return 'us';
}

/** Where auth emails and Google send the user back to. */
export function returnUrl(region: RegionId, flow?: 'recovery') {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('auth_region', region);
  if (flow) url.searchParams.set('auth_flow', flow);
  return url.toString();
}
