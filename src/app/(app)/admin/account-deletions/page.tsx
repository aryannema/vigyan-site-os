import { query } from '../lib/db';
import { RestoreButton } from './RestoreButton';

export const dynamic = 'force-dynamic';

interface GraceRow {
  id: string;
  user_id: string;
  purge_after: string;
  created_at: string;
}

interface LogRow {
  user_id: string;
  method: string;
  requested_at: string;
  email_verified_at: string | null;
  whatsapp_verified_at: string | null;
}

/**
 * Account deletions — the admin-facing side of the 15-day grace period
 * (migration 022, src/lib/account-deletion.ts). Lists accounts currently
 * within their recoverable window; restoring undoes the anonymization and
 * lifts the login ban. Nothing shown here reveals the actual PII (it stays
 * encrypted at rest, only decrypted transiently during a restore) — this
 * page deliberately can't be used to browse deleted people's data, only to
 * reverse a specific deletion by its opaque grace-record id.
 */
export default async function AccountDeletionsPage() {
  const [grace, log] = await Promise.all([
    query<GraceRow>(
      `SELECT id, user_id, purge_after, created_at FROM public.account_deletion_grace ORDER BY purge_after ASC`,
    ),
    query<LogRow>(
      `SELECT user_id, method, requested_at, email_verified_at, whatsapp_verified_at
       FROM public.account_deletion_log WHERE restored_at IS NULL ORDER BY completed_at DESC`,
    ),
  ]);

  const logByUser = new Map(log.map((l) => [l.user_id, l]));

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-ink">Account deletions</h1>
        <p className="mt-2 text-faint">
          Accounts within their 15-day recovery window. After that, a daily job permanently purges the
          encrypted snapshot — restore is no longer possible after that point.
        </p>
      </div>

      <section className="rounded-2xl border border-hairline bg-surface p-8">
        {grace.length === 0 ? (
          <p className="text-sm text-muted">No accounts currently pending permanent deletion.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {grace.map((row) => {
              const meta = logByUser.get(row.user_id);
              const daysLeft = Math.max(
                0,
                Math.ceil((new Date(row.purge_after).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
              );
              return (
                <li key={row.id} className="flex items-center justify-between py-4">
                  <div>
                    <p className="font-mono text-xs text-ink">{row.user_id}</p>
                    <p className="mt-1 text-xs text-muted">
                      {meta?.method === 'self_service' ? 'Self-service deletion' : 'Dual-channel-verified request'}
                      {' · '}
                      {daysLeft} day{daysLeft === 1 ? '' : 's'} left to restore
                    </p>
                  </div>
                  <RestoreButton graceId={row.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
