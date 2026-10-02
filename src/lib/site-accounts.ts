/**
 * Shared helpers for public.site_accounts -- the self-registered public
 * visitor tier (checkout/order-history use case), completely separate from
 * admin RBAC (see auth/site-callback/route.ts's header).
 *
 * Profile completeness is a DERIVED predicate, not a stored boolean column --
 * a cached flag could drift from the fields it summarizes (e.g. an admin
 * correction that nulls a bad phone number would leave a stale `true` flag
 * lying about completeness). The check is a three-field null check on a row
 * every caller is already fetching -- no extra query, no drift risk.
 */

export interface SiteAccountProfileFields {
  first_name: string | null;
  last_name: string | null;
  whatsapp_verified_at: string | null;
  /** Migration 030. Required so a purchase can be taxed correctly. */
  billing_country?: string | null;
  billing_state_code?: string | null;
}

/**
 * Whether a profile has everything the site needs.
 *
 * Billing location counts, because GST is decided by place of supply -- an
 * Indian buyer with no state on file gets priced against OUR state, which
 * charges an intra-state split to someone who owed IGST and puts it on an
 * invoice. Leaving it out of this check would let every account created before
 * the field existed skip it silently, which is exactly the failure worth
 * catching here rather than at the payment screen.
 *
 * A country outside India needs no state: the supply is a zero-rated export
 * and the state would decide nothing.
 */
export function isProfileComplete(account: SiteAccountProfileFields | null | undefined): boolean {
  if (!account) return false;
  if (!account.first_name || !account.last_name || !account.whatsapp_verified_at) return false;

  const country = account.billing_country ?? 'IN';
  return country !== 'IN' || Boolean(account.billing_state_code);
}

/**
 * Canonical phone-number format used everywhere a WhatsApp number is stored
 * or compared: digits only, no `+`, no spaces/dashes — matches exactly what
 * Meta's webhook sends as `message.from`. Every write path (the
 * complete-profile form's client-side upsert, the webhook's VERIFY-intercept
 * lookup, whatsapp_otp_challenges rows) must normalize through this one
 * function, or a stray `+` mismatch silently breaks the verification lookup.
 */
export function normalizeWhatsAppNumber(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Validates a `next` redirect target: must be a same-origin relative path.
 * Extracted from auth/site-callback/route.ts, which originally had its own
 * copy -- now needed identically in three places (site-callback, the
 * account-page gate, and the complete-profile page itself), and must stay
 * byte-identical across all three or an open-redirect gap opens between them.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
