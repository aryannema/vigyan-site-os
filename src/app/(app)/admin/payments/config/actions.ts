'use server';

/**
 * Razorpay gateway config — same deny-by-default pattern as
 * blog/ai-actions.ts's ai_provider_config: RLS enabled, zero policies,
 * reachable only through this server-side mutate()/query() connection
 * (DATABASE_URL, owner role). See migration
 * 011_products_razorpay_public_accounts.sql §2.
 */

import { mutate, query } from '../../lib/db';

export interface PaymentGatewayConfig {
  gateway: string;
  key_id: string | null;
  key_secret: string | null;
  webhook_secret: string | null;
  is_live: boolean;
}

/** Never returns the secrets — for rendering the settings page safely. */
export interface PaymentGatewayConfigPublic {
  gateway: string;
  key_id: string | null;
  is_live: boolean;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
}

export async function getGatewayConfig(): Promise<PaymentGatewayConfigPublic> {
  const rows = await query<PaymentGatewayConfig>(
    `SELECT gateway, key_id, key_secret, webhook_secret, is_live
       FROM public.payment_gateway_config WHERE gateway = 'razorpay'`,
  );
  const row = rows[0];
  return {
    gateway: 'razorpay',
    key_id: row?.key_id ?? null,
    is_live: row?.is_live ?? false,
    hasKeySecret: Boolean(row?.key_secret),
    hasWebhookSecret: Boolean(row?.webhook_secret),
  };
}

/**
 * `keySecret`/`webhookSecret` are optional: leaving one unset keeps the
 * existing value, so the form never has to re-display or round-trip the real
 * secret.
 */
export async function setGatewayConfig(input: {
  keyId: string;
  keySecret?: string;
  webhookSecret?: string;
  isLive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mutate(async (client) => {
      const before = await client.query<{ key_id: string | null; is_live: boolean }>(
        `SELECT key_id, is_live FROM public.payment_gateway_config WHERE gateway = 'razorpay'`,
      );
      await client.query(
        `INSERT INTO public.payment_gateway_config (gateway, key_id, key_secret, webhook_secret, is_live, updated_at)
         VALUES ('razorpay', $1, $2, $3, $4, now())
         ON CONFLICT (gateway) DO UPDATE SET
           key_id = $1,
           key_secret = COALESCE($2, public.payment_gateway_config.key_secret),
           webhook_secret = COALESCE($3, public.payment_gateway_config.webhook_secret),
           is_live = $4,
           updated_at = now()`,
        [input.keyId, input.keySecret ?? null, input.webhookSecret ?? null, input.isLive],
      );
      return {
        result: undefined,
        audit: {
          resourceKey: 'payments',
          action: 'edit' as const, // single config row: gated on edit like any setting
          targetId: 'payment_gateway_config:razorpay',
          before: before.rows[0] ?? null,
          // Never audit-log the secrets themselves.
          after: { key_id: input.keyId, is_live: input.isLive },
        },
      };
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error.' };
  }
}
