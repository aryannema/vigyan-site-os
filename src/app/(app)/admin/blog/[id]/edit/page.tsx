import { notFound } from 'next/navigation';

import type { ActionAuditLog, Post } from '@/types/schema';
import { normalizeLegacyBlocks } from '@/lib/content/legacy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { query } from '../../../lib/db';
import { PageHeader } from '../../../components/PageHeader';
import { deletePostAction, updatePost } from '../../actions';
import { PostForm } from '../../PostForm';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-uuid id would make Postgres raise 22P02 rather than return no rows.
  if (!UUID.test(id)) notFound();

  const [posts, audit, categoryRows] = await Promise.all([
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
    query<{ category: string }>(`SELECT DISTINCT category FROM public.posts ORDER BY category`),
  ]);

  const post = posts[0];
  if (!post) notFound();

  // Rows written before the block format was tightened can carry a level-1
  // heading or an image with no `alt` — both fail the strict schema and would
  // be silently dropped by the editor. Repair them on read instead.
  const normalized: Post = {
    ...post,
    content_blocks: normalizeLegacyBlocks(post.content_blocks),
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Edit Post"
        description={`/${post.slug}`}
        breadcrumbs={[{ label: 'CMS' }, { label: 'All Posts', href: '/admin/blog' }, { label: 'Edit' }]}
        action={{ label: 'View Live ↗', href: `/blog/${post.slug}`, external: true }}
      />

      <PostForm
        post={normalized}
        action={updatePost.bind(null, id)}
        submitLabel="Save changes"
        categories={categoryRows.map((r) => r.category)}
      />

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            From <code>action_audit_log</code>. Every write to this post records a row in the same
            transaction as the write itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-xs text-muted">No recorded activity.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs">
              {audit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap gap-2 text-muted">
                  <span className="font-mono">{new Date(entry.created_at).toISOString()}</span>
                  <span className="font-semibold text-ink">
                    {entry.resource_key}:{entry.action}
                  </span>
                  <span>by {entry.actor}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-4xl border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting removes the row permanently. The deleted values are kept in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deletePostAction}>
            <input type="hidden" name="id" value={post.id} />
            <Button type="submit" variant="destructive" size="sm">
              Delete post
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
