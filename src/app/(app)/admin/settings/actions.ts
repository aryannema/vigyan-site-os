'use server';

/**
 * Feature flags write path (public.feature_flags, migration 020). Same
 * mutate()/perform_action() audit pattern as every other admin write --
 * see ../products/actions.ts for the canonical example this mirrors.
 *
 * REVALIDATION IS NOW REQUIRED. This block used to say it was not, because
 * every page reading a flag sat under `dynamic = 'force-dynamic'`. That is no
 * longer true: (marketing)/layout.tsx is `revalidate = 300`, because
 * force-dynamic sent `no-store` to Googlebot on all 16 public URLs and Search
 * Console stopped crawling the site.
 *
 * So the instant-toggle property that force-dynamic provided for free is now
 * bought explicitly, with one call. A flag flip that does not invalidate the
 * tree would leave the WhatsApp FAB on screen for up to five minutes after
 * being switched off -- which, given the WABA ban, is exactly the case this
 * flag exists to handle quickly.
 */

import { mutate } from '../lib/db';
import { revalidateFor } from '@/lib/content-revalidation';

const CREATABLE_FLAGS = ['profile_gate_customers', 'profile_gate_staff', 'whatsapp_otp_template_live'] as const;

export async function setFeatureFlag(key: string, enabled: boolean): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ key: string; enabled: boolean }>(
        `SELECT key, enabled FROM public.feature_flags WHERE key = $1`,
        [key],
      );
      // Known flags may be created on first toggle (their seed row may not be
      // applied yet); any other key must already exist.
      const updated = (CREATABLE_FLAGS as readonly string[]).includes(key)
        ? await client.query<{ key: string; enabled: boolean }>(
            `INSERT INTO public.feature_flags (key, enabled, updated_at, updated_by)
                  VALUES ($1, $2, now(), auth.uid())
             ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = auth.uid()
             RETURNING key, enabled`,
            [key, enabled],
          )
        : await client.query<{ key: string; enabled: boolean }>(
            `UPDATE public.feature_flags SET enabled = $2, updated_at = now(), updated_by = auth.uid()
             WHERE key = $1
             RETURNING key, enabled`,
            [key, enabled],
          );
      if (updated.rows.length === 0) throw new Error(`Unknown feature flag: ${key}`);
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: key,
          before: before.rows[0] ?? null,
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update — please try again.' };
  }

  // Only after the write succeeded. Invalidating on a failed toggle would
  // discard a good cache to re-render the identical page.
  revalidateFor({ kind: 'feature_flag' });

  return {};
}

/**
 * public.app_config (migration 023) -- operational values (OTP timings,
 * rate limits, grace-period days) read via src/lib/app-config.ts's
 * getConfigNumber(). Same shape/pattern as setFeatureFlag() above.
 */
export async function setAppConfig(key: string, value: number): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ key: string; value: number }>(
        `SELECT key, value FROM public.app_config WHERE key = $1`,
        [key],
      );
      const updated = await client.query<{ key: string; value: number }>(
        `UPDATE public.app_config SET value = $2::jsonb, updated_at = now(), updated_by = auth.uid()
         WHERE key = $1
         RETURNING key, value`,
        [key, JSON.stringify(value)],
      );
      if (updated.rows.length === 0) throw new Error(`Unknown config key: ${key}`);
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: key,
          before: before.rows[0] ?? null,
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update — please try again.' };
  }

  return {};
}

/**
 * Boolean app_config values.
 *
 * These MUST be written as real JSON booleans. app_config.value is jsonb and
 * supabase-js returns it as a real JS value, so cfgBool() only accepts `true`
 * / `false` (or the legacy "true" / "false" strings). The admin UI used to
 * push every config key through Number(), which stored 1/0 -- cfgBool ignored
 * that and silently returned its fallback, so toggling e.g.
 * gst_prices_include_tax in the UI changed nothing while appearing to save.
 */
export async function setAppConfigBool(key: string, value: boolean): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ key: string; value: boolean }>(
        `SELECT key, value FROM public.app_config WHERE key = $1`,
        [key],
      );
      const updated = await client.query<{ key: string; value: boolean }>(
        `UPDATE public.app_config SET value = $2::jsonb, updated_at = now(), updated_by = auth.uid()
         WHERE key = $1
         RETURNING key, value`,
        [key, JSON.stringify(Boolean(value))],
      );
      if (updated.rows.length === 0) throw new Error(`Unknown config key: ${key}`);
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: key,
          before: before.rows[0] ?? null,
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update — please try again.' };
  }

  return {};
}

/**
 * public.social_links (migration 025) -- footer icon URLs + per-platform
 * enable/disable, read via src/lib/social-links.ts's getSocialLinks(). Same
 * shape/pattern as setFeatureFlag()/setAppConfig() above.
 */
export async function setSocialLinkUrl(platform: string, url: string): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ platform: string; url: string }>(
        `SELECT platform, url FROM public.social_links WHERE platform = $1`,
        [platform],
      );
      const updated = await client.query<{ platform: string; url: string }>(
        `UPDATE public.social_links SET url = $2, updated_at = now(), updated_by = auth.uid()
         WHERE platform = $1
         RETURNING platform, url`,
        [platform, url],
      );
      if (updated.rows.length === 0) throw new Error(`Unknown social platform: ${platform}`);
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: platform,
          before: before.rows[0] ?? null,
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update — please try again.' };
  }

  return {};
}

export async function setSocialLinkEnabled(platform: string, enabled: boolean): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ platform: string; enabled: boolean }>(
        `SELECT platform, enabled FROM public.social_links WHERE platform = $1`,
        [platform],
      );
      const updated = await client.query<{ platform: string; enabled: boolean }>(
        `UPDATE public.social_links SET enabled = $2, updated_at = now(), updated_by = auth.uid()
         WHERE platform = $1
         RETURNING platform, enabled`,
        [platform, enabled],
      );
      if (updated.rows.length === 0) throw new Error(`Unknown social platform: ${platform}`);
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: platform,
          before: before.rows[0] ?? null,
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update — please try again.' };
  }

  return {};
}

/**
 * String-valued app_config (WhatsApp display number, self-notify number, API
 * version). Same audited mutate() path as setAppConfig(); separate only
 * because the value is quoted into jsonb as a string, not a number.
 */
export async function setAppConfigString(key: string, value: string): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ key: string; value: string }>(
        `SELECT key, value FROM public.app_config WHERE key = $1`,
        [key],
      );
      const updated = await client.query<{ key: string; value: string }>(
        `UPDATE public.app_config SET value = $2::jsonb, updated_at = now(), updated_by = auth.uid()
         WHERE key = $1
         RETURNING key, value`,
        [key, JSON.stringify(value)],
      );
      if (updated.rows.length === 0) throw new Error(`Unknown config key: ${key}`);
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: key,
          before: before.rows[0] ?? null,
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update — please try again.' };
  }

  return {};
}
