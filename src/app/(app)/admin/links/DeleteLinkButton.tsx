'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteLink } from './actions';

export default function DeleteLinkButton({ id, slug }: { id: string; slug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete /go/${slug}? This cannot be undone and will break this URL if it's already been shared — archive it instead if you just want to stop using it.`,
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      await deleteLink(id);
      router.refresh();
    } catch {
      alert('Failed to delete link. Please try again.');
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
