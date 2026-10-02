import { supabase } from '@/lib/supabase';

/**
 * DB-backed operational config values (public.app_config, migration 023) --
 * OTP timings, rate limits, grace-period length. Editable at /admin/settings
 * without a redeploy. Mirrors feature-flags.ts's isFeatureEnabled() exactly:
 * publicly readable (not secret), fails closed to the caller-supplied
 * fallback on any read error so a config outage degrades to the last-known-
 * good hardcoded default rather than breaking the OTP/deletion flows.
 */
export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  try {
    const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    const value = Number(data.value);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * String-valued config (WhatsApp display number, API version, …). Same
 * fail-closed-to-fallback contract as getConfigNumber.
 *
 * NOTE: app_config is PUBLICLY READABLE (anon SELECT, migration 023) — it is
 * for non-secret configuration only. Never move a token/key/secret here;
 * those stay in env vars.
 */
export async function getConfigString(key: string, fallback: string): Promise<string> {
  try {
    const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    // jsonb: a string value round-trips as a real JS string already.
    const value = typeof data.value === 'string' ? data.value : String(data.value ?? '');
    return value.trim() ? value : fallback;
  } catch {
    return fallback;
  }
}


/**
 * Coerces a raw `app_config.value` read.
 *
 * `value` is JSONB (migration 023), so supabase-js returns a real JS value —
 * `true`, not `"true"`; `29`, not `"29"`. Code that compares the result against
 * a string silently gets the wrong answer instead of failing, which is exactly
 * what happened with `gst_prices_include_tax`: `true === 'true'` is false, so
 * tax-inclusive pricing would have been treated as tax-exclusive and every
 * price quoted 18% high.
 *
 * Use these when reading app_config directly rather than through
 * getConfigString/getConfigNumber.
 */
export const cfgBool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? v === 'true' : fallback;

export const cfgString = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v !== '' ? v : v == null || v === '' ? fallback : String(v);

export const cfgNumber = (v: unknown, fallback: number): number => {
  // Number(null), Number(''), Number(false) and Number([]) are all 0, and 0 is
  // finite — so a naive isFinite check turns a MISSING value into zero rather
  // than into the fallback. For a pricing floor that means no floor at all,
  // which is the silent kind of failure worth spending three lines on.
  if (v == null || v === '' || typeof v === 'boolean') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
