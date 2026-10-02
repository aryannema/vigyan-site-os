/**
 * Shared account-deletion executor -- used by both the signed-in
 * self-service route (DELETE /api/account) and the unauthenticated,
 * dual-channel-verified request flow (POST/PATCH /api/account-deletion/*).
 *
 * Deliberately does NOT delete the auth.users row. orders.user_id cascades
 * from auth.users (migration 018) -- a hard delete would silently wipe
 * order/invoice records this business is legally required to retain (see
 * /privacy's data-retention section). Instead: anonymize site_accounts (null
 * every PII field, stamp deleted_at), replace the auth email with an inert
 * placeholder, and ban the account from future login. orders rows survive,
 * holding zero PII of their own -- just product/amount/status against a now-
 * anonymous user_id.
 *
 * Before anonymizing, a snapshot of the PII is AES-256-GCM encrypted and held
 * for GRACE_PERIOD_DAYS (migration 022, account_deletion_grace) -- a bounded
 * safety net against fraudulent/mistaken requests, admin-restorable within
 * that window only. This is deliberately NOT a permanent decrypt-anytime
 * backdoor -- see work-units/session-state.json's 2026-09-09 design note for
 * why that would undermine the actual legal meaning of "erasure" under DPDP.
 * purgeExpiredGracePeriods() (called from a cron route) makes the window
 * genuinely bounded by deleting the encrypted blob once it expires.
 *
 * SERVER ONLY -- uses supabaseAdmin's auth.admin API (service role) and
 * ACCOUNT_DELETION_ENCRYPTION_KEY, which must never reach the browser.
 */

import { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getConfigNumber } from '@/lib/app-config';

// Effectively permanent -- GoTrue's ban_duration takes a Go duration string
// and has no literal "forever"; 100 years covers it.
const BAN_FOREVER = '876000h';

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || '';
const ENCRYPTION_KEY_HEX = process.env.ACCOUNT_DELETION_ENCRYPTION_KEY || '';

export const EMAIL_TOKEN_EXPIRY_MINUTES = 30;
export const DELETION_WHATSAPP_CODE_LENGTH = 6;
export const DELETION_WHATSAPP_EXPIRY_MINUTES = 10;
export const DELETION_WHATSAPP_MAX_ATTEMPTS = 5;
export const DELETION_WHATSAPP_RESEND_COOLDOWN_SECONDS = 60;
export const GRACE_PERIOD_DAYS = 15;

interface AccountSnapshot {
  original_email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  whatsapp_number: string | null;
  whatsapp_verified_at: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_collected_at: string | null;
}

