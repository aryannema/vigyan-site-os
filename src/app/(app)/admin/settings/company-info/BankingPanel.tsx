'use client';

import { useActionState, useState } from 'react';

import { validateBanking, type Banking } from '@/lib/company-private-schema';

import { SubmitButton } from '../../components/SubmitButton';
import type { FormState } from '../../lib/form';

export function BankingPanel({
  banking, save, reveal,
}: {
  banking: Banking | null;
  save: (s: FormState, f: FormData) => Promise<FormState>;
  reveal: (s: FormState) => Promise<FormState>;
}) {
  const [saveState, saveAction] = useActionState(save, {} as FormState);
  const [revState, revealAction] = useActionState(reveal, {} as FormState);
  const [v, setV] = useState({
    tan: banking?.tan ?? '', pan: banking?.pan ?? '',
    bank_name: banking?.bank_name ?? '', bank_branch: banking?.bank_branch ?? '',
    ifsc: banking?.ifsc ?? '', micr: banking?.micr ?? '',
    account_type: banking?.account_type ?? 'current',
    account_number: '',
  });

  const errors = validateBanking(v);
  const err = (k: string) => errors[k] ?? saveState.fieldErrors?.[k];

  const F = ({ name, label, hint, placeholder, upper }: {
    name: keyof typeof v; label: string; hint: string; placeholder?: string; upper?: boolean;
  }) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-ink">{label}</label>
      <input
        name={name} value={v[name]} placeholder={placeholder}
        onChange={(e) => setV({ ...v, [name]: upper ? e.target.value.toUpperCase() : e.target.value })}
        className={`rounded-ui-md border bg-card px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary ${err(name) ? 'border-red-500' : 'border-input'}`}
      />
      <span className={`min-h-4 text-xs ${err(name) ? 'text-red-600' : 'text-muted'}`}>
        {err(name) || hint}
      </span>
    </div>
  );

  return (
    <form action={saveAction} className="space-y-5 rounded-card border border-hairline bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <F name="tan" label="TAN" upper placeholder="BLRV35251G"
           hint="10 characters. Needed to deduct TDS." />
        <F name="pan" label="Company PAN" upper placeholder="AAMCV3593N" hint="10 characters." />
        <F name="bank_name" label="Bank" placeholder="Kotak Mahindra Bank" hint="" />
        <F name="bank_branch" label="Branch" placeholder="Bangalore JP Nagar 7th Phase" hint="" />
        <F name="ifsc" label="IFSC" upper placeholder="KKBK0008128"
           hint="11 characters; the fifth is always a zero." />
        <F name="micr" label="MICR" placeholder="560485117" hint="9 digits, from the cheque leaf." />

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-ink">Account type</label>
          <select name="account_type" value={v.account_type}
            onChange={(e) => setV({ ...v, account_type: e.target.value })}
            className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary">
            <option value="current">Current</option>
            <option value="savings">Savings</option>
          </select>
          <span className="min-h-4 text-xs text-muted" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-ink">
            Account number
            {banking?.account_number_last4 && (
              <span className="ml-2 font-mono font-normal text-muted">
                currently ••••{banking.account_number_last4}
              </span>
            )}
          </label>
          <input
            name="account_number" value={v.account_number} inputMode="numeric" autoComplete="off"
            placeholder={banking?.account_number_last4 ? 'Leave blank to keep it' : '0150836818'}
            onChange={(e) => setV({ ...v, account_number: e.target.value.replace(/\D/g, '') })}
            className={`rounded-ui-md border bg-card px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary ${err('account_number') ? 'border-red-500' : 'border-input'}`}
          />
          <span className={`min-h-4 text-xs ${err('account_number') ? 'text-red-600' : 'text-muted'}`}>
            {err('account_number') || 'Encrypted before storing. Blank leaves the existing one alone.'}
          </span>
        </div>
      </div>

      {saveState.error && <p className="text-xs font-semibold text-red-600">{saveState.error}</p>}
      {saveState.success && <p className="text-xs font-semibold text-green-700">{saveState.success}</p>}

      <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-4">
        <SubmitButton disabled={Object.keys(errors).length > 0}>Save banking details</SubmitButton>
      </div>

      {/* Revealing is a deliberate act and is audited, so it sits apart from
          the form rather than being something a page render does for you. */}
      {banking?.account_number_last4 && (
        <div className="border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => revealAction()}
            className="text-xs font-semibold text-saffron-ink underline-offset-2 hover:underline"
          >
            Show the full account number
          </button>
          {revState?.error && <p className="mt-2 text-xs font-semibold text-red-600">{revState.error}</p>}
          {revState?.revealed && (
            <div className="mt-2 rounded-ui-md border border-amber-600/30 bg-amber-600/10 p-3">
              <code className="font-mono text-sm text-ink">{revState.revealed}</code>
              <p className="mt-1 text-xs text-amber-700">{revState.success}</p>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
