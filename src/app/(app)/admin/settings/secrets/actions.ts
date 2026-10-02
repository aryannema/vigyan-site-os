'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';

import { encryptSecret, getSecret, invalidateSecretCache, MANAGED_SECRETS } from '@/lib/app-secrets';

import { mutate } from '../../lib/db';
import { toFormState, type FormState } from '../../lib/form';

/**
 * Secrets write path for the admin UI.
 *
 * Routed through `mutate()` like every other admin write, so the capability
 * check and the audit row happen in the same transaction as the change. A
 * secrets screen is precisely where an unaudited write path would matter most,
 * so it does not get its own shortcut.
 *
 * The audit payload records the KEY and the ACTION, never the value. A secret
 * written into an audit log has been copied, not protected.
 */

function assertManaged(key: string): void {
  if (!(MANAGED_SECRETS as readonly string[]).includes(key)) {
    // A server action is a public endpoint. Without this, a crafted POST could
    // write an arbitrary key, and a secret store that accepts arbitrary keys is
    // a convenient place to hide things.
    throw new Error(`"${key}" is not a managed secret.`);
  }
}

/** Keys whose value is OURS to choose, so we can safely generate one. */
const SELF_GENERATED: Record<string, number> = {
  OTP_HASH_SECRET: 32,
  CRON_SECRET: 32,
  WEBHOOK_SECRET: 32,
  MCP_SECRET_KEY: 32,
  WHATSAPP_VERIFY_TOKEN: 24,
};

/**
 * Where a generated value has to be copied to for it to be of any use.
 *
 * Generating a secret the operator never sees is only acceptable when nothing
 * outside this system needs it. That is true of OTP_HASH_SECRET alone -- it is
 * an internal HMAC key. Every other self-generated secret is one half of a
 * shared pair, and a value stored but never shown leaves the other half stale
 * and the integration silently broken.
 *
 * So these are returned once, in the success message, and never again.
 */
const MUST_BE_COPIED_TO: Record<string, string> = {
  WHATSAPP_VERIFY_TOKEN: 'Meta → App → WhatsApp → Configuration → Verify token',
  MCP_SECRET_KEY: 'every automation caller of /api/mcp',
  CRON_SECRET: "the Authorization header of Coolify's scheduled tasks",
  WEBHOOK_SECRET: 'the n8n / Notion senders that call our inbound webhooks',
};

async function writeSecret(key: string, plaintext: string): Promise<void> {
  const value_enc = encryptSecret(plaintext);
  await mutate(async (client) => {
    const existing = await client.query('SELECT key FROM public.app_secrets WHERE key = $1', [key]);
    await client.query(
      `INSERT INTO public.app_secrets (key, value_enc, env_fallback, updated_at)
            VALUES ($1, $2, $1, now())
       ON CONFLICT (key) DO UPDATE SET value_enc = EXCLUDED.value_enc, updated_at = now()`,
      [key, value_enc],
    );
    return {
      result: undefined,
      audit: {
        resourceKey: 'settings',
        // Always 'edit': a secret is a setting, and settings are gated on edit.
        // 'create' was refused for admins who can edit settings, so the first
        // save of any key failed.
        action: 'edit' as const,
        targetId: key,
        // Key and outcome only -- never the value, and never the ciphertext.
        after: { key, rotated: Boolean(existing.rowCount), firstSet: !existing.rowCount },
      },
    };
  });
  invalidateSecretCache(key);
  revalidatePath('/admin/settings/secrets');
}

export async function saveSecret(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const key = String(formData.get('key') ?? '');
    const value = String(formData.get('value') ?? '').trim();
    assertManaged(key);
    if (!value) return { error: 'Value is empty. Use Clear to remove a secret.' };
    await writeSecret(key, value);
    return { success: `${key} saved.` };
  } catch (error) {
    // The reason, never the value: neither the cipher nor Postgres echo the
    // plaintext into an error message.
    console.error('[secrets] save failed:', error);
    const reason = error instanceof Error ? error.message : String(error);
    return toFormState(error, `Could not save the secret: ${reason}`);
  }
}

/**
 * Generates a fresh random value — only for keys we define ourselves.
 *
 * Deliberately refused for RAZORPAY_WEBHOOK_SECRET, WHATSAPP_TOKEN,
 * META_APP_SECRET, RESEND_API_KEY and the rest: those are issued by someone
 * else's dashboard. Generating a random string for them would produce a value
 * that looks configured on this screen and fails every real call.
 */
export async function regenerateSecret(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const key = String(formData.get('key') ?? '');
    assertManaged(key);
    const bytes = SELF_GENERATED[key];
    if (!bytes) {
      return {
        error: `${key} is issued by a third party — paste it from their dashboard rather than generating one.`,
      };
    }
    const value = randomBytes(bytes).toString('hex');
    await writeSecret(key, value);

    if (key === 'OTP_HASH_SECRET') {
      // Internal only -- nothing outside this system needs it, so it is never
      // displayed. Rotating it does have a user-visible consequence, though.
      return {
        success:
          'OTP_HASH_SECRET regenerated. Codes issued before now will no longer verify, so anyone mid-signup must request a new one. OTPs expire after 10 minutes, so this clears itself.',
      };
    }

    const destination = MUST_BE_COPIED_TO[key];
    return {
      success: `${key} regenerated. SHOWN ONCE — copy it now into ${destination}; it is encrypted and cannot be read back.`,
      revealed: value,
    };
  } catch (error) {
    return toFormState(error, 'Could not regenerate the secret.');
  }
}

export async function clearSecret(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const key = String(formData.get('key') ?? '');
    assertManaged(key);
    await mutate(async (client) => {
      await client.query('DELETE FROM public.app_secrets WHERE key = $1', [key]);
      return {
        result: undefined,
        audit: { resourceKey: 'settings', action: 'delete' as const, targetId: key, after: { key } },
      };
    });
    invalidateSecretCache(key);
    revalidatePath('/admin/settings/secrets');
    return {
      success: `${key} removed from the database. If an environment variable of the same name still exists, that value is in use again.`,
    };
  } catch (error) {
    return toFormState(error, 'Could not clear the secret.');
  }
}

/**
 * Decrypts one stored secret for an admin who asked to see it. Gated by the
 * same capability as changing a secret (settings:edit, enforced inside
 * perform_action) and audited with the key name only -- the value never enters
 * the audit log.
 */
export async function revealSecret(key: string): Promise<{ value?: string; error?: string }> {
  try {
    assertManaged(key);
    // Permission check + audit first; the value is read only once both pass.
    await mutate(async () => ({
      result: undefined,
      audit: {
        resourceKey: 'settings',
        action: 'edit' as const,
        targetId: `${key}:reveal`,
        after: { key, revealed: true },
      },
    }));
    const value = await getSecret(key);
    if (!value) return { error: 'No value is set.' };
    return { value };
  } catch (error) {
    console.error('[secrets] reveal failed:', error);
    return { error: error instanceof Error ? error.message : 'Could not reveal the secret.' };
  }
}
