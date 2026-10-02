import { isValidPhoneNumber } from 'libphonenumber-js';

/**
 * One phone-number rule for the whole app.
 *
 * Every form previously rolled its own, and all of them were length checks:
 * `phone.length < 8` on complete-profile, `min(5)` on the lead form, nothing
 * at all on the blueprint form, and nothing on /api/contact — which is the
 * only one that actually matters, since the others are bypassable by posting
 * to the API directly.
 *
 * A length check cannot reject a number that does not exist. +91974079662 is
 * twelve characters and passes every one of them, but it has nine digits after
 * the country code where an Indian mobile has ten. Stored against a WhatsApp
 * opt-in, that is a promise to message a number nobody can ever hold.
 *
 * libphonenumber-js carries Google's per-country metadata — valid lengths and
 * prefix ranges for every calling code — so no country-specific rule is
 * written or maintained here.
 *
 * LIMIT: the default metadata validates numbering-plan validity, not
 * mobile-ness. An Indian landline passes. Distinguishing MOBILE needs the
 * `max` metadata bundle (~2x size); for WhatsApp the round-trip verification
 * proves reachability far better than any offline check could, so this stops
 * only the numbers that cannot exist.
 */
export function isValidPhone(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    // E.164 only ("+<country><number>"). Without a leading '+' there is no
    // country to validate against, and guessing a default region silently
    // mis-validates every foreign number.
    if (!trimmed.startsWith('+')) return false;
    return isValidPhoneNumber(trimmed);
  } catch {
    return false;
  }
}

/** Digits only, no '+', the shape stored in the DB and sent to Meta. */
export function toWhatsAppDigits(raw: string): string {
  return (raw || '').replace(/[^\d]/g, '');
}
