import { supabase } from '@/lib/supabase';

/**
 * Public site-wide feature flags (public.feature_flags, migration 020).
 * Readable by anon/public RLS -- safe to call from any Server Component,
 * no session required. Fails closed (returns `false`) on any error, since
 * every current flag (starting with whatsapp_live) gates a live, possibly
 * broken/banned external integration -- showing it by default on a read
 * failure would be the wrong failure mode.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return false;
    return Boolean(data.enabled);
  } catch {
    return false;
  }
}

/**
 * Like isFeatureEnabled, but with an explicit answer for a flag that has no
 * row yet (or cannot be read) -- for flags whose safe default is "on".
 */
export async function getFlag(key: string, fallback: boolean): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('feature_flags').select('enabled').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    return Boolean(data.enabled);
  } catch {
    return fallback;
  }
}

/** Whether the onboarding gate (email + profile) applies to this user. */
export async function profileGateApplies(isStaff: boolean): Promise<boolean> {
  return isStaff ? getFlag('profile_gate_staff', false) : getFlag('profile_gate_customers', true);
}
