'use client';

import { useState, useTransition } from 'react';
import { setAppConfigBool } from './actions';

/**
 * A boolean app_config row, as a toggle rather than a number box.
 *
 * Previously these rendered through AppConfigInput with initialValue={Number(
 * row.value)}, so `true` appeared as `1` in a number field and saving wrote
 * the number 1. cfgBool() does not accept 1 -- it returns its fallback -- so
 * the setting silently did nothing. For gst_prices_include_tax that means
 * every price quoted 18% wrong while the UI said "Saved".
 */
export function AppConfigBoolInput({
  configKey,
  label,
  description,
  initialValue,
}: {
  configKey: string;
  label: string;
  description: string;
  initialValue: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await setAppConfigBool(configKey, next);
      if (result.error) {
        setValue(!next); // revert — never show a state the DB does not hold
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-sand p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-1 text-xs text-muted">{description}</p>
        {error && <p className="mt-1 text-xs font-bold text-destructive">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={toggle}
        disabled={isPending}
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          value ? 'bg-saffron-500' : 'bg-hairline-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${
            value ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
