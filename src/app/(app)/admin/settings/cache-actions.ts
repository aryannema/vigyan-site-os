'use server';

/**
 * Operator-triggered cache purge.
 *
 * WHY THIS EXISTS. There are two caches and they do not know about each other.
 * `revalidatePath` refreshes what Next holds on the origin; Cloudflare keeps
 * its own copy for the full `s-maxage` window and nothing in Next can reach it.
 * Every write path already calls revalidateFor(), which now purges too — but
 * that only covers changes that went THROUGH the app. It does not cover a row
 * edited straight in the database, a Cloudflare rule change, or the ordinary
 * case of "something looks wrong and I want to rule the cache out".
 *
 * So: a button. It is the operator's equivalent of the purge the code does
 * automatically, for the cases the code cannot know about.
 *
 * SCOPE. purge_everything drops every cached page for the zone. The cost is a
 * cold cache — the next visitor to each page waits for an origin render, and
 * with ~25 static pages that is tens of requests, not thousands. It is not a
 * destructive operation and nothing is lost; it only makes the next request
 * slower.
 */

import { getSecret } from '@/lib/app-secrets';
import { mutate } from '../lib/db';

type PurgeResult = { ok: boolean; message: string };

export async function purgeCloudflareCache(): Promise<PurgeResult> {
  // Gated and audited through the same mutate()/perform_action() path as every
  // other admin write. A purge is not destructive, but it acts on production
  // infrastructure, so it belongs behind the same capability check as changing
  // a setting — and it belongs in the audit log, so "who cleared the cache at
  // 3am" is answerable.
  //
  // The capability check happens inside perform_action(); an actor without
  // settings:edit is rejected there and never reaches Cloudflare.
  try {
    await mutate(async () => ({
      result: undefined,
      audit: {
        resourceKey: 'settings',
        action: 'edit' as const,
        targetId: 'cloudflare-cache',
        before: null,
        after: { purged: 'everything' },
      },
    }));
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'You do not have permission to purge the cache.',
    };
  }

  const [token, zone] = await Promise.all([
    getSecret('CLOUDFLARE_CACHE_PURGE_TOKEN'),
    getSecret('CLOUDFLARE_ZONE_ID'),
  ]);

  // Say WHICH is missing. "Purge failed" with no reason is how an operator
  // ends up guessing at credentials they cannot see.
  if (!token || !zone) {
    const missing = [!token && 'CLOUDFLARE_CACHE_PURGE_TOKEN', !zone && 'CLOUDFLARE_ZONE_ID']
      .filter(Boolean)
      .join(' and ');
    return {
      ok: false,
      message: `Not configured: ${missing} is not set. Add it in Settings → Secrets.`,
    };
  }

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; errors?: { message?: string }[] }
      | null;

    if (!res.ok || !body?.success) {
      // Cloudflare's own message is far more useful than a generic failure —
      // it distinguishes a wrong zone id from an under-scoped token.
      const detail = body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
      console.error('[cache-purge] Cloudflare rejected the purge:', detail);
      return { ok: false, message: `Cloudflare refused: ${detail}` };
    }

    return {
      ok: true,
      message: 'Cache purged. The next visit to each page will be served fresh from the origin.',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('[cache-purge] request failed:', err);
    return { ok: false, message: `Could not reach Cloudflare: ${detail}` };
  }
}
