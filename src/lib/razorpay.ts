import { supabaseAdmin } from '@/lib/supabase';

/**
 * Razorpay gateway configuration.
 *
 * Credentials live in public.payment_gateway_config (migration 011), edited at
 * /admin/payments/config. They are NOT in app_secrets and NOT in env: the key
 * id, the key secret, the webhook secret and the live/test switch only make
 * sense as one set, and splitting them across two stores is how an environment
 * ends up half-switched -- live keys with a test webhook secret, or the reverse.
 *
 * SERVER ONLY.
 */

export interface RazorpayConfig {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  isLive: boolean;
  /** True only when we could actually transact. */
  configured: boolean;
}

export async function getRazorpayConfig(): Promise<RazorpayConfig> {
  const { data } = await supabaseAdmin
    .from('payment_gateway_config')
    .select('key_id, key_secret, webhook_secret, is_live')
    .eq('gateway', 'razorpay')
    .maybeSingle();

  const keyId = data?.key_id?.trim() || null;
  const keySecret = data?.key_secret?.trim() || null;

  return {
    keyId,
    keySecret,
    webhookSecret: data?.webhook_secret?.trim() || null,
    isLive: Boolean(data?.is_live),
    configured: Boolean(keyId && keySecret),
  };
}

/**
 * Razorpay's own convention: test credentials are prefixed rzp_test_, live ones
 * rzp_live_. Checking the prefix against the is_live flag catches the mistake
 * that costs real money -- a live key left behind an interface that still says
 * "test mode", or test keys on a checkout the operator believes is live.
 */
export function keyModeMismatch(cfg: RazorpayConfig): string | null {
  if (!cfg.keyId) return null;
  const looksLive = cfg.keyId.startsWith('rzp_live_');
  const looksTest = cfg.keyId.startsWith('rzp_test_');
  if (!looksLive && !looksTest) return null;
  if (cfg.isLive && looksTest) {
    return 'Marked live, but the key id is a rzp_test_ key — no real payment can succeed.';
  }
  if (!cfg.isLive && looksLive) {
    return 'Marked test, but the key id is a rzp_live_ key — real cards would be charged.';
  }
  return null;
}

/** Basic-auth header Razorpay's REST API expects. */
export function authHeader(cfg: RazorpayConfig): string {
  return `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
}
