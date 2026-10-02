'use client';

import { useState, useTransition } from 'react';
import { setSocialLinkUrl, setSocialLinkEnabled } from './actions';

export function SocialLinkRow({
  platform,
  label,
  initialUrl,
  initialEnabled,
}: {
  platform: string;
  label: string;
  initialUrl: string;
  initialEnabled: boolean;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [urlSaved, setUrlSaved] = useState(true);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const saveUrl = () => {
    setError(null);
    startTransition(async () => {
      const result = await setSocialLinkUrl(platform, url);
      if (result.error) {
        setError(result.error);
        return;
      }
      setUrlSaved(true);
    });
  };

  const toggleEnabled = () => {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      const result = await setSocialLinkEnabled(platform, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEnabled(next);
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-sand p-4">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={isPending}
        onClick={toggleEnabled}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          enabled ? 'bg-green-500' : 'bg-hairline-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="w-20 shrink-0 text-sm font-bold text-ink">{label}</span>
      <input
        type="url"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setUrlSaved(false); }}
        className="min-w-0 flex-1 rounded-lg border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-saffron-500/60"
      />
      <button
        type="button"
        onClick={saveUrl}
        disabled={isPending || urlSaved}
        className="shrink-0 rounded-lg bg-saffron-500 px-3 py-1.5 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Saving…' : urlSaved ? 'Saved' : 'Save'}
      </button>
      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
    </div>
  );
}
