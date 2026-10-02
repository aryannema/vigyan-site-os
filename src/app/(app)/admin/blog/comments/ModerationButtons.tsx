'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { approveComment, rejectComment, deleteComment } from './actions';

export default function ModerationButtons({ id, status }: { id: string; status: 'pending' | 'approved' | 'rejected' }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const run = async (label: string, action: () => Promise<{ error?: string }>) => {
    setLoading(label);
    const { error } = await action();
    setLoading(null);
    if (error) {
      alert(error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3">
      {status !== 'approved' && (
        <button
          onClick={() => run('approve', () => approveComment(id))}
          disabled={loading !== null}
          className="text-xs font-bold text-green-ink transition hover:underline disabled:opacity-40"
        >
          {loading === 'approve' ? '…' : 'Approve'}
        </button>
      )}
      {status !== 'rejected' && (
        <button
          onClick={() => run('reject', () => rejectComment(id))}
          disabled={loading !== null}
          className="text-xs font-bold text-muted transition hover:text-ink disabled:opacity-40"
        >
          {loading === 'reject' ? '…' : 'Reject'}
        </button>
      )}
      <button
        onClick={() => {
          if (!confirm('Delete this comment permanently?')) return;
          run('delete', () => deleteComment(id));
        }}
        disabled={loading !== null}
        className="text-xs font-bold text-red-500/70 transition hover:text-red-500 disabled:opacity-40"
      >
        {loading === 'delete' ? '…' : 'Delete'}
      </button>
    </div>
  );
}
