import { query } from '../../lib/db';
import { PageHeader } from '../../components/PageHeader';
import { createPost } from '../actions';
import { PostForm } from '../PostForm';

export const dynamic = 'force-dynamic';

/**
 * Categories are read live so the editor's suggestion list reflects what is
 * actually in use, merged with BLOG_CATEGORIES inside PostForm. If the database
 * is unreachable the page still renders — the field falls back to the fixed
 * vocabulary rather than 500-ing on a page whose job is to create content.
 */
async function loadCategories(): Promise<string[]> {
  try {
    const rows = await query<{ category: string }>(
      `SELECT DISTINCT category FROM public.posts ORDER BY category`,
    );
    return rows.map((r) => r.category);
  } catch (error) {
    console.error('[admin/blog/new] could not load categories:', error);
    return [];
  }
}

export default async function NewPostPage() {
  const categories = await loadCategories();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Create New Post"
        description="New posts default to draft — publishing is a separate, capability-gated action."
        breadcrumbs={[{ label: 'CMS' }, { label: 'All Posts', href: '/admin/blog' }, { label: 'New' }]}
      />

      <PostForm action={createPost} submitLabel="Create post" categories={categories} />
    </div>
  );
}
