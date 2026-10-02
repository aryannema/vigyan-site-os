'use client';

import { useState, useTransition } from 'react';
import { purgeCloudflareCache } from './cache-actions';
import { warmCacheAction } from './warm-actions';

type Line = { ok: boolean; message: string };

export function PurgeCacheButton() {
  const [lines, setLines] = useState<Line[]>([]);
  const [failed, setFailed] = useState<{ url: string; reason: string }[]>([]);
  const [stage, setStage] = useState<'idle' | 'purging' | 'warming'>('idle');
  const [, startTransition] = useTransition();

  const run = (purge: boolean) =>
    startTransition(async () => {
      setLines([]);
      setFailed([]);
      if (purge) {
        setStage('purging');
        const p = await purgeCloudflareCache();
        setLines([p]);
        if (!p.ok) return setStage('idle');
      }
      setStage('warming');
      const w = await warmCacheAction();
      setLines((l) => [...l, w]);
      setFailed(w.report?.failed ?? []);
      setStage('idle');
    });

  const busy = stage !== 'idle';

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline bg-sand p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">Purge and re-cache</p>
        <p className="mt-1 text-xs text-muted">
          Purge drops every cached page, then every URL in the sitemap is requested once so Cloudflare holds a fresh HTML copy before crawlers arrive. Publishing already does this for the pages it changes.
        </p>
        {lines.map((l, i) => (
          <p key={i} className={`mt-2 text-xs font-bold ${l.ok ? 'text-green-ink' : 'text-red-600'}`}>{l.message}</p>
        ))}
        {failed.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-red-600">
            {failed.map((f) => (
              <li key={f.url} className="truncate font-mono">{f.url} — {f.reason}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(true)}
          className="rounded-lg bg-ink px-4 py-2 text-xs font-bold text-surface disabled:opacity-60"
        >
          {stage === 'purging' ? 'Purging…' : stage === 'warming' ? 'Re-caching…' : 'Purge + re-cache'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(false)}
          className="rounded-lg border border-hairline px-4 py-2 text-xs font-bold text-ink disabled:opacity-60"
        >
          Re-cache only
        </button>
      </div>
    </div>
  );
}
