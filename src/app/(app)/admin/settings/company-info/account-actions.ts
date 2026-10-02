'use server';

import { revalidatePath } from 'next/cache';

import { encryptAccountNumber, fingerprint, revealAccountById } from '@/lib/company-private';
import { validateAccount } from '@/lib/company-private-schema';

import { mutate } from '../../lib/db';
import { FieldError, toFormState, type FormState } from '../../lib/form';

/**
 * Bank account write path.
 *
 * Gated on the `company_finance` capability rather than `settings`, so access
 * to bank accounts can be granted to a colleague without also handing them the
 * site's configuration — and withdrawn without taking that away.
 */

const CAP = 'company_finance';

function str(fd: FormData, k: string): string | null {
  const v = String(fd.get(k) ?? '').trim();
  return v || null;
}

export async function saveAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const id = str(formData, 'id');
    const a = {
      label: str(formData, 'label') ?? '',
      bank_name: str(formData, 'bank_name') ?? '',
      bank_branch: str(formData, 'bank_branch'),
      ifsc: str(formData, 'ifsc')?.toUpperCase() ?? null,
      micr: str(formData, 'micr'),
      swift: str(formData, 'swift')?.toUpperCase() ?? null,
      account_type: str(formData, 'account_type') ?? 'current',
      purpose: str(formData, 'purpose'),
      currency: str(formData, 'currency') ?? 'INR',
      is_active: formData.get('is_active') === 'on',
      account_number: str(formData, 'account_number') ?? undefined,
    };

    const errors = validateAccount(a, { isNew: !id });
    const first = Object.entries(errors)[0];
    if (first) throw new FieldError(first[0], first[1]);

    await mutate(async (client) => {
      if (id) {
        const before = await client.query(
          `SELECT label, bank_name, bank_branch, ifsc, micr, swift, account_type,
                  purpose, currency, is_active, account_number_last4
             FROM public.company_accounts WHERE id = $1`, [id],
        );
        if (!before.rowCount) throw new Error('That account no longer exists.');

        // Blank means keep. The number is never rendered back into the form, so
        // an empty field is the normal state rather than an instruction to erase.
        if (a.account_number) {
          const { enc, last4 } = encryptAccountNumber(a.account_number);
          await client.query(
            'UPDATE public.company_accounts SET account_number_enc=$2, account_number_last4=$3 WHERE id=$1',
            [id, enc, last4],
          );
        }

        const after = await client.query(
          `UPDATE public.company_accounts
              SET label=$2, bank_name=$3, bank_branch=$4, ifsc=$5, micr=$6, swift=$7,
                  account_type=$8, purpose=$9, currency=$10, is_active=$11, updated_at=now()
            WHERE id=$1
        RETURNING label, bank_name, bank_branch, ifsc, micr, swift, account_type,
                  purpose, currency, is_active, account_number_last4`,
          [id, a.label, a.bank_name, a.bank_branch, a.ifsc, a.micr, a.swift,
           a.account_type, a.purpose, a.currency, a.is_active],
        );

        return {
          result: undefined,
          audit: {
            resourceKey: CAP, action: 'edit' as const, targetId: id,
            before: before.rows[0],
            // Fingerprint, never the number — an audit log holding the secret in
            // the clear has not protected it.
            after: { ...after.rows[0],
                     account_number_changed: a.account_number ? fingerprint(a.account_number) : null },
          },
        };
      }

      const { enc, last4 } = encryptAccountNumber(a.account_number!);
      const inserted = await client.query(
        `INSERT INTO public.company_accounts
           (label, bank_name, bank_branch, account_number_enc, account_number_last4,
            ifsc, micr, swift, account_type, purpose, currency, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, label, bank_name, account_number_last4`,
        [a.label, a.bank_name, a.bank_branch, enc, last4, a.ifsc, a.micr, a.swift,
         a.account_type, a.purpose, a.currency, a.is_active],
      );
      const row = inserted.rows[0];
      return {
        result: undefined,
        audit: { resourceKey: CAP, action: 'create' as const, targetId: row.id, after: row },
      };
    });

    revalidatePath('/admin/settings/company-info');
    return { success: `${a.label} saved.` };
  } catch (error) {
    return toFormState(error, 'Could not save the account.');
  }
}

/**
 * Makes an account primary.
 *
 * Delegates to set_primary_account(), which does the clear-and-set in ONE
 * statement. Doing it here as two updates would leave an instant with zero or
 * two primaries if another administrator switched at the same moment — and two
 * primaries means a settlement going to an account nobody chose.
 */
export async function makePrimary(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const id = str(formData, 'id');
    if (!id) throw new Error('No account specified.');

    let label = '';
    await mutate(async (client) => {
      const before = await client.query(
        'SELECT id, label FROM public.company_accounts WHERE is_primary AND is_active',
      );
      await client.query('SELECT public.set_primary_account($1::uuid)', [id]);
      const after = await client.query('SELECT label FROM public.company_accounts WHERE id = $1', [id]);
      label = after.rows[0]?.label ?? '';
      return {
        result: undefined,
        audit: {
          resourceKey: CAP, action: 'edit' as const, targetId: id,
          before: { primary_account: before.rows[0]?.label ?? null },
          after: { primary_account: label },
        },
      };
    });

    revalidatePath('/admin/settings/company-info');
    return { success: `Settlements now go to ${label}.` };
  } catch (error) {
    return toFormState(error, 'Could not change the primary account.');
  }
}

export async function revealAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const id = str(formData, 'id');
    if (!id) throw new Error('No account specified.');

    let value: string | null = null;
    await mutate(async () => {
      value = await revealAccountById(id);
      // Audited even though it is a read: looking at a bank account number is
      // worth a record.
      return {
        result: undefined,
        audit: { resourceKey: CAP, action: 'view' as const, targetId: id },
      };
    });

    if (!value) return { error: 'No account number is stored for that account.' };
    return { success: 'Shown below. This view was recorded.', revealed: value };
  } catch (error) {
    return toFormState(error, 'Could not read the account number.');
  }
}
