import { randomBytes } from 'crypto';

import Link from 'next/link';

import { MANAGED_SECRETS } from '@/lib/app-secrets';

import { query } from '../../lib/db';
import { saveSecret, regenerateSecret, clearSecret, revealSecret } from './actions';
import { SecretRow, type SecretStatus } from './SecretRow';

export const dynamic = 'force-dynamic';

/**
 * Secrets are read here WITHOUT decrypting anything. The page needs to know
 * whether a key is configured and when it last changed -- not what it says.
 * Never select value_enc into a page.
 */
const META: Record<string, { description: string; issuer: string | null; selfGenerated?: boolean }> = {
  WHATSAPP_TOKEN: { description: 'System-user permanent token for the Cloud API.', issuer: 'Meta Business Suite' },
  WHATSAPP_VERIFY_TOKEN: { description: 'Handshake string Meta echoes when registering the webhook. We choose it.', issuer: null, selfGenerated: true },
  META_APP_SECRET: { description: 'Verifies X-Hub-Signature-256 on inbound WhatsApp webhooks. Without it, forged deliveries are indistinguishable from real ones.', issuer: 'Meta app → Settings → Basic' },
  RAZORPAY_KEY_SECRET: { description: 'Signs Razorpay order creation.', issuer: 'Razorpay Dashboard' },
  RAZORPAY_WEBHOOK_SECRET: { description: 'Verifies payment webhooks. The route refuses requests entirely while this is unset.', issuer: 'Razorpay Dashboard → Webhooks' },
  OTP_HASH_SECRET: { description: 'HMAC key for OTP codes. Regenerating invalidates codes already in flight.', issuer: null, selfGenerated: true },
  MCP_SECRET_KEY: { description: 'Bearer token for /api/mcp automation callers.', issuer: null, selfGenerated: true },
  CRON_SECRET: { description: 'Authorises the scheduled-task routes.', issuer: null, selfGenerated: true },
  WEBHOOK_SECRET: { description: 'Shared secret for inbound n8n / blog / Notion webhooks.', issuer: null, selfGenerated: true },
  N8N_BLOG_PUBLISHED_WEBHOOK_URL: { description: 'Outbound n8n hook. A capability URL — treat it as a secret.', issuer: 'n8n' },
  N8N_COMMENT_POSTED_WEBHOOK_URL: { description: 'Outbound n8n hook. A capability URL — treat it as a secret.', issuer: 'n8n' },
  RESEND_API_KEY: { description: 'Transactional email sending.', issuer: 'Resend' },
  GEMINI_API_KEY: { description: 'Fallback AI provider when the local model is unreachable.', issuer: 'Google AI Studio' },
  NOTION_API_KEY: { description: 'Notion content sync.', issuer: 'Notion integrations' },
  LOCAL_AI_SECRET: { description: 'Shared secret for the GPU relay to gpu-box.', issuer: null },
  GCP_SERVICE_ACCOUNT_KEY: { description: 'Service-account JSON for GA4 and Search Console.', issuer: 'Google Cloud IAM' },
  GITHUB_RELEASE_TOKEN: { description: 'Fetches release assets from PRIVATE repos so paid builds are not public URLs. A classic PAT needs the full "repo" scope; a fine-grained token scoped to the release repos with read-only Contents is tighter and worth preferring.', issuer: 'github.com → Settings → Developer settings' },
  R2_ACCOUNT_ID: { description: 'Cloudflare account id — forms the R2 endpoint. Not a secret in itself, but it belongs with the rest.', issuer: 'Cloudflare dashboard' },
  R2_ACCESS_KEY_ID: { description: 'R2 API token access key.', issuer: 'Cloudflare → R2 → Manage API tokens' },
  R2_SECRET_ACCESS_KEY: { description: 'R2 API token secret. Shown once at creation.', issuer: 'Cloudflare → R2 → Manage API tokens' },
  R2_BUCKET: { description: 'Bucket name holding product downloads. Must stay private — files are served by signed URL only.', issuer: 'Cloudflare → R2' },
};

/** Byte length per self-generated key — mirrors SELF_GENERATED in actions.ts. */
const SUGGESTION_BYTES: Record<string, number> = {
  OTP_HASH_SECRET: 32,
  CRON_SECRET: 32,
  WEBHOOK_SECRET: 32,
  MCP_SECRET_KEY: 32,
  WHATSAPP_VERIFY_TOKEN: 24,
};

export default async function SecretsPage() {
  const rows = await query<{ key: string; updated_at: string }>(
    'SELECT key, updated_at FROM public.app_secrets',
  );
  const inDb = new Map(rows.map((r) => [r.key, r.updated_at]));

  const secrets: SecretStatus[] = MANAGED_SECRETS.map((key) => {
    const meta = META[key] ?? { description: '', issuer: null };
    const updatedAt = inDb.get(key) ?? null;
    const source: SecretStatus['source'] = updatedAt
      ? 'database'
      : process.env[key]?.trim()
        ? 'env'
        : 'unset';
    const selfGenerated = Boolean(meta.selfGenerated);
    return {
      key,
      source,
      updatedAt,
      description: meta.description,
      issuer: meta.issuer,
      selfGenerated,
      // A suggestion, not a stored value: it exists only in this response and is
      // discarded unless the administrator saves it. Offered only for keys whose
      // value is ours to choose -- a random string for a third-party credential
      // would look configured and fail every call.
      //
      // WHATSAPP_VERIFY_TOKEN has to be readable, because the same string must
      // be typed into Meta's webhook config. That is why the suggestion sits in
      // a visible field: this is the one moment the value can be copied. Once
      // saved it is encrypted and never shown again.
      suggestion: selfGenerated ? randomBytes(SUGGESTION_BYTES[key] ?? 32).toString('hex') : null,
    };
  });

  const counts = {
    db: secrets.filter((s) => s.source === 'database').length,
    env: secrets.filter((s) => s.source === 'env').length,
    unset: secrets.filter((s) => s.source === 'unset').length,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link href="/admin/settings" className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Secrets</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Tokens and signing keys, encrypted in the database and changeable without a
          redeploy. Values are never displayed — this page shows whether a key is
          configured and when it last changed.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          <span className="text-green-700">{counts.db} managed here</span>
          <span className="text-amber-700">{counts.env} still in env</span>
          <span className={counts.unset ? 'font-semibold text-red-600' : 'text-muted'}>
            {counts.unset} not set anywhere
          </span>
        </div>
      </div>

      <div className="rounded-card border border-hairline bg-sand p-4 text-xs text-muted">
        <p>
          <strong className="text-ink">Migrating a value:</strong> save it here, confirm the
          feature still works, then delete the environment variable from Coolify. In that
          order — the code prefers this table and falls back to the environment, so the
          value keeps working throughout.
        </p>
      </div>

      <div className="space-y-3">
        {secrets.map((s) => (
          <SecretRow
            key={s.key}
            secret={s}
            saveAction={saveSecret}
            revealAction={revealSecret}
            regenerateAction={regenerateSecret}
            clearAction={clearSecret}
          />
        ))}
      </div>
    </div>
  );
}
