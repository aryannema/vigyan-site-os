'use client';

import { useState, useTransition } from 'react';
import { submitToSearchEngines } from './search-actions';

export function SubmitSearchButton() {
  const [lines, setLines] = useState<{ ok: boolean; message: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline bg-sand p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">Submit to search engines</p>
        <p className="mt-1 text-xs text-muted">
          Sends every sitemap URL to IndexNow (Bing, Yandex, Seznam, Naver) and resubmits the sitemap to Google Search Console. Google has no per-URL push; use Request Indexing in Search Console for key pages.
        </p>
        {lines.map((l, i) => (
          <p key={i} className={`mt-2 text-xs font-bold ${l.ok ? 'text-green-ink' : 'text-red-600'}`}>{l.message}</p>
        ))}
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(async () => setLines(await submitToSearchEngines()))}
        className="shrink-0 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-surface disabled:opacity-60"
      >
        {isPending ? 'Submitting…' : 'Submit sitemap'}
      </button>
    </div>
  );
}
