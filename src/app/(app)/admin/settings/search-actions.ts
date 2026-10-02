'use server';

import { getSitemapUrls } from '@/lib/cache-warm';
import { submitIndexNow } from '@/lib/indexnow';
import { resubmitSitemap } from '@/lib/search-ping';
import { mutate } from '../lib/db';

type Line = { ok: boolean; message: string };

export async function submitToSearchEngines(): Promise<Line[]> {
  try {
    await mutate(async () => ({
      result: undefined,
      audit: {
        resourceKey: 'settings',
        action: 'edit' as const,
        targetId: 'search-engine-submit',
        before: null,
        after: { submitted: 'sitemap' },
      },
    }));
  } catch (error) {
    return [{ ok: false, message: error instanceof Error ? error.message : 'You do not have permission to submit.' }];
  }

  let urls: string[];
  try {
    urls = await getSitemapUrls();
  } catch (err) {
    return [{ ok: false, message: `Could not read sitemap: ${String(err)}` }];
  }

  const [indexNow, google] = await Promise.all([submitIndexNow(urls), resubmitSitemap()]);
  return [
    {
      ok: indexNow.ok,
      message: indexNow.ok
        ? `IndexNow (Bing, Yandex, Seznam, Naver): ${indexNow.count} URLs accepted (HTTP ${indexNow.status}).`
        : `IndexNow rejected (HTTP ${indexNow.status}): ${indexNow.detail}`,
    },
    {
      ok: google.ok,
      message: google.ok ? `Google Search Console: sitemap resubmitted. ${google.detail}` : `Google Search Console: ${google.detail}`,
    },
  ];
}
