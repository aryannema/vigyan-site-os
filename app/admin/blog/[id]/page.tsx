import { notFound } from 'next/navigation';

import type { ActionAuditLog, Post } from '@/types/schema';

import { Button } from '../../../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';
import { query } from '../../lib/db';
import { deletePostAction, updatePost } from '../actions';
import { PostForm } from '../PostForm';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-uuid id would make Postgres raise 22P02 rather than return no rows.
  if (!UUID.test(id)) notFound();

  const [posts, audit] = await Promise.all([
    query<Post>(
      `SELECT id, title, slug, category, seo_description, featured_image,
              content_blocks, status, published_at, created_at
         FROM public.posts WHERE id = $1`,
      [id],
    ),
    query<ActionAuditLog>(
      `SELECT id, actor, resource_key, action, target_id, before_data, after_data, created_at
         FROM public.action_audit_log
        WHERE target_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [id],
    ),
  ]);

  const post = posts[0];
  if (!post) notFound();

  return (
    <>
      <PageHeader
        title="Edit post"
        description={`Created ${post.created_at ? new Date(post.created_at).toISOString().slice(0, 10) : 'unknown'}.`}
      />

      <PostForm post={post} action={updatePost.bind(null, id)} submitLabel="Save changes" />

      <section className="mt-10 max-w-3xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold">Activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          From <code>action_audit_log</code>. Every write to this post records a row in the same
          transaction as the write itself.
        </p>
        {audit.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No recorded activity.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5 text-xs">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-2 text-muted-foreground">
                <span className="font-mono">{new Date(entry.created_at).toISOString()}</span>
                <span className="font-medium text-foreground">
                  {entry.resource_key}:{entry.action}
                </span>
                <span>by {entry.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 max-w-3xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Deleting removes the row permanently. The deleted values are kept in the audit log.
        </p>
        <form action={deletePostAction} className="mt-3">
          <input type="hidden" name="id" value={post.id} />
          <Button type="submit" variant="destructive" size="sm">
            Delete post
          </Button>
        </form>
      </section>
    </>
  );
}
