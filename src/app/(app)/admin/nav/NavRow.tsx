'use client';

import { useState } from 'react';

import { deleteNavItem, moveNavItem, toggleNavItem, updateNavItem } from './actions';

export type NavRowData = {
  id: string; label: string; target_type: string; target: string; note: string | null; enabled: boolean; flag: string | null;
  isFirst: boolean; isLast: boolean; child: boolean; childCount: number;
};

const iconBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-sm text-muted transition hover:bg-sand hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';

export function NavRow({ row }: { row: NavRowData }) {
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);

  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${row.child ? 'ml-8 border-l-2 border-hairline' : ''} ${row.enabled ? '' : 'opacity-50'}`}>
      {editing ? (
        <form action={async (fd) => { await updateNavItem(fd); setEditing(false); }} className="flex flex-1 flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input name="label" defaultValue={row.label} maxLength={40} required aria-label="Label" className="h-9 w-40 rounded-lg border border-input bg-card px-3 text-sm" />
          {row.target_type === 'route' || row.target_type === 'url' ? (
            <input name="href" defaultValue={row.target} required aria-label="Address" className="h-9 min-w-[200px] flex-1 rounded-lg border border-input bg-card px-3 font-mono text-xs" />
          ) : (
            <span className="min-w-[200px] flex-1 truncate font-mono text-[11px] text-muted">{row.target}</span>
          )}
          <button className="h-9 rounded-lg bg-brand-primary px-4 text-xs font-bold text-[#1c1814]">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted hover:text-ink">Cancel</button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {row.label}
            {row.flag ? <span className="ml-2 rounded-full bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">flag: {row.flag}</span> : null}
            {!row.child && row.childCount > 0 ? <span className="ml-2 rounded-full bg-brand-primary/15 px-2 py-0.5 text-[10px] font-bold text-saffron-ink">{row.childCount} in submenu</span> : null}
          </p>
          <p className="truncate font-mono text-[11px] text-muted">{row.target}</p>
          {row.note ? <p className="mt-0.5 text-[11px] font-semibold text-amber-600">{row.note}</p> : null}
        </div>
      )}

      {!editing && (
        <div className="flex items-center gap-1.5">
          <form action={moveNavItem}><input type="hidden" name="id" value={row.id} /><input type="hidden" name="dir" value="up" />
            <button className={iconBtn} disabled={row.isFirst} aria-label={`Move ${row.label} up`}>↑</button></form>
          <form action={moveNavItem}><input type="hidden" name="id" value={row.id} /><input type="hidden" name="dir" value="down" />
            <button className={iconBtn} disabled={row.isLast} aria-label={`Move ${row.label} down`}>↓</button></form>
          <form action={toggleNavItem}><input type="hidden" name="id" value={row.id} />
            <button className="h-8 rounded-lg border border-hairline px-3 text-xs font-semibold text-muted transition hover:bg-sand hover:text-ink">{row.enabled ? 'Hide' : 'Show'}</button></form>
          <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-lg border border-hairline px-3 text-xs font-semibold text-saffron-ink transition hover:bg-sand">Edit</button>
          {armed ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="text-muted">{row.childCount > 0 ? `Delete with ${row.childCount} submenu item(s)?` : 'Delete?'}</span>
              <button type="button" onClick={() => deleteNavItem(row.id)} className="font-bold text-red-500">Yes</button>
              <button type="button" onClick={() => setArmed(false)} className="text-muted hover:text-ink">No</button>
            </span>
          ) : (
            <button type="button" onClick={() => setArmed(true)} className="h-8 px-2 text-xs text-red-500/60 transition hover:text-red-500">Delete</button>
          )}
        </div>
      )}
    </div>
  );
}
