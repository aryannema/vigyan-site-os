'use client';

import { useActionState } from 'react';

import { SubmitButton } from '../../components/SubmitButton';
import type { FormState } from '../../lib/form';

interface Count { source: string; version: number; row_count: number }
interface Rotation {
  id: string; from_version: number | null; to_version: number;
  started_at: string; completed_at: string | null; status: string;
  rows_total: number; rows_rotated: number; actor: string; error: string | null;
}

export function RotationPanel({
  counts, history, current, action,
}: {
  counts: Count[]; history: Rotation[]; current: number;
  action: (s: FormState) => Promise<FormState>;
}) {
  const [state, run] = useActionState(action, {} as FormState);

  const stale = counts.filter((c) => c.version !== current);
  const staleVersions = [...new Set(stale.map((c) => c.version))];
  const allCurrent = stale.length === 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-ink">Where things stand</h2>

        <div className={`rounded-ui-md border px-4 py-3 text-sm ${
          allCurrent
            ? 'border-green-600/30 bg-green-600/10 text-green-700'
            : 'border-amber-600/30 bg-amber-600/10 text-amber-700'}`}>
          {allCurrent ? (
            <>Everything is encrypted with key <strong>v{current}</strong>. Any older key can
            safely be removed from the environment.</>
          ) : (
            <>Some values are still on key {staleVersions.map((v) => `v${v}`).join(', ')}.{' '}
            <strong>Do not remove those keys</strong> — the rows below cannot be read without
            them, and there is no recovery.</>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2 font-semibold">Stored in</th>
              <th className="py-2 font-semibold">Key</th>
              <th className="py-2 text-right font-semibold">Values</th>
            </tr>
          </thead>
          <tbody>
            {counts.length === 0 ? (
              <tr><td colSpan={3} className="py-3 text-xs text-muted">Nothing encrypted yet.</td></tr>
            ) : counts.map((c) => (
              <tr key={`${c.source}-${c.version}`} className="border-t border-hairline">
                <td className="py-2 font-mono text-xs">{c.source}</td>
                <td className="py-2">
                  <span className={c.version === current ? 'text-green-700' : 'font-semibold text-amber-700'}>
                    v{c.version}{c.version === current && ' (current)'}
                  </span>
                </td>
                <td className="py-2 text-right">{c.row_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 rounded-card border border-hairline bg-sand p-5">
        <h2 className="text-lg font-bold text-ink">Rotate to a new key</h2>

        {/* The steps are here rather than in a document, because getting the
            order wrong is what makes data permanently unreadable. */}
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Generate one: <code className="font-mono text-xs text-ink">openssl rand -hex 32</code>
          </li>
          <li>
            Add it to the server environment as{' '}
            <code className="font-mono text-xs text-ink">CONFIG_ENCRYPTION_KEY_V{current + 1}</code>,
            and set{' '}
            <code className="font-mono text-xs text-ink">CONFIG_ENCRYPTION_KEY_CURRENT={current + 1}</code>.
            <strong className="text-ink"> Keep the existing key.</strong> It is still needed to
            read what has not moved yet.
          </li>
          <li>Restart the app, then come back here and press the button below.</li>
          <li>
            Only once the table above shows <strong>nothing</strong> on the old version, remove
            that key from the environment.
          </li>
        </ol>

        <p className="text-xs text-amber-700">
          Removing a key while values still use it makes them unreadable permanently. There is no
          recovery — not from a backup, because the backup is encrypted with the same key.
        </p>

        {state?.error && (
          <p role="alert" className="rounded-ui-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">
            {state.error}
          </p>
        )}
        {state?.success && (
          <p className="rounded-ui-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm font-semibold text-green-700">
            {state.success}
          </p>
        )}

        <form action={run}>
          <SubmitButton pendingLabel="Re-encrypting…" disabled={allCurrent}>
            {allCurrent ? `Already on v${current}` : `Re-encrypt everything onto v${current}`}
          </SubmitButton>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-ink">Rotation history</h2>
        {history.length === 0 ? (
          <p className="text-xs text-muted">No rotation has been run.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-faint">
                  {new Date(h.started_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                <span className={`font-semibold ${
                  h.status === 'completed' ? 'text-green-700'
                  : h.status === 'failed' ? 'text-red-600' : 'text-amber-700'}`}>
                  {h.status}
                </span>
                <span className="text-muted">
                  v{h.from_version ?? '?'} → v{h.to_version} · {h.rows_rotated}/{h.rows_total} values
                </span>
                <span className="text-muted">by {h.actor}</span>
                {h.error && <span className="text-red-600">— {h.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
