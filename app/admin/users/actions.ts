'use server';

import { revalidatePath } from 'next/cache';

import { isRole } from '@/types/schema';

import { mutate, toFormError } from '../lib/db';

export type SetUserRoleResult = { ok: true } | { ok: false; error: string };

/**
 * Assign (or reassign) a user's role.
 *
 * `user_roles` has an UPDATE policy but deliberately no INSERT policy for
 * authenticated sessions (003 §8.10): creating the first role row is the
 * bootstrap moment, so role assignment is documented as a server-side,
 * service-role operation. This module is that path, which is why the upsert
 * below is legitimate rather than a policy bypass.
 */
export async function setUserRole(userId: string, role: string): Promise<SetUserRoleResult> {
  if (!isRole(role)) return { ok: false, error: `Unknown role: ${role}` };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, error: 'Invalid user id' };

  try {
    await mutate(async (client) => {
      const before = await client.query<{ role: string }>(
        `SELECT role FROM public.user_roles WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );

      await client.query(
        `INSERT INTO public.user_roles (user_id, role)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
        [userId, role],
      );

      return {
        result: undefined,
        audit: {
          resourceKey: 'users',
          action: 'edit' as const,
          targetId: userId,
          before: { role: before.rows[0]?.role ?? null },
          after: { role },
        },
      };
    });
  } catch (error) {
    return { ok: false, error: toFormError(error) };
  }

  revalidatePath('/admin/users');
  return { ok: true };
}
