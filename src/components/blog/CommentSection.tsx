'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface Comment {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs >= 1) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60_000);
  return mins <= 1 ? 'just now' : `${mins}m ago`;
}

export default function CommentSection({ postId }: { postId: string }) {
  const [approved, setApproved] = useState<Comment[]>([]);
  const [ownPending, setOwnPending] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user ?? null;
      setSignedIn(!!user);
      if (user) {
        setDisplayName((user.user_metadata?.full_name as string | undefined) || user.email || '');
      }

      const { data: approvedRows } = await supabase
        .from('post_comments')
        .select('id, author_name, body, created_at, status')
        .eq('post_id', postId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      setApproved((approvedRows as Comment[]) ?? []);

      if (user) {
        const { data: ownRows } = await supabase
          .from('post_comments')
          .select('id, author_name, body, created_at, status')
          .eq('post_id', postId)
          .eq('author_id', user.id)
          .neq('status', 'approved')
          .order('created_at', { ascending: false });
        setOwnPending((ownRows as Comment[]) ?? []);
      }

      setLoading(false);
    };

    load();
  }, [postId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    const supabase = createBrowserSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setError('Your session expired — please sign in again.');
      setSubmitting(false);
      return;
    }

    const authorName = (user.user_metadata?.full_name as string | undefined) || user.email || 'Anonymous';

    const { data: inserted, error: insertError } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, author_id: user.id, author_name: authorName, body: trimmed })
      .select('id, author_name, body, created_at, status')
      .single();

    if (insertError) {
      setError('Could not post your comment. Please try again.');
      setSubmitting(false);
      return;
    }

    setOwnPending((prev) => [inserted as Comment, ...prev]);
    setBody('');
    setSubmitting(false);

    // Best-effort moderation-alert notification — no-ops server-side if
    // N8N_COMMENT_POSTED_WEBHOOK_URL isn't configured. Never blocks or fails
    // the comment itself, which is already saved at this point.
    fetch('/api/relay/n8n-comment-posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: postId,
        author_name: authorName,
        excerpt: trimmed.slice(0, 200),
      }),
    }).catch(() => {});
  };

  return (
    <div className="mt-16 border-t border-hairline pt-10">
      <h3 className="mb-6 text-xl font-bold text-ink">
        Comments {approved.length > 0 && <span className="text-muted">({approved.length})</span>}
      </h3>

      {signedIn ? (
        <form onSubmit={handleSubmit} className="mb-8 space-y-3">
          <p className="text-xs font-medium text-muted">Commenting as {displayName}</p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your thoughts…"
            maxLength={2000}
            rows={4}
            required
            className="w-full rounded-card border border-hairline-strong bg-surface p-4 text-sm text-ink outline-none transition focus:border-saffron-500/50"
          />
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="rounded-card bg-saffron-500 px-5 py-2.5 text-sm font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      ) : (
        <p className="mb-8 rounded-card border border-hairline bg-sand p-4 text-sm text-muted">
          <Link href="/account" className="font-bold text-saffron-ink hover:underline">
            Sign in
          </Link>{' '}
          to join the conversation.
        </p>
      )}

      {ownPending.map((c) => (
        <div key={c.id} className="mb-3 rounded-card border border-dashed border-saffron-500/40 bg-saffron-500/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink">{c.author_name}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-saffron-ink">
              {c.status === 'rejected' ? 'Not published' : 'Awaiting approval'}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-body">{c.body}</p>
        </div>
      ))}

      {!loading && approved.length === 0 && ownPending.length === 0 && (
        <p className="text-sm text-muted">No comments yet — be the first to share your thoughts.</p>
      )}

      <div className="space-y-5">
        {approved.map((c) => (
          <div key={c.id} className="border-b border-hairline pb-5 last:border-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-ink">{c.author_name}</span>
              <span className="text-xs text-faint">{timeAgo(c.created_at)}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-body">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
