import { createHash } from 'crypto';

import { decryptSecret, encryptSecret } from '@/lib/app-secrets';
import { query } from '@/app/(app)/admin/lib/db';

/**
 * Directors, shareholding and banking (migration 041).
 *
 * SERVER ONLY. These tables have no grant for `anon` or `authenticated`, so the
 * browser cannot reach them at all — a request has to come through server code
 * that has already established the caller is an administrator. That is the
 * whole security model: the browser never holds a key that opens these.
 */

export * from "@/lib/company-private-schema";
import type { Banking, CompanyAccount, Director } from "@/lib/company-private-schema";

export async function listDirectors(): Promise<Director[]> {
  return query<Director>(
    `SELECT id, full_name, parentage, din, shareholding_bp, role,
            appointed_on::text, is_active, position
       FROM public.company_directors
      ORDER BY is_active DESC, position, full_name`,
  );
}

export async function totalShareholdingBp(): Promise<number> {
  const rows = await query<{ bp: number }>('SELECT public.total_shareholding_bp() AS bp');
  return Number(rows[0]?.bp ?? 0);
}

/** Banking WITHOUT the account number. Nothing decrypts for a list view. */
export async function getBanking(): Promise<Banking | null> {
  const rows = await query<Banking>(
    `SELECT tan, pan, bank_name, bank_branch, account_number_last4, ifsc, micr, account_type
       FROM public.company_private WHERE id = 1`,
  );
  return rows[0] ?? null;
}

/**
 * The full account number, decrypted.
 *
 * Separate from getBanking() on purpose: a page that lists bank details should
 * not decrypt an account number just to show which bank it is. This is called
 * only when someone deliberately asks to reveal it, so the decryption is an
 * event rather than a side effect of rendering a page.
 */
export async function revealAccountNumber(): Promise<string | null> {
  const rows = await query<{ account_number_enc: string | null }>(
    'SELECT account_number_enc FROM public.company_private WHERE id = 1',
  );
  const enc = rows[0]?.account_number_enc;
  return enc ? decryptSecret(enc) : null;
}

export function encryptAccountNumber(plain: string): { enc: string; last4: string } {
  return { enc: encryptSecret(plain), last4: plain.slice(-4) };
}

/** Fingerprint for the audit log — proves a value changed without recording it. */
export const fingerprint = (v: string): string =>
  createHash('sha256').update(v).digest('hex').slice(0, 12);


export async function listAccounts(): Promise<CompanyAccount[]> {
  return query<CompanyAccount>(
    `SELECT id, label, bank_name, bank_branch, account_number_last4, ifsc, micr, swift,
            account_type, purpose, currency, is_primary, is_active
       FROM public.company_accounts
      ORDER BY is_active DESC, is_primary DESC, label`,
  );
}

/**
 * The account settlements go to.
 *
 * Returns null rather than guessing when none is marked primary. Picking "the
 * first one" would send money somewhere nobody chose, which is the failure the
 * single-primary index exists to prevent — silently working around it here
 * would undo that.
 */
export async function primaryAccount(): Promise<CompanyAccount | null> {
  const rows = await query<CompanyAccount>(
    `SELECT id, label, bank_name, bank_branch, account_number_last4, ifsc, micr, swift,
            account_type, purpose, currency, is_primary, is_active
       FROM public.company_accounts
      WHERE is_primary AND is_active`,
  );
  return rows[0] ?? null;
}

/** One account's number, decrypted. Call only on a deliberate reveal. */
export async function revealAccountById(id: string): Promise<string | null> {
  const rows = await query<{ account_number_enc: string }>(
    'SELECT account_number_enc FROM public.company_accounts WHERE id = $1',
    [id],
  );
  return rows[0]?.account_number_enc ? decryptSecret(rows[0].account_number_enc) : null;
}
