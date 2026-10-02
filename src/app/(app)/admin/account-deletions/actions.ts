'use server';

/**
 * Admin restore action for the 15-day account-deletion grace period
 * (migration 022/024, src/lib/account-deletion.ts).
 *
 * Two-part write, for a reason: the actual PII restore + auth-email/ban
 * reversal (restoreAccountFromGrace()) touches GoTrue's admin REST API,
 * which mutate()/perform_action() can't wrap (it only atomically wraps SQL
 * inside one Postgres transaction). So capability is checked explicitly up
 * front via the same user_has_capability RPC that gates account_deletion_
 * log's own read policy (migration 021) -- 'settings'/'edit', matching the
 * feature-flags admin page. Once the real restore succeeds, a SECOND write
 * goes through mutate() purely to stamp WHO did it (restored_at/restored_by
 * on account_deletion_log) as a real, actor-attributed, perform_action()-
 * backed audit row -- like every other admin write in this codebase, not a
 * service-role write with no identity attached (which is what this looked
 * like before this was tightened, 2026-09-09).
 */

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { restoreAccountFromGrace, purgeGraceNow } from '@/lib/account-deletion';
import { mutate } from '../lib/db';

export async function restoreAccount(graceId: string): Promise<{ error?: string }> {
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
    return { error: 'You do not have permission to restore accounts.' };
  }

  const result = await restoreAccountFromGrace(graceId);
  if (!result.success || !result.userId) {
    return { error: result.error || 'Could not restore account.' };
  }

  try {
    await mutate(async (client) => {
      const before = await client.query(
        `SELECT user_id, method, restored_at, restored_by FROM public.account_deletion_log WHERE user_id = $1 AND restored_at IS NULL`,
        [result.userId],
      );
      const after = await client.query(
        `UPDATE public.account_deletion_log SET restored_at = now(), restored_by = auth.uid()
         WHERE user_id = $1 AND restored_at IS NULL
         RETURNING user_id, method, restored_at, restored_by`,
        [result.userId],
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: result.userId,
          before: before.rows[0] ?? null,
          after: after.rows[0] ?? null,
        },
      };
    });
  } catch (auditError) {
    // The restore itself already succeeded -- an audit-log write failing
    // here shouldn't be reported as a failed restore to the caller.
    console.error('[admin/account-deletions] restore succeeded but audit write failed:', auditError);
  }

  return {};
}

/**
 * Manual "purge now" -- bypasses the 15-day wait, permanently destroys the
 * encrypted snapshot immediately. Operator-requested (2026-09-09) so test
 * accounts don't have to sit around for two weeks. Same audit table as a
 * cron-driven purge (purged_at set either way); purged_by is what
 * distinguishes an admin-triggered purge from the scheduled job's.
 */
export async function purgeAccountNow(graceId: string): Promise<{ error?: string }> {
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
    return { error: 'You do not have permission to purge accounts.' };
  }

  const result = await purgeGraceNow(graceId);
  if (!result.success || !result.userId) {
    return { error: result.error || 'Could not purge.' };
  }

  try {
    await mutate(async (client) => {
      const before = await client.query(
        `SELECT user_id, method, purged_at, purged_by FROM public.account_deletion_log WHERE user_id = $1 AND purged_at IS NULL`,
        [result.userId],
      );
      const after = await client.query(
        `UPDATE public.account_deletion_log SET purged_at = now(), purged_by = auth.uid()
         WHERE user_id = $1 AND purged_at IS NULL
         RETURNING user_id, method, purged_at, purged_by`,
        [result.userId],
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'delete' as const,
          targetId: result.userId,
          before: before.rows[0] ?? null,
          after: after.rows[0] ?? null,
        },
      };
    });
  } catch (auditError) {
    console.error('[admin/account-deletions] purge succeeded but audit write failed:', auditError);
  }

  return {};
}
