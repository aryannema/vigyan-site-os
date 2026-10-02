'use server';

import { revalidatePath } from 'next/cache';

import { encryptAccountNumber, fingerprint, revealAccountNumber } from '@/lib/company-private';
import { validateBanking, validateDirector } from '@/lib/company-private-schema';

import { mutate } from '../../lib/db';
import { FieldError, toFormState, type FormState } from '../../lib/form';

/**
 * Directors and banking write path.
 *
 * Every action goes through mutate(), which resolves the acting administrator,
 * runs the change and perform_action() in ONE transaction, and refuses when no
 * actor can be resolved. So a change to the shareholding register or the bank
 * account is always attributable to a person.
 *
 * These tables have no grant for anon or authenticated — the browser cannot
 * reach them directly. It can only ask this server code, which checks who is
 * asking before touching anything.
 */

function str(fd: FormData, k: string): string | null {
  const v = String(fd.get(k) ?? '').trim();
  return v || null;
}

export async function saveDirector(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const id = str(formData, 'id');
    const pctRaw = str(formData, 'shareholding_percent');
    const d = {
      full_name: str(formData, 'full_name') ?? '',
      parentage: str(formData, 'parentage'),
      din: str(formData, 'din'),
      // Percent in, basis points stored — so a 33.33% holding is exact.
      shareholding_bp: pctRaw == null ? null : Math.round(Number(pctRaw) * 100),
      role: str(formData, 'role') ?? 'director',
      appointed_on: str(formData, 'appointed_on'),
      is_active: formData.get('is_active') === 'on',
    };

    const errors = validateDirector(d);
    const first = Object.entries(errors)[0];
    if (first) throw new FieldError(first[0], first[1]);

    await mutate(async (client) => {
      if (id) {
        const before = await client.query('SELECT * FROM public.company_directors WHERE id = $1', [id]);
        if (!before.rowCount) throw new Error('That director no longer exists.');
        const after = await client.query(
          `UPDATE public.company_directors
              SET full_name=$2, parentage=$3, din=$4, shareholding_bp=$5,
                  role=$6, appointed_on=$7, is_active=$8
            WHERE id=$1 RETURNING *`,
          [id, d.full_name, d.parentage, d.din, d.shareholding_bp, d.role, d.appointed_on, d.is_active],
        );
        return {
          result: undefined,
          audit: { resourceKey: 'settings', action: 'edit' as const, targetId: id,
                   before: before.rows[0], after: after.rows[0] },
        };
      }
      const inserted = await client.query(
        `INSERT INTO public.company_directors
           (full_name, parentage, din, shareholding_bp, role, appointed_on, is_active, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 COALESCE((SELECT MAX(position)+1 FROM public.company_directors), 0))
         RETURNING *`,
        [d.full_name, d.parentage, d.din, d.shareholding_bp, d.role, d.appointed_on, d.is_active],
      );
      const row = inserted.rows[0];
      return {
        result: undefined,
        audit: { resourceKey: 'settings', action: 'create' as const, targetId: row.id, after: row },
      };
    });

    revalidatePath('/admin/settings/company-info');
    return { success: `${d.full_name} saved.` };
  } catch (error) {
    return toFormState(error, 'Could not save the director.');
  }
}

/**
 * Removes a director.
 *
 * A hard delete, because a director who was never actually appointed is a data
 * entry mistake rather than history. Someone who genuinely resigned should be
 * marked inactive instead, which keeps the record and the audit trail — the UI
 * says so at the point of deletion.
 */
export async function deleteDirector(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const id = str(formData, 'id');
    if (!id) throw new Error('No director specified.');

    let name = '';
    await mutate(async (client) => {
      const deleted = await client.query(
        'DELETE FROM public.company_directors WHERE id = $1 RETURNING *', [id],
      );
      if (!deleted.rowCount) throw new Error('That director no longer exists.');
      name = deleted.rows[0].full_name;
      return {
        result: undefined,
        audit: { resourceKey: 'settings', action: 'delete' as const, targetId: id,
                 before: deleted.rows[0] },
      };
    });

    revalidatePath('/admin/settings/company-info');
    return { success: `${name} removed.` };
  } catch (error) {
    return toFormState(error, 'Could not remove the director.');
  }
}

export async function saveBanking(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const b = {
      tan: str(formData, 'tan')?.toUpperCase() ?? null,
      pan: str(formData, 'pan')?.toUpperCase() ?? null,
      bank_name: str(formData, 'bank_name'),
      bank_branch: str(formData, 'bank_branch'),
      ifsc: str(formData, 'ifsc')?.toUpperCase() ?? null,
      micr: str(formData, 'micr'),
      account_type: str(formData, 'account_type'),
      account_number: str(formData, 'account_number') ?? undefined,
    };

    const errors = validateBanking(b);
    const first = Object.entries(errors)[0];
    if (first) throw new FieldError(first[0], first[1]);

    await mutate(async (client) => {
      const before = await client.query(
        `SELECT tan, pan, bank_name, bank_branch, ifsc, micr, account_type, account_number_last4
           FROM public.company_private WHERE id = 1`,
      );

      // A blank account number means "leave it alone", not "erase it" — the
      // field is empty on every page load because it is never rendered back.
      if (b.account_number) {
        const { enc, last4 } = encryptAccountNumber(b.account_number);
        await client.query(
          `UPDATE public.company_private
              SET account_number_enc=$1, account_number_last4=$2 WHERE id=1`,
          [enc, last4],
        );
      }

      const after = await client.query(
        `UPDATE public.company_private
            SET tan=$1, pan=$2, bank_name=$3, bank_branch=$4, ifsc=$5, micr=$6,
                account_type=$7, updated_at=now()
          WHERE id=1
        RETURNING tan, pan, bank_name, bank_branch, ifsc, micr, account_type, account_number_last4`,
        [b.tan, b.pan, b.bank_name, b.bank_branch, b.ifsc, b.micr, b.account_type],
      );

      return {
        result: undefined,
        audit: {
          resourceKey: 'settings',
          action: 'edit' as const,
          targetId: 'company_banking',
          before: before.rows[0],
          // The account number is recorded as a FINGERPRINT, never as a value.
          // The audit must show that it changed without becoming a second place
          // the number is stored in the clear.
          after: {
            ...after.rows[0],
            account_number_changed: b.account_number ? fingerprint(b.account_number) : null,
          },
        },
      };
    });

    revalidatePath('/admin/settings/company-info');
    return { success: 'Banking details saved.' };
  } catch (error) {
    return toFormState(error, 'Could not save the banking details.');
  }
}

/** Decrypts and returns the account number once, for a deliberate reveal. */
export async function revealAccount(_prev: FormState): Promise<FormState> {
  try {
    // Routed through mutate() despite being a read, so the reveal is AUDITED.
    // Looking at a bank account number is worth a record.
    let value: string | null = null;
    await mutate(async () => {
      value = await revealAccountNumber();
      return {
        result: undefined,
        audit: { resourceKey: 'settings', action: 'view' as const, targetId: 'company_bank_account' },
      };
    });
    if (!value) return { error: 'No account number is stored.' };
    return { success: 'Shown below. This view was recorded in the audit log.', revealed: value };
  } catch (error) {
    return toFormState(error, 'Could not read the account number.');
  }
}
