'use server';

/**
 * Header navigation write path. Every change goes through mutate() (capability
 * check + audit row) and then revalidateFor({ kind: 'nav' }), which refreshes
 * the layout and purges the edge cache so the new menu is live without a deploy.
 */

import { revalidatePath } from 'next/cache';

import { revalidateFor } from '@/lib/content-revalidation';

import { mutate, toFormError } from '../lib/db';
import { FieldError, toFormState, type FormState } from '../lib/form';

type Item = { id: string; parent_id: string | null; position: number };

const HREF = /^(\/(?!\/)|https?:\/\/)\S*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Target =
  | { type: 'route' | 'url'; href: string }
  | { type: 'landing_page' | 'product'; id: string };

/** The picker submits `landing_page:<uuid>`, `product:<uuid>`, `route:/about` or `custom`. */
function readTarget(formData: FormData): Target {
  const raw = String(formData.get('target') ?? '');
  if (!raw) throw new FieldError('target', 'Choose where this item should link.');
  const [kind, ...rest] = raw.split(':');
  const ref = rest.join(':');
  if (kind === 'landing_page' || kind === 'product') {
    if (!UUID.test(ref)) throw new FieldError('target', 'Choose where this item should link.');
    return { type: kind, id: ref };
  }
  const href = kind === 'route' ? ref : String(formData.get('href') ?? '').trim();
  if (!HREF.test(href)) throw new FieldError('href', 'Use a path starting with / or a full https:// address.');
  return { type: kind === 'route' || href.startsWith('/') ? 'route' : 'url', href };
}

function done() {
  revalidatePath('/admin/nav');
  revalidateFor({ kind: 'nav' });
}

export async function addNavItem(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const label = String(formData.get('label') ?? '').trim();
    const target = readTarget(formData);
    const parent = String(formData.get('parent_id') ?? '').trim() || null;
    const flag = String(formData.get('flag') ?? '').trim() || null;

    if (!label) throw new FieldError('label', 'Give the menu item a label.');
    if (label.length > 40) throw new FieldError('label', 'Keep the label to 40 characters.');

    await mutate(async (client) => {
      if (parent) {
        const p = await client.query<Item>(`SELECT id, parent_id, position FROM public.nav_items WHERE id = $1`, [parent]);
        if (p.rows.length === 0) throw new FieldError('parent_id', 'That parent item no longer exists.');
        if (p.rows[0]!.parent_id) throw new FieldError('parent_id', 'Menus go two levels deep — pick a top-level item.');
      }
      const pos = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM public.nav_items
          WHERE parent_id IS NOT DISTINCT FROM $1`,
        [parent],
      );
      const { rows } = await client.query(
        `INSERT INTO public.nav_items (label, target_type, href, landing_page_id, product_id, parent_id, position, flag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          label,
          target.type,
          'href' in target ? target.href : null,
          target.type === 'landing_page' ? target.id : null,
          target.type === 'product' ? target.id : null,
          parent,
          pos.rows[0]!.next,
          flag,
        ],
      );
      return {
        result: undefined,
        audit: { resourceKey: 'nav', action: 'create' as const, targetId: rows[0].id, after: rows[0] },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }
  done();
  return { success: 'Added. The header updates within seconds.' };
}

export async function updateNavItem(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const label = String(formData.get('label') ?? '').trim();
  const href = String(formData.get('href') ?? '').trim();
  if (!id || !label || label.length > 40) return;
  if (href && !HREF.test(href)) return;

  await mutate(async (client) => {
    const before = await client.query(`SELECT * FROM public.nav_items WHERE id = $1 FOR UPDATE`, [id]);
    if (before.rows.length === 0) throw new Error('That menu item no longer exists.');
    const { rows } = await client.query(
      `UPDATE public.nav_items
          SET label = $2,
              href = CASE WHEN target_type IN ('route','url') THEN COALESCE(NULLIF($3, ''), href) ELSE NULL END,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, label, href],
    );
    return {
      result: undefined,
      audit: { resourceKey: 'nav', action: 'edit' as const, targetId: id, before: before.rows[0], after: rows[0] },
    };
  });
  done();
}

export async function toggleNavItem(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await mutate(async (client) => {
    const { rows } = await client.query(
      `UPDATE public.nav_items SET enabled = NOT enabled, updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    if (rows.length === 0) throw new Error('That menu item no longer exists.');
    return { result: undefined, audit: { resourceKey: 'nav', action: 'edit' as const, targetId: id, after: rows[0] } };
  });
  done();
}

export async function moveNavItem(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const dir = formData.get('dir') === 'up' ? -1 : 1;
  if (!id) return;

  await mutate(async (client) => {
    const me = await client.query<Item>(`SELECT id, parent_id, position FROM public.nav_items WHERE id = $1`, [id]);
    if (me.rows.length === 0) throw new Error('That menu item no longer exists.');
    const sibs = await client.query<Item>(
      `SELECT id, parent_id, position FROM public.nav_items
        WHERE parent_id IS NOT DISTINCT FROM $1 ORDER BY position, created_at`,
      [me.rows[0]!.parent_id],
    );
    const order = sibs.rows.map((r) => r.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (j >= 0 && j < order.length) {
      [order[i], order[j]] = [order[j]!, order[i]!];
      for (const [pos, sid] of order.entries()) {
        await client.query(`UPDATE public.nav_items SET position = $2, updated_at = now() WHERE id = $1`, [sid, pos]);
      }
    }
    return { result: undefined, audit: { resourceKey: 'nav', action: 'edit' as const, targetId: id, after: { order } } };
  });
  done();
}

export async function deleteNavItem(id: string): Promise<void> {
  await mutate(async (client) => {
    const { rows } = await client.query(`DELETE FROM public.nav_items WHERE id = $1 RETURNING *`, [id]);
    if (rows.length === 0) throw new Error('That menu item no longer exists.');
    return { result: undefined, audit: { resourceKey: 'nav', action: 'delete' as const, targetId: id, before: rows[0] } };
  });
  done();
}
