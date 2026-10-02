'use server';

import { revalidatePath } from 'next/cache';

import { validateCompany, type CompanyProfile } from '@/lib/company';

import { mutate } from '../../lib/db';
import { FieldError, toFormState, type FormState } from '../../lib/form';

/**
 * Company identity write path.
 *
 * Through mutate() like every other admin write, so the capability check and
 * the audit row happen in one transaction. This is the record every invoice and
 * legal page is built from — a change to it should be attributable.
 */

const FIELDS = [
  'legal_name', 'brand_name', 'entity_type', 'cin', 'gstin', 'pan',
  'address_line1', 'address_line2', 'city', 'state_code', 'postal_code', 'country',
  'email', 'phone', 'map_embed_url', 'map_link_url',
] as const;

const UPPERCASE = new Set(['gstin', 'pan', 'cin']);

export async function saveCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const patch: Record<string, string | null> = {};
    for (const f of FIELDS) {
      const raw = String(formData.get(f) ?? '').trim();
      patch[f] = raw ? (UPPERCASE.has(f) ? raw.toUpperCase() : raw) : null;
    }

    // Same validator the form runs, so a rule is written once and cannot drift
    // between the two.
    const errors = validateCompany(patch as Partial<CompanyProfile>);
    const first = Object.entries(errors)[0];
    if (first) throw new FieldError(first[0], first[1]);

    await mutate(async (client) => {
      const before = await client.query('SELECT * FROM public.company_profile WHERE id = 1');
      const sets = FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ');
      const after = await client.query(
        `UPDATE public.company_profile SET ${sets}, updated_at = now() WHERE id = 1 RETURNING *`,
        FIELDS.map((f) => patch[f]),
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: 'company_profile',
          before: before.rows[0],
          after: after.rows[0],
        },
      };
    });

    // Everything that prints the company identity.
    for (const path of ['/', '/terms', '/privacy', '/refund-policy', '/data-deletion', '/contact']) {
      revalidatePath(path);
    }
    revalidatePath('/admin/settings/company-info');

    return { success: 'Saved. Invoices and legal pages now use these details.' };
  } catch (error) {
    return toFormState(error, 'Could not save the company details.');
  }
}
