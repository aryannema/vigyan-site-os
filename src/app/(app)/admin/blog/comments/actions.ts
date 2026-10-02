'use server';

import { revalidatePath } from 'next/cache';

import { mutate, toFormError } from '../../lib/db';

type CommentStatus = 'approved' | 'rejected';

async function setStatus(id: string, status: CommentStatus): Promise<void> {
  await mutate(async (client) => {
    const before = await client.query(
      `SELECT * FROM public.post_comments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rows.length === 0) throw new Error('That comment no longer exists.');

    const updated = await client.query(
      `UPDATE public.post_comments
          SET status = $2, moderated_at = now(), moderated_by = auth.uid()
        WHERE id = $1
        RETURNING *`,
      [id, status],
    );
    const row = updated.rows[0];
    return {
      result: row,
      audit: {
        resourceKey: 'blog',
        action: 'edit' as const,
        targetId: id,
        before: before.rows[0],
        after: row,
      },
    };
  });
}

export async function approveComment(id: string): Promise<{ error?: string }> {
  try {
    await setStatus(id, 'approved');
  } catch (error) {
    return { error: toFormError(error) };
  }
  revalidatePath('/admin/blog/comments');
  return {};
}

export async function rejectComment(id: string): Promise<{ error?: string }> {
  try {
    await setStatus(id, 'rejected');
  } catch (error) {
    return { error: toFormError(error) };
  }
  revalidatePath('/admin/blog/comments');
  return {};
}

export async function deleteComment(id: string): Promise<{ error?: string }> {
  try {
    await mutate(async (client) => {
      const deleted = await client.query(
        `DELETE FROM public.post_comments WHERE id = $1 RETURNING *`,
        [id],
      );
      if (deleted.rows.length === 0) throw new Error('That comment no longer exists.');
      return {
        result: null,
        audit: { resourceKey: 'blog', action: 'delete' as const, targetId: id, before: deleted.rows[0] },
      };
    });
  } catch (error) {
    return { error: toFormError(error) };
  }
  revalidatePath('/admin/blog/comments');
  return {};
}
