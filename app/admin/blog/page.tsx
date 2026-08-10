import Link from 'next/link';

import type { Post } from '@/types/schema';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { query } from '../lib/db';
import { deletePostAction, setPostStatusAction } from './actions';

export const dynamic = 'force-dynamic';

function statusVariant(status: Post['status']) {
  if (status === 'published') return 'default' as const;
  if (status === 'archived') return 'muted' as const;
  return 'outline' as const;
}

export default async function BlogListPage() {
  const posts = await query<Post>(
    `SELECT id, title, slug, category, seo_description, featured_image,
            content_blocks, status, published_at, created_at
       FROM public.posts
      ORDER BY COALESCE(published_at, created_at) DESC NULLS LAST, title`,
  );

  return (
    <>
      <PageHeader
        title="Posts"
        description="Blog entries from the posts table. Only published posts are readable by anonymous visitors."
        action={{ label: 'New post', href: '/admin/blog/new' }}
      />

      {posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description="Create the first one to see it here — the list reads the posts table directly."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.map((post) => (
              <TableRow key={post.id}>
                <TableCell>
                  <Link href={`/admin/blog/${post.id}`} className="font-medium hover:underline">
                    {post.title}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">/{post.slug}</div>
                </TableCell>
                <TableCell className="text-xs">{post.category}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(post.status)}>{post.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {post.published_at ? new Date(post.published_at).toISOString().slice(0, 10) : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {/* Status changes post to a Server Action; `publish` is checked
                        in the application layer because RLS cannot gate a column. */}
                    <form action={setPostStatusAction}>
                      <input type="hidden" name="id" value={post.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={post.status === 'published' ? 'draft' : 'published'}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        {post.status === 'published' ? 'Unpublish' : 'Publish'}
                      </Button>
                    </form>
                    <Link
                      href={`/admin/blog/${post.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
                    >
                      Edit
                    </Link>
                    <form action={deletePostAction}>
                      <input type="hidden" name="id" value={post.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                        Delete
                      </Button>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
