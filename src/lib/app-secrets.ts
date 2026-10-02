import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'crypto';

import { supabaseAdmin } from '@/lib/supabase';

/**
 * Admin-configurable secrets (migration 029).
 *
 * Migration 028 moved the non-secret WhatsApp values into `app_config` so they
 * could be changed without a redeploy. It could not touch the tokens, because
 * `app_config` grants SELECT to `anon` and the anon key ships in the browser
 * bundle -- a secret written there would be published, not stored.
 *
 * This module is the other half: the same "edit it in the admin panel, no
 * redeploy, no hosting-platform lock-in" property, for values that must stay
 * secret. Rows are AES-256-GCM encrypted with CONFIG_ENCRYPTION_KEY, and the
 * table is reachable only through the service role.
 *
 * SERVER ONLY. Importing this from a client component leaks the service role.
 */

/**
 * KEY VERSIONING.
 *
 * Ciphertext is stored as "v<N>:<base64>". Anything with no prefix is v1, which
 * is everything written before versioning existed — so this reads the old rows
 * without a migration.
 *
 * The environment can hold SEVERAL versions at once:
 *
 *   CONFIG_ENCRYPTION_KEY      the original, treated as v1
 *   CONFIG_ENCRYPTION_KEY_V2   a newer one
 *   CONFIG_ENCRYPTION_KEY_CURRENT=2   which version new writes use
 *
 * Both must be present during a rotation: old rows still need the old key to be
 * read, and they are re-encrypted one at a time rather than all at once. That
 * overlap is the entire reason rotation is possible at all — with one key,
 * changing it makes every existing row undecryptable instantly, so in practice
 * nobody rotates and the key lives for ever.
 */

function keyForVersion(version: number): Buffer {
  const raw =
    version === 1
      ? process.env.CONFIG_ENCRYPTION_KEY
      : process.env[`CONFIG_ENCRYPTION_KEY_V${version}`];

  if (!raw) {
    throw new Error(
      `No key for encryption version ${version}. It is still needed: rows encrypted ` +
        `with it cannot be read without it. Check CONFIG_ENCRYPTION_KEY` +
        (version === 1 ? '' : `_V${version}`) + '.',
    );
  }
  const key = Buffer.from(raw.trim(), 'hex');
  if (key.length !== 32) {
    throw new Error(`Encryption key v${version} must be 32 bytes as 64 hex characters.`);
  }
  return key;
}

/** The version new ciphertext is written with. */
export function currentKeyVersion(): number {
  const v = Number(process.env.CONFIG_ENCRYPTION_KEY_CURRENT ?? '1');
  return Number.isInteger(v) && v > 0 ? v : 1;
}

/** SHA-256 of a key version — safe to store, since it reveals nothing. */
export function keyFingerprint(version: number): string {
  return createHash('sha256').update(keyForVersion(version)).digest('hex').slice(0, 16);
}

/** Splits "v2:payload" into its parts. No prefix means v1. */
function parseCiphertext(value: string): { version: number; payload: string } {
  const m = value.match(/^v([0-9]+):([\s\S]*)$/);
  return m ? { version: Number(m[1]), payload: m[2] } : { version: 1, payload: value };
}

/**
 * Encrypts with the CURRENT key version.
 *
 * Format: "v<N>:base64(iv[12] || authTag[16] || ciphertext)". The version
 * travels with the data, so a row can always say which key it needs — the
 * alternative is guessing, and a wrong guess is indistinguishable from
 * corruption.
 */
export function encryptSecret(plaintext: string, version = currentKeyVersion()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyForVersion(version), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  // v1 is written with no prefix, so code that predates versioning can still
  // read anything written since — a rollback stays safe.
  return version === 1 ? body : `v${version}:${body}`;
}

/** Decrypts using whichever version the ciphertext names. */
export function decryptSecret(value: string): string {
  const { version, payload } = parseCiphertext(value);
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyForVersion(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Which key version a stored value needs. Reads the prefix; decrypts nothing. */
export function ciphertextVersion(value: string): number {
  return parseCiphertext(value).version;
}

/**
 * Re-encrypts one value onto the current key.
 *
 * Decrypt-then-encrypt is unavoidable: the plaintext exists in memory for an
 * instant. It is never written, logged or returned.
 */
export function rotateCiphertext(value: string): { value: string; changed: boolean } {
  const from = ciphertextVersion(value);
  const to = currentKeyVersion();
  if (from === to) return { value, changed: false };
  return { value: encryptSecret(decryptSecret(value), to), changed: true };
}

/**
 * Request-scoped cache. Secrets are read on hot paths (every webhook, every OTP)
 * and a DB round trip per read would be both slow and a needless amplification
 * of the one query an attacker would most like to make noisy.
 *
 * Deliberately short: a rotation in the admin panel must take effect quickly,
 * and 30s is short enough that "I changed it and it didn't apply" is never the
 * explanation for a real bug.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: string | null; at: number }>();

/** Clears the cache. Call after any write so a rotation is visible immediately. */
export function invalidateSecretCache(k?: string): void {
  if (k) cache.delete(k);
  else cache.clear();
}

/**
 * Reads a secret, preferring the database and falling back to the environment.
 *
 * The fallback is what makes the migration safe to do one value at a time: a
 * key that has not been moved yet still resolves from env, so the cutover is
 * "write the row, verify, then delete the env var" rather than a flag day.
 *
 * Returns null when neither source has it -- callers must decide whether that
 * is fatal. For anything that verifies a signature, it MUST be fatal: refusing
 * to verify is safe, verifying with an empty key is forgeable.
 */
export async function getSecret(
  name: string,
  envFallback: string | undefined = process.env[name],
): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('app_secrets')
      .select('value_enc')
      .eq('key', name)
      .maybeSingle();
    if (data?.value_enc) value = decryptSecret(data.value_enc);
  } catch {
    // A DB or decrypt failure must not take down a request that env can still
    // satisfy. Falling through to env is strictly safer than throwing here.
  }

  if (!value) value = envFallback?.trim() || null;

  cache.set(name, { value, at: Date.now() });
  return value;
}

