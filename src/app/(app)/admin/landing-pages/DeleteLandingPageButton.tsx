'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteLandingPage } from './actions';

export default function DeleteLandingPageButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setBusy(true);
    setFailed(false);
    try {
      await deleteLandingPage(id);
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className="text-xs text-red-500/60 transition hover:text-red-500">
        Delete
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-muted">{failed ? 'Failed — retry?' : `Delete “${title}”?`}</span>
      <button type="button" onClick={remove} disabled={busy} className="font-bold text-red-500 disabled:opacity-40">{busy ? '…' : 'Yes'}</button>
      <button type="button" onClick={() => setArmed(false)} className="text-muted hover:text-ink">No</button>
    </span>
  );
}
