'use client';

import { useState, useTransition } from 'react';
import { setAppConfig } from './actions';

export function AppConfigInput({
  configKey,
  label,
  description,
  initialValue,
}: {
  configKey: string;
  label: string;
  description: string;
  initialValue: number;
}) {
  const [value, setValue] = useState(String(initialValue));
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Enter a valid non-negative number.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setAppConfig(configKey, parsed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-sand p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-1 text-xs text-muted">{description}</p>
        {error && <p className="mt-1 text-xs font-bold text-red-600">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className="w-20 rounded-lg border border-hairline-strong bg-surface px-2 py-1.5 text-right text-sm text-ink outline-none focus:border-saffron-500/60"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending || saved}
          className="rounded-lg bg-saffron-500 px-3 py-1.5 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
