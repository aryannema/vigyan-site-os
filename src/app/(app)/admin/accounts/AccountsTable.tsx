'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { adminDeleteAccount } from './actions';

export interface AccountRow {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  whatsapp_number: string | null;
  whatsapp_verified_at: string | null;
  created_at: string;
  deleted_at: string | null;
  order_count: number;
  purge_after: string | null;
}

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const name = [a.first_name, a.last_name].filter(Boolean).join(' ').toLowerCase();
      return (
        (a.email || '').toLowerCase().includes(q) ||
        name.includes(q) ||
        (a.whatsapp_number || '').includes(q)
      );
    });
  }, [accounts, query]);

  const handleDelete = (userId: string) => {
    setError(null);
    setDeletingId(userId);
    startTransition(async () => {
      const result = await adminDeleteAccount(userId);
      setDeletingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRemoved((prev) => new Set(prev).add(userId));
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or WhatsApp number…"
          className="w-full max-w-sm rounded-xl border border-hairline-strong bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
        />
        <p className="shrink-0 text-sm text-muted">{filtered.length} of {accounts.length} accounts</p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm font-bold text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">No accounts match.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Name</th>
                  <th className="px-4 py-4 text-left">Contact</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-4 py-4 text-right">Orders</th>
                  <th className="px-4 py-4 text-right">Joined</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered
                  .filter((a) => !removed.has(a.user_id))
                  .map((a) => {
                    const isDeleted = Boolean(a.deleted_at);
                    const pendingPurge = isDeleted && a.purge_after;
                    return (
                      <tr key={a.user_id} className="transition hover:bg-sand">
                        <td className="px-6 py-4">
                          <span className="font-medium text-ink">
                            {isDeleted ? '—' : [a.first_name, a.last_name].filter(Boolean).join(' ') || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-muted">
                          <div>{isDeleted ? '—' : a.email || '—'}</div>
                          <div>
                            {isDeleted ? '—' : a.whatsapp_number || '—'}
                            {a.whatsapp_verified_at ? ' ✓' : ''}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {isDeleted ? (
                            pendingPurge ? (
                              <Link
                                href="/admin/account-deletions"
                                className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:underline"
                              >
                                Deleted · {daysLeft(a.purge_after!)}d to restore
                              </Link>
                            ) : (
                              <span className="rounded-full border border-hairline-strong bg-sand px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                                Deleted
                              </span>
                            )
                          ) : (
                            <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-green-700">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right text-xs text-body">{a.order_count}</td>
                        <td className="px-4 py-4 text-right text-xs text-muted">
                          {new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {!isDeleted && (
                            <button
                              type="button"
                              onClick={() => handleDelete(a.user_id)}
                              disabled={isPending && deletingId === a.user_id}
                              className="text-xs font-bold text-red-600 hover:underline disabled:opacity-50"
                            >
                              {isPending && deletingId === a.user_id ? 'Deleting…' : 'Delete'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
