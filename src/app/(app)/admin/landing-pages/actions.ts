'use server';

/**
 * Landing-page write path. Goes through mutate() (capability check + audit row),
 * then revalidateFor() so the page, sitemap, Cloudflare edge and Bing/Yandex
 * (IndexNow) / Google (sitemap resubmit) all move together -- no build, no deploy.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { revalidateFor } from '@/lib/content-revalidation';
import { landingPageInputSchema, type LandingPageInput } from '@/lib/landing-pages';

import { mutate, query, toFormError } from '../lib/db';
import { FieldError, toFormState, type FormState } from '../lib/form';

type Row = { id: string; slug: string; status: string; title?: string };

/** Menu placement for a page: none, top level, or under an existing top-level item. */
function readMenu(formData: FormData, title: string): { parent: string | null; label: string } {
  const parent = String(formData.get('menu_parent') ?? '').trim() || null;
  const label = String(formData.get('menu_label') ?? '').trim() || title.slice(0, 40);
  if (label.length > 40) throw new FieldError('menu_label', 'Keep the menu label to 40 characters.');
  return { parent, label };
}

/** Create, move, relabel or remove the page's menu item. The item links by id, not address. */
async function syncMenu(pageId: string, menu: { parent: string | null; label: string }): Promise<void> {
  await mutate(async (client) => {
    const cur = await client.query<{ id: string }>(
      `SELECT id FROM public.nav_items WHERE landing_page_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [pageId],
    );
    const existing = cur.rows[0];
    if (!menu.parent) {
      if (existing) {
        await client.query(`DELETE FROM public.nav_items WHERE id = $1`, [existing.id]);
      }
      return {
        result: undefined,
        audit: { resourceKey: 'nav', action: 'delete' as const, targetId: existing?.id ?? pageId, before: { landing_page_id: pageId } },
      };
    }
    const parentId = menu.parent === '__top__' ? null : menu.parent;
    if (parentId) {
      const p = await client.query<{ parent_id: string | null }>(`SELECT parent_id FROM public.nav_items WHERE id = $1`, [parentId]);
      if (p.rows.length === 0 || p.rows[0]!.parent_id) throw new Error('Pick a top-level menu item to put this page under.');
    }
    if (existing) {
      await client.query(
        `UPDATE public.nav_items
            SET label = $2, position = CASE WHEN parent_id IS NOT DISTINCT FROM $3 THEN position ELSE
                  (SELECT COALESCE(MAX(position), -1) + 1 FROM public.nav_items WHERE parent_id IS NOT DISTINCT FROM $3) END,
                parent_id = $3, updated_at = now()
          WHERE id = $1`,
        [existing.id, menu.label, parentId],
      );
    } else {
      await client.query(
        `INSERT INTO public.nav_items (label, target_type, landing_page_id, parent_id, position)
         VALUES ($1, 'landing_page', $2, $3,
                 (SELECT COALESCE(MAX(position), -1) + 1 FROM public.nav_items WHERE parent_id IS NOT DISTINCT FROM $3))`,
        [menu.label, pageId, parentId],
      );
    }
    return {
      result: undefined,
      audit: { resourceKey: 'nav', action: 'edit' as const, targetId: existing?.id ?? pageId, after: { landing_page_id: pageId, ...menu } },
    };
  });
  revalidateFor({ kind: 'nav' });
}

function readFields(formData: FormData): LandingPageInput {
  const text = (name: string) => String(formData.get(name) ?? '');

  let body: unknown;
  try {
    body = JSON.parse(text('body') || '[]');
  } catch {
    throw new FieldError('body', 'The page body is not valid JSON.');
  }

  const parsed = landingPageInputSchema.safeParse({
    title: text('title'),
    slug: text('slug'),
    subtitle: text('subtitle'),
    body_blocks: body,
    seo_title: text('seo_title'),
    seo_description: text('seo_description'),
    og_image_url: text('og_image_url'),
    product_id: text('product_id').trim() || null,
    cta_label: text('cta_label'),
    cta_url: text('cta_url'),
    status: text('status') || 'draft',
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = String(issue.path[0] ?? 'title');
    throw new FieldError(field === 'body_blocks' ? 'body' : field, issue.message);
  }
  return parsed.data;
}

function refresh(before: Row | null, after: Row | null) {
  // A rename or unpublish leaves the old URL behind; tell the engines it is gone.
  if (before && before.status === 'published' && (!after || after.slug !== before.slug || after.status !== 'published')) {
    revalidateFor({ kind: 'landing_page', slug: before.slug, deleted: true });
  }
  if (after && after.status === 'published') {
    revalidateFor({ kind: 'landing_page', slug: after.slug });
  }
  revalidatePath('/admin/landing-pages');
}

export async function createLandingPage(_prev: FormState, formData: FormData): Promise<FormState> {
  let created: Row;
  let menu: { parent: string | null; label: string };
  try {
    const f = readFields(formData);
    menu = readMenu(formData, f.title);
    created = await mutate(async (client) => {
      const { rows } = await client.query<Row>(
        `INSERT INTO public.landing_pages
           (slug, title, subtitle, body_blocks, seo_title, seo_description, og_image_url,
            product_id, cta_label, cta_url, status, published_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,
                 CASE WHEN $11 = 'published' THEN now() ELSE NULL END)
         RETURNING *`,
        [f.slug, f.title, f.subtitle, JSON.stringify(f.body_blocks), f.seo_title, f.seo_description,
         f.og_image_url, f.product_id, f.cta_label, f.cta_url, f.status],
      );
      const row = rows[0]!;
      return {
        result: row,
        audit: { resourceKey: 'landing_pages', action: 'create' as const, targetId: row.id, after: row },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  refresh(null, created);
  if (menu.parent) {
    try {
      await syncMenu(created.id, menu);
    } catch (error) {
      console.error('[landing] page saved but menu placement failed:', error);
    }
  }
  redirect(`/admin/landing-pages/${created.id}/edit`);
}

export async function updateLandingPage(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let before: Row | null = null;
  let after: Row;
  let menu: { parent: string | null; label: string };
  try {
    const f = readFields(formData);
    menu = readMenu(formData, f.title);
    const out = await mutate(async (client) => {
      const cur = await client.query<Row>(`SELECT * FROM public.landing_pages WHERE id = $1 FOR UPDATE`, [id]);
      if (cur.rows.length === 0) throw new Error('That page no longer exists.');
      const { rows } = await client.query<Row>(
        `UPDATE public.landing_pages
            SET slug=$2, title=$3, subtitle=$4, body_blocks=$5::jsonb, seo_title=$6,
                seo_description=$7, og_image_url=$8, product_id=$9, cta_label=$10, cta_url=$11,
                status=$12,
                published_at = CASE WHEN $12 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, f.slug, f.title, f.subtitle, JSON.stringify(f.body_blocks), f.seo_title, f.seo_description,
         f.og_image_url, f.product_id, f.cta_label, f.cta_url, f.status],
      );
      return {
        result: { before: cur.rows[0]!, after: rows[0]! },
        audit: {
          resourceKey: 'landing_pages',
          action: 'edit' as const,
          targetId: id,
          before: cur.rows[0],
          after: rows[0],
        },
      };
    });
    before = out.before;
    after = out.after;
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  refresh(before, after);
  try {
    const placed = await query<{ id: string }>(`SELECT id FROM public.nav_items WHERE landing_page_id = $1 LIMIT 1`, [id]);
    if (menu.parent || placed.length > 0) await syncMenu(id, menu);
  } catch (error) {
    return toFormState(error, toFormError(error));
  }
  revalidatePath(`/admin/landing-pages/${id}/edit`);
  return { success: after.status === 'published' ? 'Saved and live. Sitemap, cache and search engines notified.' : 'Saved as draft.' };
}

export async function deleteLandingPage(id: string): Promise<void> {
  const removed = await mutate(async (client) => {
    const { rows } = await client.query<Row>(`DELETE FROM public.landing_pages WHERE id = $1 RETURNING *`, [id]);
    if (rows.length === 0) throw new Error('That page no longer exists.');
    return {
      result: rows[0]!,
      audit: { resourceKey: 'landing_pages', action: 'delete' as const, targetId: id, before: rows[0] },
    };
  });
  refresh(removed, null);
}
