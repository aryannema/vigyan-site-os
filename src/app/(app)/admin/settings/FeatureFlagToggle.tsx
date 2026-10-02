'use client';

import { useState, useTransition } from 'react';
import { setFeatureFlag } from './actions';

export function FeatureFlagToggle({
  flagKey,
  label,
  description,
  initialEnabled,
}: {
  flagKey: string;
  label: string;
  description: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      const result = await setFeatureFlag(flagKey, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEnabled(next);
    });
  };

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline bg-sand p-4">
      <div>
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-1 text-xs text-muted">{description}</p>
        {error && <p className="mt-1 text-xs font-bold text-red-600">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={isPending}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          enabled ? 'bg-green-500' : 'bg-hairline-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
