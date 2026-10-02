import Link from 'next/link';
import { Eye, Pencil } from 'lucide-react';

import type { Post } from '@/types/schema';
import { Input } from '@/components/ui/input';

import { query } from '../lib/db';
import { PageHeader } from '../components/PageHeader';
import DeletePostButton from './DeletePostButton';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

type ListedPost = Pick<Post, 'id' | 'title' | 'slug' | 'category' | 'status' | 'published_at' | 'created_at'>;

/**
 * Reads through the same audited `query()` helper (`admin/lib/db.ts`) every
 * other post page (new/edit) already uses, instead of `supabaseAdmin` -- the
 * two had drifted onto different data-access paths for no reason other than
 * this page predating the others.
 */
async function getPosts(searchTerm: string, page: number): Promise<{ posts: ListedPost[]; total: number }> {
  const offset = (page - 1) * PAGE_SIZE;
  const searchClause = searchTerm ? `WHERE title ILIKE $1 OR slug ILIKE $1` : '';
  const searchParam = searchTerm ? [`%${searchTerm}%`] : [];

  const [posts, countRows] = await Promise.all([
    query<ListedPost>(
      `SELECT id, title, slug, category, status, published_at, created_at
         FROM public.posts
         ${searchClause}
         ORDER BY created_at DESC
         LIMIT ${PAGE_SIZE} OFFSET $${searchParam.length + 1}`,
      [...searchParam, offset],
    ),
    query<{ count: string }>(`SELECT count(*) FROM public.posts ${searchClause}`, searchParam),
  ]);

  return { posts, total: Number(countRows[0]?.count ?? 0) };
}

function formatPostDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
  draft: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  scheduled: 'bg-ink/10 text-ink border-hairline-strong',
};

export default async function BlogManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const searchTerm = (params.q ?? '').trim();
  const page = Math.max(1, Number(params.page) || 1);

  const { posts, total } = await getPosts(searchTerm, page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (searchTerm) qs.set('q', searchTerm);
    if (targetPage > 1) qs.set('page', String(targetPage));
    const query = qs.toString();
    return query ? `/admin/blog?${query}` : '/admin/blog';
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Blog Posts"
        description={`${total} total post${total === 1 ? '' : 's'}`}
        action={{ label: '+ New Post', href: '/admin/blog/new' }}
      />

      <form action="/admin/blog" className="flex gap-2">
        <Input name="q" defaultValue={searchTerm} placeholder="Search by title or slug…" className="max-w-sm" />
      </form>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {posts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">
              {searchTerm ? `No posts match "${searchTerm}".` : 'No posts yet.'}
            </p>
            {!searchTerm && (
              <Link href="/admin/blog/new" className="mt-4 inline-block text-sm font-bold text-saffron-ink hover:underline">
                Create your first post →
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Title</th>
                  <th className="px-4 py-4 text-left">Category</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-4 py-4 text-left">Date</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-faint">
                {posts.map((post) => (
                  <tr key={post.id} className="group transition hover:bg-sand">
                    <td className="px-6 py-4">
                      <span className="line-clamp-1 font-medium text-ink transition group-hover:text-saffron-ink">
                        {post.title}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted">/{post.slug}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-green-ink">
                        {post.category}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[post.status] || STATUS_BADGE.draft}`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">
                      {formatPostDate(post.published_at ?? post.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          className="rounded-md p-1.5 text-muted transition hover:bg-well hover:text-ink"
                          aria-label={`Preview ${post.title}`}
                          title="Preview"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        <Link
                          href={`/admin/blog/${post.id}/edit`}
                          className="rounded-md p-1.5 text-muted transition hover:bg-well hover:text-saffron-ink"
                          aria-label={`Edit ${post.title}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <DeletePostButton id={post.id} title={post.title} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm text-muted" aria-label="Pagination">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="rounded-md border border-hairline px-3 py-1.5 transition hover:bg-sand">
                ← Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="rounded-md border border-hairline px-3 py-1.5 transition hover:bg-sand">
                Next →
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
