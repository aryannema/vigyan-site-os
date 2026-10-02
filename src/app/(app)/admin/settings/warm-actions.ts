'use server';

import { warmSitemap, type WarmReport } from '@/lib/cache-warm';
import { mutate } from '../lib/db';

export async function warmCacheAction(): Promise<{ ok: boolean; message: string; report?: WarmReport }> {
  try {
    await mutate(async () => ({
      result: undefined,
      audit: {
        resourceKey: 'settings',
        action: 'edit' as const,
        targetId: 'cloudflare-cache-warm',
        before: null,
        after: { warmed: 'sitemap' },
      },
    }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'You do not have permission to warm the cache.' };
  }
  const report = await warmSitemap();
  const ok = report.total > 0 && report.failed.length === 0;
  return {
    ok,
    message: `${report.html}/${report.total} sitemap pages re-cached as HTML${report.failed.length ? `, ${report.failed.length} failed` : ''}.`,
    report,
  };
}
