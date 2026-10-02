'use client';

import { useActionState, useState } from 'react';

import { dinLookupUrl, validateDirector, type Director } from '@/lib/company-private-schema';

import { SubmitButton } from '../../components/SubmitButton';
import type { FormState } from '../../lib/form';

type Action = (s: FormState, f: FormData) => Promise<FormState>;

const ROLES = [
  { value: 'director', label: 'Director' },
  { value: 'managing_director', label: 'Managing Director' },
  { value: 'shareholder', label: 'Shareholder (not a director)' },
  { value: 'nominee', label: 'Nominee' },
];

function DirectorForm({
  director, save, remove, onDone,
}: {
  director?: Director;
  save: Action;
  remove: Action;
  onDone?: () => void;
}) {
  const [saveState, saveAction] = useActionState(save, {} as FormState);
  const [delState, delAction] = useActionState(remove, {} as FormState);
  const [v, setV] = useState({
    full_name: director?.full_name ?? '',
    parentage: director?.parentage ?? '',
    din: director?.din ?? '',
    shareholding_percent:
      director?.shareholding_bp != null ? String(director.shareholding_bp / 100) : '',
    role: director?.role ?? 'director',
    appointed_on: director?.appointed_on ?? '',
    is_active: director?.is_active ?? true,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const errors = validateDirector({
    full_name: v.full_name,
    din: v.din || undefined,
    shareholding_bp: v.shareholding_percent ? Math.round(Number(v.shareholding_percent) * 100) : null,
  });
  const err = (k: string) => errors[k] ?? saveState.fieldErrors?.[k];
  const state = saveState.error || saveState.success ? saveState : delState;

  return (
    <div className="rounded-card border border-hairline bg-card p-4">
      <form action={saveAction} onSubmit={() => onDone?.()} className="space-y-4">
        {director && <input type="hidden" name="id" value={director.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-[13px] font-semibold text-ink">Full name</label>
            <input name="full_name" value={v.full_name}
              onChange={(e) => setV({ ...v, full_name: e.target.value })}
              placeholder="Founder Name"
              className={`rounded-ui-md border bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary ${err('full_name') ? 'border-red-500' : 'border-input'}`} />
            <span className={`min-h-4 text-xs ${err('full_name') ? 'text-red-600' : 'text-muted'}`}>
              {err('full_name') || 'As filed with the MCA.'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-ink">Parentage</label>
            <input name="parentage" value={v.parentage}
              onChange={(e) => setV({ ...v, parentage: e.target.value })}
              placeholder="S/O Parent Name"
              className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary" />
            <span className="min-h-4 text-xs text-muted">As it appears on the filing.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-ink">DIN</label>
            <input name="din" value={v.din} inputMode="numeric"
              onChange={(e) => setV({ ...v, din: e.target.value.replace(/\D/g, '') })}
              placeholder="11782334" maxLength={8}
              className={`rounded-ui-md border bg-card px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary ${err('din') ? 'border-red-500' : 'border-input'}`} />
            <span className={`min-h-4 text-xs ${err('din') ? 'text-red-600' : 'text-muted'}`}>
              {err('din') || (
                v.din.length === 8 ? (
                  <>
                    8 digits, unique.{' '}
                    {/* No free API verifies a DIN -- the MCA portal needs a session
                        and blocks automated requests. So this opens the official
                        record for a human to check. */}
                    <a href={dinLookupUrl(v.din)} target="_blank" rel="noopener noreferrer"
                       className="font-semibold text-saffron-ink underline-offset-2 hover:underline">
                      Check on the MCA portal ↗
                    </a>
                  </>
                ) : 'Exactly 8 digits. Must be unique.'
              )}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-ink">Shareholding %</label>
            <input name="shareholding_percent" value={v.shareholding_percent} inputMode="decimal"
              onChange={(e) => setV({ ...v, shareholding_percent: e.target.value })}
              placeholder="99"
              className={`rounded-ui-md border bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary ${err('shareholding_bp') ? 'border-red-500' : 'border-input'}`} />
            <span className={`min-h-4 text-xs ${err('shareholding_bp') ? 'text-red-600' : 'text-muted'}`}>
              {err('shareholding_bp') || 'Leave blank for a non-shareholding director.'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-ink">Role</label>
            <select name="role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}
              className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <span className="min-h-4 text-xs text-muted" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-ink">Appointed on</label>
            <input name="appointed_on" type="date" value={v.appointed_on}
              onChange={(e) => setV({ ...v, appointed_on: e.target.value })}
              className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary" />
            <span className="min-h-4 text-xs text-muted" />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input type="checkbox" name="is_active" checked={v.is_active}
              onChange={(e) => setV({ ...v, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-input" />
            Currently serving
            <span className="text-xs text-muted">
              — uncheck when someone resigns; the record and its history are kept.
            </span>
          </label>
        </div>

        {state?.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
        {state?.success && <p className="text-xs font-semibold text-green-700">{state.success}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={Object.keys(errors).length > 0}>
            {director ? 'Save changes' : 'Add director'}
          </SubmitButton>
        </div>
      </form>

      {director && (
        <form action={delAction} className="mt-3 border-t border-hairline pt-3">
          <input type="hidden" name="id" value={director.id} />
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="text-xs font-semibold text-red-600 underline-offset-2 hover:underline">
              Remove from the register
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted">
                Removing deletes the record. If they resigned, uncheck “currently serving”
                instead — that keeps the history.
              </span>
              <SubmitButton variant="destructive">Yes, remove</SubmitButton>
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="text-xs font-semibold text-muted hover:text-ink">Cancel</button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

export function DirectorsPanel({
  directors, totalBp, save, remove,
}: {
  directors: Director[];
  totalBp: number;
  save: Action;
  remove: Action;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Reported, not enforced: during a share transfer the total legitimately
          passes through values that are not 100%, and blocking the save would
          make a correct workflow impossible. */}
      <div className={`rounded-ui-md border px-4 py-3 text-sm ${
        totalBp === 10000
          ? 'border-green-600/30 bg-green-600/10 text-green-700'
          : 'border-amber-600/30 bg-amber-600/10 text-amber-700'}`}>
        Total shareholding: <strong>{(totalBp / 100).toFixed(2)}%</strong>
        {totalBp !== 10000 && ' — does not add up to 100%. Fine mid-transfer, worth checking otherwise.'}
      </div>

      {directors.map((d) => (
        <div key={d.id}>
          {editing === d.id ? (
            <DirectorForm director={d} save={save} remove={remove} onDone={() => setEditing(null)} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-card p-4">
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {d.full_name}
                  {!d.is_active && <span className="ml-2 text-xs font-normal text-muted">(no longer serving)</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {d.parentage && `${d.parentage} · `}
                  {d.din && <span className="font-mono">DIN {d.din}</span>}
                  {d.shareholding_bp != null && ` · ${(d.shareholding_bp / 100).toFixed(2)}%`}
                  {` · ${ROLES.find((r) => r.value === d.role)?.label ?? d.role}`}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(d.id)}
                className="text-xs font-semibold text-saffron-ink underline-offset-2 hover:underline">
                Edit
              </button>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <DirectorForm save={save} remove={remove} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="rounded-ui-lg border border-dashed border-input px-4 py-3 text-sm font-semibold text-muted transition hover:border-primary hover:text-ink">
          + Add a director or shareholder
        </button>
      )}
    </div>
  );
}
