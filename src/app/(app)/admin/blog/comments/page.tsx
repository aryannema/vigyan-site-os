import { supabaseAdmin } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import ModerationButtons from './ModerationButtons';


export const dynamic = 'force-dynamic';
type CommentRow = {
  id: string;
  post_id: string;
  author_name: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  posts: { title: string; slug: string } | null;
};

async function getComments(): Promise<CommentRow[]> {
  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .select('id, post_id, author_name, body, status, created_at, posts(title, slug)')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as unknown as CommentRow[];
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ status }: { status: CommentRow['status'] }) {
  if (status === 'pending') return <Badge variant="secondary">Pending</Badge>;
  if (status === 'approved') return <Badge>Approved</Badge>;
  return <Badge variant="destructive">Rejected</Badge>;
}

export default async function BlogCommentsPage() {
  const comments = await getComments();
  const pending = comments.filter((c) => c.status === 'pending');
  const rest = comments.filter((c) => c.status !== 'pending');

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink dark:text-white">Blog Comments</h1>
        <p className="mt-1 text-sm text-muted dark:text-faint">
          {pending.length} pending{pending.length !== 1 ? '' : ''} · {comments.length} total
        </p>
      </div>

      {comments.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}

      {[...pending, ...rest].map((c) => (
        <div
          key={c.id}
          className="space-y-3 rounded-2xl border border-hairline bg-surface p-5 dark:border-hairline dark:bg-surface"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink dark:text-white">{c.author_name}</span>
                <StatusBadge status={c.status} />
              </div>
              <p className="mt-0.5 text-xs text-faint">
                on{' '}
                <span className="font-medium text-muted">{c.posts?.title ?? 'unknown post'}</span> ·{' '}
                {timeAgo(c.created_at)}
              </p>
            </div>
            <ModerationButtons id={c.id} status={c.status} />
          </div>
          <p className="text-sm leading-relaxed text-body">{c.body}</p>
        </div>
      ))}
    </div>
  );
}
