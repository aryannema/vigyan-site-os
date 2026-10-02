import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies that a webhook really came from Meta.
 *
 * Meta signs every webhook POST with HMAC-SHA256 over the RAW request body,
 * keyed on the app secret, and sends it as `X-Hub-Signature-256: sha256=<hex>`.
 * Without checking it, the endpoint accepts anything: its URL is public, so
 * anyone who learns it can post a forged inbound message — including a "VERIFY"
 * for a phone number they do not own.
 *
 * THE RAW BODY MATTERS. The signature covers the exact bytes Meta sent. Parsing
 * to JSON and re-serialising changes key order and whitespace, so the recomputed
 * HMAC will not match. The caller must read the body as text and verify it
 * BEFORE JSON.parse.
 */

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing_header' | 'bad_format' | 'mismatch' };

export function verifyMetaSignature(
  rawBody: string,
  headerValue: string | null,
  appSecret: string | null | undefined,
): SignatureResult {
  // No secret means we cannot verify. That is a configuration problem, not a
  // forged request, and the caller decides what to do — which differs between
  // "reject in production" and "warn while being set up".
  if (!appSecret) return { ok: false, reason: 'not_configured' };
  if (!headerValue) return { ok: false, reason: 'missing_header' };

  const [scheme, provided] = headerValue.split('=');
  if (scheme !== 'sha256' || !provided) return { ok: false, reason: 'bad_format' };

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  // Constant-time compare. A length check first, because timingSafeEqual throws
  // on unequal lengths rather than returning false — and a plain === would leak
  // how much of the signature was correct through timing.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };

  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Signs a body the way Meta would. For tests, and only for tests. */
export function signLikeMeta(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}
