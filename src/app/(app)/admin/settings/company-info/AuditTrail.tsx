/**
 * Recent changes to the company record.
 *
 * Reads public.action_audit_log, the same table every other admin write lands
 * in — this is a view onto the existing audit system, not a second one.
 *
 * Renders WHAT changed, never the values. The audit rows for banking already
 * store a fingerprint rather than an account number, but a page that dumped
 * before/after JSON would put the rest of the record on screen for anyone
 * looking over a shoulder.
 */

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

const TARGET_LABEL: Record<string, string> = {
  company_profile: 'Company details',
  company_banking: 'Banking',
  company_bank_account: 'Bank account number',
};

const ACTION_LABEL: Record<string, string> = {
  create: 'added',
  edit: 'changed',
  delete: 'removed',
  view: 'viewed',
};

/** Which fields differ, by name only. */
function changedFields(row: AuditRow): string[] {
  const before = row.before_data ?? {};
  const after = row.after_data ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const skip = new Set(['updated_at', 'created_at', 'id', 'position']);
  return [...keys]
    .filter((k) => !skip.has(k))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => k.replace(/_/g, ' '));
}

export function AuditTrail({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="rounded-card border border-hairline bg-sand p-5">
      <h2 className="text-lg font-bold text-ink">Activity</h2>
      <p className="mt-1 text-xs text-muted">
        From <code className="font-mono">action_audit_log</code>. Every change here writes a row
        in the same transaction as the change itself, so the two cannot come apart. Field names
        are shown, never values.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-xs text-muted">No recorded activity yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {rows.map((r) => {
            const fields = changedFields(r);
            const target =
              TARGET_LABEL[r.target_id ?? ''] ??
              (r.after_data?.full_name as string) ??
              (r.before_data?.full_name as string) ??
              'Record';
            return (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span className="font-mono text-faint">
                  {new Date(r.created_at).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                <span className="font-semibold text-ink">{target}</span>
                <span className="text-muted">{ACTION_LABEL[r.action] ?? r.action}</span>
                <span className="text-muted">by {r.actor}</span>
                {fields.length > 0 && (
                  <span className="text-faint">— {fields.slice(0, 6).join(', ')}
                    {fields.length > 6 && ` and ${fields.length - 6} more`}</span>
                )}
                {r.after_data?.account_number_changed ? (
                  <span className="font-mono text-amber-700">
                    account number replaced ({String(r.after_data.account_number_changed)})
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
