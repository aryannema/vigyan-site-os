'use server';

/**
 * Admin-initiated account deletion (spam/fake/abusive accounts, support
 * cleanup, etc.) -- reuses the exact same executeAccountDeletion() executor
 * as the two user-initiated flows (src/lib/account-deletion.ts): no hard
 * delete of auth.users (orders/order-adjacent records survive, see that
 * module's header), 15-day admin-recoverable grace period, deliberately not
 * a separate/parallel soft-delete mechanism.
 *
 * Same two-part pattern as admin/account-deletions/actions.ts's
 * restoreAccount(): the real mutation touches GoTrue's admin REST API
 * (can't be wrapped by mutate()/perform_action(), which only atomically
 * wraps SQL), so capability is checked explicitly up front, then a SECOND
 * write goes through mutate() purely to record a real, actor-attributed
 * audit row.
 */

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { executeAccountDeletion } from '@/lib/account-deletion';
import { mutate } from '../lib/db';

export async function adminDeleteAccount(userId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { data: allowed, error: capError } = await supabase.rpc('user_has_capability', {
    p_user_id: user.id,
    p_resource_key: 'settings',
    p_action: 'edit',
  });
  if (capError || !allowed) {
    return { error: 'You do not have permission to delete accounts.' };
  }

  const result = await executeAccountDeletion(userId, 'admin_action');
  if (!result.success) {
    return { error: result.error || 'Could not delete account.' };
  }

  try {
    await mutate(async (client) => {
      const before = await client.query(
        `SELECT user_id, deleted_at FROM public.site_accounts WHERE user_id = $1`,
        [userId],
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'delete' as const,
          targetId: userId,
          before: { deleted_at: null },
          after: before.rows[0] ?? null,
        },
      };
    });
  } catch (auditError) {
    console.error('[admin/accounts] delete succeeded but audit write failed:', auditError);
  }

  return {};
}