/** AES-256-GCM encrypt; output is base64(iv):base64(authTag):base64(ciphertext). */
function encryptSnapshot(data: AccountSnapshot): string {
  if (!ENCRYPTION_KEY_HEX) throw new Error('ACCOUNT_DELETION_ENCRYPTION_KEY is not set');
  const key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Inverse of encryptSnapshot(). Throws if the key is wrong or the blob was tampered with. */
function decryptSnapshot(blob: string): AccountSnapshot {
  if (!ENCRYPTION_KEY_HEX) throw new Error('ACCOUNT_DELETION_ENCRYPTION_KEY is not set');
  const key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  const [ivB64, authTagB64, ciphertextB64] = blob.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** Random 32-byte hex token for the email confirmation link. */
export function generateEmailToken(): string {
  return randomBytes(32).toString('hex');
}

/** HMAC-SHA256, domain-separated from the WhatsApp-OTP hash so a leaked
 * value from one flow can't be replayed against the other. */
export function hashDeletionToken(token: string): string {
  if (!OTP_HASH_SECRET) throw new Error('OTP_HASH_SECRET is not set');
  return createHmac('sha256', OTP_HASH_SECRET).update(`account-deletion:${token}`).digest('hex');
}

export function verifyDeletionToken(candidate: string, storedHash: string): boolean {
  const candidateHash = hashDeletionToken(candidate);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type DeletionMethod = 'self_service' | 'verified_request' | 'admin_action';

export async function executeAccountDeletion(
  userId: string,
  method: DeletionMethod,
  verifiedAt: { emailVerifiedAt?: string | null; whatsappVerifiedAt?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  const gracePeriodDays = await getConfigNumber('account_deletion_grace_period_days', GRACE_PERIOD_DAYS);
  const graceExpiresAt = new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: existing, error: readError }, { data: authUser, error: authReadError }] = await Promise.all([
    supabaseAdmin
      .from('site_accounts')
      .select('email, first_name, last_name, full_name, whatsapp_number, whatsapp_verified_at, whatsapp_opt_in, whatsapp_collected_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(userId),
  ]);
  if (readError || !existing) {
    console.error('[account-deletion] could not read account before anonymizing:', readError);
    return { success: false, error: 'Could not find account data.' };
  }
  if (authReadError || !authUser?.user) {
    console.error('[account-deletion] could not read auth user before anonymizing:', authReadError);
    return { success: false, error: 'Could not find account.' };
  }

  const snapshot: AccountSnapshot = {
    original_email: authUser.user.email || existing.email,
    first_name: existing.first_name,
    last_name: existing.last_name,
    full_name: existing.full_name,
    whatsapp_number: existing.whatsapp_number,
    whatsapp_verified_at: existing.whatsapp_verified_at,
    whatsapp_opt_in: existing.whatsapp_opt_in,
    whatsapp_collected_at: existing.whatsapp_collected_at,
  };

  const { error: graceError } = await supabaseAdmin.from('account_deletion_grace').insert({
    user_id: userId,
    encrypted_snapshot: encryptSnapshot(snapshot),
    purge_after: graceExpiresAt,
  });
  if (graceError) {
    console.error('[account-deletion] failed to store grace-period snapshot:', graceError);
    return { success: false, error: 'Could not safely start deletion — please try again.' };
  }

  const { error: anonymizeError } = await supabaseAdmin
    .from('site_accounts')
    .update({
      first_name: null,
      last_name: null,
      whatsapp_number: null,
      whatsapp_verified_at: null,
      whatsapp_opt_in: false,
      whatsapp_collected_at: null,
      full_name: null,
      deleted_at: now,
    })
    .eq('user_id', userId);
  if (anonymizeError) {
    console.error('[account-deletion] site_accounts anonymize failed:', anonymizeError);
    return { success: false, error: 'Could not anonymize account data.' };
  }

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email: `deleted-${userId}@deleted.yoursite.internal`,
    ban_duration: BAN_FOREVER,
  });
  if (banError) {
    console.error('[account-deletion] auth.users anonymize/ban failed:', banError);
    return { success: false, error: 'Could not fully close the account — please contact support.' };
  }

  const { error: logError } = await supabaseAdmin.from('account_deletion_log').insert({
    user_id: userId,
    method,
    email_verified_at: verifiedAt.emailVerifiedAt ?? null,
    whatsapp_verified_at: verifiedAt.whatsappVerifiedAt ?? null,
    completed_at: now,
    grace_expires_at: graceExpiresAt,
  });
  if (logError) {
    // The deletion itself already succeeded -- a failed audit-log write
    // shouldn't be reported as a failed deletion to the caller.
    console.error('[account-deletion] audit log insert failed (deletion still succeeded):', logError);
  }

  return { success: true };
}

/**
 * Admin-only restore, within the grace window. Decrypts the snapshot, writes
 * the PII back to site_accounts, restores the original auth email, and lifts
 * the ban. The grace row is deleted immediately after a successful restore --
 * a used recovery isn't kept "just in case" either.
 *
 * Deliberately does NOT itself record who did this in account_deletion_log --
 * that's the caller's job (admin/account-deletions/actions.ts), via
 * mutate()/perform_action() so it's a real, actor-attributed audit row like
 * every other admin write in this codebase, not a service-role write with no
 * identity attached. This function only returns the userId so the caller can
 * do that.
 */
export async function restoreAccountFromGrace(
  graceId: string,
): Promise<{ success: boolean; userId?: string; error?: string }> {
  const { data: grace, error: fetchError } = await supabaseAdmin
    .from('account_deletion_grace')
    .select('id, user_id, encrypted_snapshot, purge_after')
    .eq('id', graceId)
    .maybeSingle();
  if (fetchError || !grace) {
    return { success: false, error: 'Grace-period record not found.' };
  }
  if (new Date(grace.purge_after).getTime() < Date.now()) {
    return { success: false, error: 'This grace period has already expired — the data is no longer recoverable.' };
  }

  let snapshot: AccountSnapshot;
  try {
    snapshot = decryptSnapshot(grace.encrypted_snapshot);
  } catch (err) {
    console.error('[account-deletion] failed to decrypt grace-period snapshot:', err);
    return { success: false, error: 'Could not decrypt the stored snapshot.' };
  }

  const { error: restoreError } = await supabaseAdmin
    .from('site_accounts')
    .update({
      first_name: snapshot.first_name,
      last_name: snapshot.last_name,
      full_name: snapshot.full_name,
      whatsapp_number: snapshot.whatsapp_number,
      whatsapp_verified_at: snapshot.whatsapp_verified_at,
      whatsapp_opt_in: snapshot.whatsapp_opt_in,
      whatsapp_collected_at: snapshot.whatsapp_collected_at,
      deleted_at: null,
    })
    .eq('user_id', grace.user_id);
  if (restoreError) {
    console.error('[account-deletion] site_accounts restore failed:', restoreError);
    return { success: false, error: 'Could not restore account data.' };
  }

  const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(grace.user_id, {
    email: snapshot.original_email,
    ban_duration: 'none',
  });
  if (unbanError) {
    console.error('[account-deletion] auth.users restore/unban failed:', unbanError);
    return { success: false, error: 'Could not restore login access — account data was restored, contact an engineer.' };
  }

  await supabaseAdmin.from('account_deletion_grace').delete().eq('id', grace.id);

  return { success: true, userId: grace.user_id };
}

/**
 * Permanently purges any grace-period snapshot past its window — called from
 * a cron route (api/cron/purge-deletion-grace). After this, the encrypted
 * blob is gone; there is no other copy anywhere.
 */
export async function purgeExpiredGracePeriods(): Promise<{ purged: number; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('account_deletion_grace')
    .delete()
    .lt('purge_after', new Date().toISOString())
    .select('id, user_id');
  if (error) {
    console.error('[account-deletion] purge failed:', error);
    return { purged: 0, error: error.message };
  }
  const now = new Date().toISOString();
  for (const row of data ?? []) {
    // purged_by stays NULL -- this is the scheduled cron path, not an admin
    // action; that distinction is the whole point of the column.
    await supabaseAdmin
      .from('account_deletion_log')
      .update({ purged_at: now })
      .eq('user_id', row.user_id)
      .is('purged_at', null);
  }
  return { purged: data?.length ?? 0 };
}

/**
 * Manual, immediate purge of one grace-period snapshot -- bypasses the
 * 15-day wait entirely. For admin use (e.g. cleaning up test accounts right
 * after testing, rather than waiting for the cron). Deliberately does NOT
 * stamp account_deletion_log itself -- same split as restoreAccountFromGrace():
 * the caller (admin/account-deletions/actions.ts) does that via
 * mutate()/perform_action() so it's a real, actor-attributed audit row, not
 * an anonymous service-role write.
 */
export async function purgeGraceNow(graceId: string): Promise<{ success: boolean; userId?: string; error?: string }> {
  const { data: grace, error: fetchError } = await supabaseAdmin
    .from('account_deletion_grace')
    .select('id, user_id')
    .eq('id', graceId)
    .maybeSingle();
  if (fetchError || !grace) {
    return { success: false, error: 'Grace-period record not found.' };
  }

  const { error: deleteError } = await supabaseAdmin.from('account_deletion_grace').delete().eq('id', grace.id);
  if (deleteError) {
    console.error('[account-deletion] manual purge failed:', deleteError);
    return { success: false, error: 'Could not purge.' };
  }

  return { success: true, userId: grace.user_id };
}
