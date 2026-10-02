'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Signed-in self-service account deletion. Confirmed by typing "DELETE",
 * not an OTP — an active session already proves identity (see
 * api/account/delete/route.ts's header comment for why this differs from
 * the unauthenticated dual-channel flow at /data-deletion/request).
 */
export default function DeleteAccountButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not delete account.');
        return;
      }
      router.push('/');
    } finally {
      setDeleting(false);
    }
  };

  if (!open) {
    return (
      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-red-600">Danger zone</h2>
        <p className="mt-2 text-sm text-muted">
          Permanently delete your account. Your name, email, and WhatsApp number will be removed;
          order history is retained for legal/tax reasons, dissociated from your identity.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-xs font-bold text-red-600 hover:underline"
        >
          Delete my account
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-red-600">Delete your account?</h2>
      <p className="mt-2 text-sm text-muted">
        This cannot be undone. Type <span className="font-mono font-bold text-ink">DELETE</span> to confirm.
      </p>
      {error && (
        <div role="alert" className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-600">
          {error}
        </div>
      )}
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="Type DELETE"
        className="mt-3 w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-red-500/60"
      />
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={handleDelete}
          disabled={confirmText !== 'DELETE' || deleting}
          className="rounded-card bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Permanently delete'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setConfirmText(''); setError(null); }}
          className="text-xs font-bold text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
