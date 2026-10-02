'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteJob } from './actions';

export default function DeleteJobButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await deleteJob(id);
      router.refresh();
    } catch {
      alert('Failed to delete opening. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-xs text-red-500/60 transition hover:text-red-500 disabled:opacity-40"
    >
      {loading ? '…' : 'Delete'}
    </button>
  );
}
