'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { restoreAccount, purgeAccountNow } from './actions';

type ConfirmState = 'none' | 'restore' | 'purge';

export function RestoreButton({ graceId }: { graceId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<ConfirmState>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = async () => {
    setBusy(true);
    setError(null);
    const result = await restoreAccount(graceId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  const handlePurge = async () => {
    setBusy(true);
    setError(null);
    const result = await purgeAccountNow(graceId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  if (confirming === 'none') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming('restore')}
          className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-bold text-ink transition hover:border-saffron-500/50"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={() => setConfirming('purge')}
          className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-500/10"
        >
          Purge now
        </button>
      </div>
    );
  }

  if (confirming === 'restore') {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs font-bold text-red-600">{error}</span>}
        <button
          type="button"
          onClick={handleRestore}
          disabled={busy}
          className="rounded-lg bg-saffron-500 px-3 py-1.5 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:opacity-60"
        >
          {busy ? 'Restoring…' : 'Confirm restore'}
        </button>
        <button type="button" onClick={() => setConfirming('none')} className="text-xs font-bold text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs font-bold text-red-600">{error}</span>}
      <span className="text-xs font-bold text-red-600">Permanent — cannot be undone.</span>
      <button
        type="button"
        onClick={handlePurge}
        disabled={busy}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? 'Purging…' : 'Confirm purge'}
      </button>
      <button type="button" onClick={() => setConfirming('none')} className="text-xs font-bold text-muted hover:text-ink">
        Cancel
      </button>
    </div>
  );
}
