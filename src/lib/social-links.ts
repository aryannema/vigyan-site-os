import { supabase } from '@/lib/supabase';

export interface SocialLink {
  platform: string;
  url: string;
  enabled: boolean;
}

/**
 * Footer social links (public.social_links, migration 025) -- URL +
 * enable/disable per platform, editable at /admin/settings without a
 * redeploy. Mirrors feature-flags.ts's isFeatureEnabled(): publicly
 * readable, fails closed to an empty list on any error (showing no social
 * icons is a safe degraded state, a broken/stale hardcoded link is not).
 */
export async function getSocialLinks(): Promise<SocialLink[]> {
  try {
    const { data, error } = await supabase.from('social_links').select('platform, url, enabled');
    if (error || !data) return [];
    return data as SocialLink[];
  } catch {
    return [];
  }
}
