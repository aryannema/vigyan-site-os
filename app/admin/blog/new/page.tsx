import { PageHeader } from '../../components/PageHeader';
import { query } from '../../lib/db';
import { createPost } from '../actions';
import { PostForm } from '../PostForm';

export const dynamic = 'force-dynamic';

export default async function NewPostPage() {
  const rows = await query<{ category: string }>(
    `SELECT DISTINCT category FROM public.posts ORDER BY category`,
  );

  return (
    <>
      <PageHeader
        title="New post"
        description="Saved to the posts table. New posts default to draft — publishing is a separate, capability-gated action."
      />
      <PostForm
        action={createPost}
        submitLabel="Create post"
        categories={rows.map((r) => r.category)}
      />
    </>
  );
}