/**
 * Writes a secret and records the change.
 *
 * The audit row carries the key, the actor and the time -- never the value. A
 * secret written in plaintext to an audit log has not been protected, it has
 * been copied.
 */
export async function setSecret(
  name: string,
  plaintext: string,
  actor: string,
  opts: { description?: string; envFallback?: string } = {},
): Promise<void> {
  const existing = await supabaseAdmin
    .from('app_secrets')
    .select('key')
    .eq('key', name)
    .maybeSingle();

  const { error } = await supabaseAdmin.from('app_secrets').upsert({
    key: name,
    value_enc: encryptSecret(plaintext),
    description: opts.description ?? null,
    env_fallback: opts.envFallback ?? name,
    updated_at: new Date().toISOString(),
    updated_by: actor,
  });
  if (error) throw new Error(`Failed to write secret "${name}": ${error.message}`);

  await supabaseAdmin.from('app_secrets_audit').insert({
    key: name,
    action: existing.data ? 'rotate' : 'set',
    actor,
  });

  invalidateSecretCache(name);
}

export async function deleteSecret(name: string, actor: string): Promise<void> {
  const { error } = await supabaseAdmin.from('app_secrets').delete().eq('key', name);
  if (error) throw new Error(`Failed to delete secret "${name}": ${error.message}`);
  await supabaseAdmin.from('app_secrets_audit').insert({ key: name, action: 'delete', actor });
  invalidateSecretCache(name);
}

/**
 * Lists which secrets are configured, WITHOUT decrypting any of them.
 *
 * This is what the admin UI renders. It answers "is this set, and when did it
 * last change" -- which is the question an operator actually has -- without
 * ever putting a live credential on a screen or into a response body.
 */
export async function listSecretStatus(): Promise<
  { key: string; isSet: boolean; source: 'database' | 'env' | 'unset'; updatedAt: string | null; updatedBy: string | null }[]
> {
  const { data } = await supabaseAdmin
    .from('app_secrets')
    .select('key, updated_at, updated_by')
    .order('key');
  const inDb = new Map((data ?? []).map((r) => [r.key, r]));

  return MANAGED_SECRETS.map((k) => {
    const row = inDb.get(k);
    if (row) {
      return { key: k, isSet: true, source: 'database' as const, updatedAt: row.updated_at, updatedBy: row.updated_by };
    }
    const fromEnv = process.env[k]?.trim();
    return {
      key: k,
      isSet: Boolean(fromEnv),
      source: fromEnv ? ('env' as const) : ('unset' as const),
      updatedAt: null,
      updatedBy: null,
    };
  });
}

/**
 * The Tier 2 set from docs/OPS.md §3 — every secret intended to become
 * admin-configurable HERE.
 *
 * Two families are deliberately absent, because they already have a home and a
 * second store would mean two answers to the same question:
 *
 *   RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
 *     live in public.payment_gateway_config (migration 011) and are edited at
 *     /admin/payments/config, alongside the key id and the live/test switch
 *     they only make sense next to.
 *
 *   CRON_SECRET
 *     is not the administrator's to rotate. Its other half is the Authorization
 *     header on Coolify's scheduled tasks, which only someone with Coolify
 *     access can change. Rotating it here would leave the scheduler sending the
 *     old value and silently break every cron run, with nothing in this app
 *     able to put it right. It stays an environment variable.
 * Listing them here (rather than only in prose) is what
 * lets the admin UI show "configured / still in env / not set anywhere" for
 * each one, which is how the 2026-09-16 gap (twelve variables the code read
 * that production never had) becomes visible instead of silent.
 */
export const MANAGED_SECRETS = [
  'WHATSAPP_TOKEN',
  'WHATSAPP_VERIFY_TOKEN',
  'META_APP_SECRET',
  'OTP_HASH_SECRET',
  'MCP_SECRET_KEY',
  'WEBHOOK_SECRET',
  'N8N_BLOG_PUBLISHED_WEBHOOK_URL',
  'N8N_COMMENT_POSTED_WEBHOOK_URL',
  'RESEND_API_KEY',
  'GEMINI_API_KEY',
  'NOTION_API_KEY',
  'LOCAL_AI_SECRET',
  'GCP_SERVICE_ACCOUNT_KEY',
  'GITHUB_RELEASE_TOKEN',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

/**
 * True when `candidate` equals the stored secret `name` (database first, then
 * env). Constant-time, and false when the secret is unset -- an unset shared
 * secret must refuse every caller, never accept an empty one.
 */
export async function secretMatches(name: string, candidate: string | null | undefined): Promise<boolean> {
  if (!candidate) return false;
  const expected = await getSecret(name);
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
