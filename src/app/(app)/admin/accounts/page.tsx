import { query } from '../lib/db';
import { PageHeader } from '../components/PageHeader';
import { AccountsTable, type AccountRow } from './AccountsTable';

export const dynamic = 'force-dynamic';

/**
 * Registered site users (public.site_accounts -- the self-service checkout/
 * order-history tier, deliberately outside admin_users/RBAC, see 011's
 * header). Distinct from /admin/crm (contact-form/blueprint inquiries) and
 * /admin/whatsapp (bot conversations) -- this is the actual account roster.
 *
 * Delete here reuses the same executeAccountDeletion() executor as the
 * user-initiated self-service/dual-channel-verified flows (src/lib/
 * account-deletion.ts) -- anonymizes rather than hard-deletes, 15-day
 * admin-recoverable grace period via /admin/account-deletions, exactly the
 * same safety properties, just an admin-initiated third caller.
 */
export default async function AccountsPage() {
  const accounts = await query<AccountRow>(`
    SELECT
      sa.user_id,
      sa.email,
      sa.first_name,
      sa.last_name,
      sa.whatsapp_number,
      sa.whatsapp_verified_at,
      sa.created_at,
      sa.deleted_at,
      COUNT(o.id)::int AS order_count,
      adg.purge_after
    FROM public.site_accounts sa
    LEFT JOIN public.orders o ON o.user_id = sa.user_id
    LEFT JOIN public.account_deletion_grace adg ON adg.user_id = sa.user_id
    GROUP BY sa.user_id, sa.email, sa.first_name, sa.last_name, sa.whatsapp_number,
             sa.whatsapp_verified_at, sa.created_at, sa.deleted_at, adg.purge_after
    ORDER BY sa.created_at DESC
    LIMIT 500
  `);

  const activeCount = accounts.filter((a) => !a.deleted_at).length;

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Everyone who's created a YourSite account (Google or email sign-up). For contact-form/blueprint leads, see All Inquiries; for the WhatsApp bot, see WhatsApp."
      />

      <p className="mb-4 text-sm text-muted">{activeCount} active accounts, {accounts.length - activeCount} deleted</p>

      <AccountsTable accounts={accounts} />
    </>
  );
}
