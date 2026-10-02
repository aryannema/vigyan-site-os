/**
 * WhatsApp OTP generation/hashing/verification helpers for mandatory profile
 * completion (src/app/(marketing)/complete-profile).
 *
 * The code is generated and sent from INSIDE the webhook
 * (api/webhook/whatsapp/route.ts), triggered by the customer's own inbound
 * "VERIFY" message — see docs/OPS.md §13.4. This template-free design exists
 * because Meta's AUTHENTICATION template category gates outbound-initiated
 * OTP sends behind a 2,000-message volume tier this WABA doesn't have yet;
 * a customer-initiated message opens a free 24h session that plain `type:
 * "text"` replies (via the webhook's own sendWhatsAppMessage()) can use
 * instead. This module intentionally has no send function of its own.
 *
 * SERVER ONLY — never import from a client component. OTP_HASH_SECRET must
 * never reach the browser.
 */

import { randomInt, createHmac, timingSafeEqual } from 'crypto';

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || '';

export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_DAILY_CAP = 5;

/** Generates a random 6-digit code as a string (may have a leading zero). */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');
}

/** HMAC-SHA256(code, OTP_HASH_SECRET) — never store or compare plaintext. */
export function hashOtpCode(code: string): string {
  if (!OTP_HASH_SECRET) {
    throw new Error('OTP_HASH_SECRET is not set — cannot hash an OTP code');
  }
  return createHmac('sha256', OTP_HASH_SECRET).update(code).digest('hex');
}

/** Constant-time comparison of a candidate code against a stored hash. */
export function verifyOtpCode(candidate: string, storedHash: string): boolean {
  const candidateHash = hashOtpCode(candidate);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
