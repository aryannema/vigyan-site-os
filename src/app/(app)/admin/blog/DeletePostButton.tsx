'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { deletePost } from './actions';

interface DeletePostButtonProps {
  id: string;
  title: string;
}

export default function DeletePostButton({ id, title }: DeletePostButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await deletePost(id);
      router.refresh();
    } catch {
      alert('Failed to delete post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      aria-label={`Delete ${title}`}
      title="Delete"
      className="rounded-md p-1.5 text-muted transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
