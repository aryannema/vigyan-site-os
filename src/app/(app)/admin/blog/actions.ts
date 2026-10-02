'use server';

/**
 * Blog write path.
 *
 * REPLACES the previous version, which POSTed to this app's own `/api/mcp`
 * route over HTTP with the shared `MCP_SECRET_KEY` bearer token. That worked,
 * but it meant every admin edit was attributed to `mcp-api-key` rather than to
 * the person making it, and it made an internal HTTP round-trip per keystroke-
 * saving action.
 *
 * Everything below now goes through `mutate()` (`../lib/db`), which:
 *   - refuses outright when no actor can be resolved (fail closed — no more
 *     implicit system identity),
 *   - runs the data change and `public.perform_action()` in ONE transaction, so
 *     the capability check and the audit row cannot come apart,
 *   - records real before/after values in `action_audit_log`.
 *
 * The MCP route is untouched and remains the surface for automation/agents.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { POST_STATUSES, type Post, type PostStatus } from '@/types/schema';
import { onBlogPostPublished } from '@/lib/blog-publish-hooks';

import { mutate, toFormError } from '../lib/db';
import {
  FieldError,
  oneOf,
  optionalString,
  requiredString,
  slug as slugField,
  toFormState,
  type FormState,
} from '../lib/form';
import { encodeContentBlocks, type BodyMode } from './content-blocks';

interface PostFields {
  title: string;
  slug: string;
  category: string;
  seo_description: string | null;
  featured_image: string | null;
  status: PostStatus;
  content_blocks: unknown[];
}

function readPostFields(formData: FormData): PostFields {
  const mode = (formData.get('body_mode') === 'json' ? 'json' : 'markdown') as BodyMode;
  let content_blocks: unknown[];
  try {
    content_blocks = encodeContentBlocks(mode, String(formData.get('body') ?? ''));
  } catch (error) {
    throw new FieldError('body', (error as Error).message);
  }

  return {
    title: requiredString(formData, 'title', 'Title'),
    slug: slugField(formData, 'slug', 'Slug'),
    category: requiredString(formData, 'category', 'Category'),
    seo_description: optionalString(formData, 'seo_description'),
    featured_image: optionalString(formData, 'featured_image'),
    status: oneOf(formData, 'status', 'Status', POST_STATUSES) as PostStatus,
    content_blocks,
  };
}

export async function createPost(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  let published: Post | null = null;
  try {
    const fields = readPostFields(formData);
    id = await mutate(async (client) => {
      const inserted = await client.query<Post>(
        `INSERT INTO public.posts
           (title, slug, category, seo_description, featured_image, status, content_blocks, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb,
                 CASE WHEN $6 = 'published' THEN now() ELSE NULL END)
         RETURNING *`,
        [
          fields.title,
          fields.slug,
          fields.category,
          fields.seo_description,
          fields.featured_image,
          fields.status,
          JSON.stringify(fields.content_blocks),
        ],
      );
      const row = inserted.rows[0]!;
      if (row.status === 'published') published = row;
      return {
        result: row.id,
        audit: {
          resourceKey: 'blog',
          action: 'create' as const,
          targetId: row.id,
          after: row,
        },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  if (published) void onBlogPostPublished(published);

  revalidatePath('/admin/blog');
  // This repo's edit route is /admin/blog/[id]/edit, not /admin/blog/[id].
  redirect(`/admin/blog/${id}/edit`);
}

export async function updatePost(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let published: Post | null = null;
  try {
    const fields = readPostFields(formData);
    await mutate(async (client) => {
      const before = await client.query<Post>(
        `SELECT * FROM public.posts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (before.rows.length === 0) throw new Error('That post no longer exists.');

      const updated = await client.query<Post>(
        `UPDATE public.posts
            SET title           = $2,
                slug            = $3,
                category        = $4,
                seo_description = $5,
                featured_image  = $6,
                status          = $7,
                content_blocks  = $8::jsonb,
                published_at    = CASE WHEN $7 = 'published' AND published_at IS NULL
                                       THEN now() ELSE published_at END
          WHERE id = $1
          RETURNING *`,
        [
          id,
          fields.title,
          fields.slug,
          fields.category,
          fields.seo_description,
          fields.featured_image,
          fields.status,
          JSON.stringify(fields.content_blocks),
        ],
      );

      const wasPublished = before.rows[0]!.status === 'published';
      const nowPublished = fields.status === 'published';
      if (nowPublished && !wasPublished) published = updated.rows[0]!;

      return {
        result: undefined,
        audit: {
          resourceKey: 'blog',
          // A status change into or out of 'published' is a publish action, not
          // a plain edit — 003 §8.3 notes RLS cannot make that distinction, so
          // the application layer has to. Recording it correctly is what lets
          // the audit log answer "who published this?".
          action: (wasPublished !== nowPublished ? 'publish' : 'edit') as 'publish' | 'edit',
          targetId: id,
          before: before.rows[0],
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  if (published) void onBlogPostPublished(published);

  revalidatePath('/admin/blog');
  revalidatePath(`/admin/blog/${id}/edit`);
  revalidatePath('/blog');

  // The sitemap queries the database and revalidates hourly, so a newly
  // published item would otherwise wait up to an hour to be listed. Refreshing it
  // here makes discovery immediate: the page and the sitemap entry appear
  // together. No rebuild and no deploy — revalidatePath re-runs the route on the
  // server that is already running.
  revalidatePath('/sitemap.xml');
  return { success: 'Saved.' };
}

export async function setPostStatus(id: string, status: string): Promise<void> {
  if (!(POST_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  let published: Post | null = null;

  await mutate(async (client) => {
    const before = await client.query<Post>(
      `SELECT * FROM public.posts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rows.length === 0) throw new Error('That post no longer exists.');

    const updated = await client.query<Post>(
      `UPDATE public.posts
          SET status = $2,
              published_at = CASE WHEN $2 = 'published' AND published_at IS NULL
                                  THEN now() ELSE published_at END
        WHERE id = $1
        RETURNING *`,
      [id, status],
    );

    if (status === 'published' && before.rows[0]!.status !== 'published') {
      published = updated.rows[0]!;
    }

    return {
      result: undefined,
      audit: {
        resourceKey: 'blog',
        action: 'publish' as const,
        targetId: id,
        before: { status: before.rows[0]!.status },
        after: { status: updated.rows[0]!.status },
      },
    };
  });

  if (published) void onBlogPostPublished(published);

  revalidatePath('/admin/blog');
  revalidatePath(`/admin/blog/${id}/edit`);
  revalidatePath('/blog');
  // Keep the sitemap in step with this change (see above).
  revalidatePath('/sitemap.xml');
}

/**
 * Deliberately does NOT redirect: `DeletePostButton` is a client component that
 * awaits this inside a try/catch and then calls `router.refresh()`. A
 * `redirect()` here throws a control-flow signal that that catch would swallow,
 * turning a successful delete into a spurious "Failed to delete" alert. The
 * form-action wrapper below is the one that navigates.
 */
export async function deletePost(id: string): Promise<void> {
  await mutate(async (client) => {
    const deleted = await client.query<Post>(
      `DELETE FROM public.posts WHERE id = $1 RETURNING *`,
      [id],
    );
    if (deleted.rows.length === 0) throw new Error('That post no longer exists.');
    return {
      result: undefined,
      audit: {
        resourceKey: 'blog',
        action: 'delete' as const,
        targetId: id,
        // The deleted row is kept in the audit trail: after a DELETE it is the
        // only remaining record of what was removed.
        before: deleted.rows[0],
      },
    };
  });

  revalidatePath('/admin/blog');
  revalidatePath('/blog');
  // Keep the sitemap in step with this change (see above).
  revalidatePath('/sitemap.xml');
}

/** Form-action wrappers, so list rows can post to a Server Action directly. */
export async function setPostStatusAction(formData: FormData): Promise<void> {
  await setPostStatus(String(formData.get('id')), String(formData.get('status')));
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await deletePost(String(formData.get('id')));
  redirect('/admin/blog');
}
