'use client';

import { useActionState, useState } from 'react';

import { ACCOUNT_TYPES, validateAccount, type CompanyAccount } from '@/lib/company-private-schema';

import { SubmitButton } from '../../components/SubmitButton';
import type { FormState } from '../../lib/form';

type Action = (s: FormState, f: FormData) => Promise<FormState>;

function AccountForm({ account, save, onDone }: {
  account?: CompanyAccount; save: Action; onDone?: () => void;
}) {
  const [state, action] = useActionState(save, {} as FormState);
  const isNew = !account;
  const [v, setV] = useState({
    label: account?.label ?? '', bank_name: account?.bank_name ?? '',
    bank_branch: account?.bank_branch ?? '', ifsc: account?.ifsc ?? '',
    micr: account?.micr ?? '', swift: account?.swift ?? '',
    account_type: account?.account_type ?? 'current', purpose: account?.purpose ?? '',
    currency: account?.currency ?? 'INR', is_active: account?.is_active ?? true,
    account_number: '',
  });

  const errors = validateAccount(v, { isNew });
  const err = (k: string) => errors[k] ?? state.fieldErrors?.[k];

  const F = ({ name, label, hint, placeholder, upper, mono, wide }: {
    name: keyof typeof v; label: string; hint?: string;
    placeholder?: string; upper?: boolean; mono?: boolean; wide?: boolean;
  }) => (
    <div className={`flex flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="text-[13px] font-semibold text-ink">{label}</label>
      <input name={name} value={String(v[name])} placeholder={placeholder} autoComplete="off"
        onChange={(e) => setV({ ...v, [name]: upper ? e.target.value.toUpperCase() : e.target.value })}
        className={`rounded-ui-md border bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary ${
          err(name) ? 'border-red-500' : 'border-input'} ${mono ? 'font-mono' : ''}`} />
      <span className={`min-h-4 text-xs ${err(name) ? 'text-red-600' : 'text-muted'}`}>
        {err(name) || hint || ''}
      </span>
    </div>
  );

  return (
    <form action={action} onSubmit={() => onDone?.()} className="space-y-4 rounded-card border border-hairline bg-card p-4">
      {account && <input type="hidden" name="id" value={account.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <F name="label" label="Name" wide placeholder="Settlement account"
           hint="How you will recognise it in this list." />
        <F name="bank_name" label="Bank" placeholder="Kotak Mahindra Bank" />
        <F name="bank_branch" label="Branch" placeholder="Bangalore JP Nagar 7th Phase" />
        <F name="ifsc" label="IFSC" upper mono placeholder="KKBK0008128"
           hint="11 characters; the fifth is always a zero." />
        <F name="micr" label="MICR" mono placeholder="560485117" hint="9 digits, from a cheque leaf." />
        <F name="swift" label="SWIFT / BIC" upper mono placeholder="KKBKINBB"
           hint="Only for foreign inward remittance. 8 or 11 characters." />

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-ink">Type</label>
          <select name="account_type" value={v.account_type}
            onChange={(e) => setV({ ...v, account_type: e.target.value })}
            className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary">
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <span className="min-h-4 text-xs text-muted" />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-[13px] font-semibold text-ink">
            Account number
            {account && <span className="ml-2 font-mono font-normal text-muted">currently ••••{account.account_number_last4}</span>}
          </label>
          <input name="account_number" value={v.account_number} inputMode="numeric" autoComplete="off"
            placeholder={account ? 'Leave blank to keep it' : '0150836818'}
            onChange={(e) => setV({ ...v, account_number: e.target.value.replace(/\D/g, '') })}
            className={`rounded-ui-md border bg-card px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary ${err('account_number') ? 'border-red-500' : 'border-input'}`} />
          <span className={`min-h-4 text-xs ${err('account_number') ? 'text-red-600' : 'text-muted'}`}>
            {err('account_number') || 'Encrypted before it is stored.'}
          </span>
        </div>

        <F name="purpose" label="Used for" wide placeholder="Razorpay settlements" />

        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" name="is_active" checked={v.is_active}
            onChange={(e) => setV({ ...v, is_active: e.target.checked })}
            className="h-4 w-4 rounded border-input" />
          Active
          <span className="text-xs text-muted">— uncheck a closed account instead of deleting it.</span>
        </label>
      </div>

      {state?.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs font-semibold text-green-700">{state.success}</p>}

      <SubmitButton disabled={Object.keys(errors).length > 0}>
        {isNew ? 'Add account' : 'Save changes'}
      </SubmitButton>
    </form>
  );
}

export function AccountsPanel({ accounts, save, setPrimary, reveal }: {
  accounts: CompanyAccount[]; save: Action; setPrimary: Action; reveal: Action;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [primaryState, primaryAction] = useActionState(setPrimary, {} as FormState);
  const [revealState, revealAction] = useActionState(reveal, {} as FormState);
  const [revealed, setRevealed] = useState<string | null>(null);

  const hasPrimary = accounts.some((a) => a.is_primary && a.is_active);

  return (
    <div className="space-y-4">
      {!hasPrimary && accounts.length > 0 && (
        <p className="rounded-ui-md border border-amber-600/30 bg-amber-600/10 px-4 py-3 text-sm text-amber-700">
          No account is marked primary, so nothing tells the business where settlements should
          go. Mark one below.
        </p>
      )}
      {primaryState?.success && <p className="text-xs font-semibold text-green-700">{primaryState.success}</p>}
      {primaryState?.error && <p className="text-xs font-semibold text-red-600">{primaryState.error}</p>}

      {accounts.map((a) => editing === a.id ? (
        <AccountForm key={a.id} account={a} save={save} onDone={() => setEditing(null)} />
      ) : (
        <div key={a.id} className={`rounded-card border bg-card p-4 ${a.is_primary && a.is_active ? 'border-saffron-500/40' : 'border-hairline'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                {a.label}
                {a.is_primary && a.is_active && (
                  <span className="rounded-full bg-saffron-500/15 px-2 py-0.5 text-[11px] font-bold text-saffron-ink">
                    PRIMARY — settlements go here
                  </span>
                )}
                {!a.is_active && <span className="text-xs font-normal text-muted">(closed)</span>}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {a.bank_name}{a.bank_branch && `, ${a.bank_branch}`}
                {' · '}<span className="font-mono">••••{a.account_number_last4}</span>
                {a.ifsc && <> · <span className="font-mono">{a.ifsc}</span></>}
                {a.purpose && ` · ${a.purpose}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
              <button type="button" onClick={() => setEditing(a.id)}
                className="font-semibold text-saffron-ink underline-offset-2 hover:underline">Edit</button>

              <form action={revealAction} onSubmit={() => setRevealed(a.id)}>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
                  Show number
                </button>
              </form>

              {!a.is_primary && a.is_active && (
                <form action={primaryAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
                    Make primary
                  </button>
                </form>
              )}
            </div>
          </div>

          {revealed === a.id && revealState?.revealed && (
            <div className="mt-3 rounded-ui-md border border-amber-600/30 bg-amber-600/10 p-3">
              <code className="font-mono text-sm text-ink">{revealState.revealed}</code>
              <p className="mt-1 text-xs text-amber-700">{revealState.success}</p>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <AccountForm save={save} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="rounded-ui-lg border border-dashed border-input px-4 py-3 text-sm font-semibold text-muted transition hover:border-primary hover:text-ink">
          + Add a bank account
        </button>
      )}
    </div>
  );
}
