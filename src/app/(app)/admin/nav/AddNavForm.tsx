'use client';

import { useActionState, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

import { SubmitButton } from '../components/SubmitButton';
import type { FormState } from '../lib/form';
import { addNavItem } from './actions';

export type PageOption = { group: string; label: string; value: string; hint: string };
export type ParentOption = { id: string; label: string };

export function AddNavForm({ pages, parents }: { pages: PageOption[]; parents: ParentOption[] }) {
  const [state, action] = useActionState(addNavItem, {} as FormState);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [href, setHref] = useState('');
  const errors = state.fieldErrors ?? {};
  const groups = Array.from(new Set(pages.map((p) => p.group)));

  return (
    <form action={action} className="rounded-2xl border border-hairline bg-surface p-5 md:p-6">
      <h2 className="text-sm font-bold text-ink">Add a menu item</h2>
      <p className="mt-0.5 text-xs text-muted">Pick a page to link to, or type your own address. Choose a parent to make it a submenu item.</p>

      {state.error && !Object.keys(errors).length ? <p className="mt-3 text-sm font-semibold text-destructive">{state.error}</p> : null}
      {state.success ? <p className="mt-3 text-sm font-semibold text-ink">{state.success}</p> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target">Link to</Label>
          <Select
            id="target"
            name="target"
            value={target}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setTarget(v);
              const p = pages.find((x) => x.value === v);
              if (p && !label) setLabel(p.label);
            }}
          >
            <option value="">Choose a page…</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {pages.filter((p) => p.group === g).map((p) => (
                  <option key={p.value} value={p.value}>{p.label} — {p.hint}</option>
                ))}
              </optgroup>
            ))}
            <option value="custom">Another address…</option>
          </Select>
          {errors.target ? <p className="text-xs text-destructive">{errors.target}</p> : null}
          <p className="text-xs text-muted">Pages and products stay linked if you rename them, and leave the menu on their own when unpublished.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="parent_id">Show under</Label>
          <Select id="parent_id" name="parent_id" defaultValue="">
            <option value="">Top of the menu</option>
            {parents.map((p) => <option key={p.id} value={p.id}>Submenu of {p.label}</option>)}
          </Select>
          {errors.parent_id ? <p className="text-xs text-destructive">{errors.parent_id}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label">Label</Label>
          <Input id="label" name="label" required maxLength={40} value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
          {errors.label ? <p className="text-xs text-destructive">{errors.label}</p> : null}
        </div>
        {target === 'custom' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="href">Address</Label>
            <Input id="href" name="href" required placeholder="/some-path or https://…" value={href} onChange={(e) => setHref(e.currentTarget.value)} />
            {errors.href ? <p className="text-xs text-destructive">{errors.href}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="mt-5"><SubmitButton>Add to menu</SubmitButton></div>
    </form>
  );
}
