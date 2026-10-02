'use client';

import { useState, useTransition } from 'react';
import { setAppConfigString } from './actions';

export function AppConfigTextInput({
  configKey,
  label,
  description,
  initialValue,
}: {
  configKey: string;
  label: string;
  description: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Value cannot be empty.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setAppConfigString(configKey, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setValue(trimmed);
      setSaved(true);
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-sand p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-1 text-xs text-muted">{description}</p>
        {error && <p className="mt-1 text-xs font-bold text-destructive">{error}</p>}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        className="w-44 shrink-0 rounded-lg border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-saffron-500/60"
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending || saved}
        className="shrink-0 rounded-lg bg-saffron-500 px-3 py-1.5 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}
