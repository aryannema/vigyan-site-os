import { NextResponse } from 'next/server';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { isValidPhone } from '@/lib/phone';

/**
 * Phone-number validation as a service, so every form asks one authority
 * instead of each shipping its own rule (which is how we ended up with
 * `length < 8` here, `min(5)` there, and nothing at all on /api/contact).
 *
 * GET is the canonical verb and what callers should use: this is a safe,
 * idempotent read that changes nothing, which is exactly what GET is for.
 *
 * POST is also accepted, for one narrow reason: a number in a query string
 * reaches the server access log and any Referer header, and a phone number is
 * personal data. Where that logging matters, POST the same payload and get the
 * same answer. It is an alternative, not the default.
 *
 * This is deliberately an OFFLINE check against Google's numbering-plan
 * metadata. It tells you a number cannot exist; it cannot tell you a number is
 * reachable, has WhatsApp, or belongs to the person typing it. Only the VERIFY
 * round-trip proves that. Nothing here touches the network or the database, so
 * it leaks nothing and needs no auth.
 */

const MAX_INPUT = 32;

function validate(raw: string | null) {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, reason: 'missing' as const };
  }
  const input = raw.trim();
  if (!input) return { valid: false, reason: 'missing' as const };
  if (input.length > MAX_INPUT) return { valid: false, reason: 'too_long' as const };
  if (!input.startsWith('+')) {
    // Without a country code there is nothing to validate against, and
    // assuming a default region silently mis-validates every foreign number.
    return { valid: false, reason: 'missing_country_code' as const };
  }
  if (!isValidPhone(input)) {
    return { valid: false, reason: 'not_a_valid_number' as const };
  }
  const parsed = parsePhoneNumberFromString(input);
  return {
    valid: true as const,
    e164: parsed?.number,
    country: parsed?.country,
    // Digits-only, the shape stored in site_accounts and sent to Meta.
    whatsappDigits: parsed?.number?.replace(/[^\d]/g, ''),
  };
}

export async function GET(request: Request) {
  const number = new URL(request.url).searchParams.get('number');
  const result = validate(number);
  return NextResponse.json(result, { status: result.valid ? 200 : 422 });
}

export async function POST(request: Request) {
  let number: string | null = null;
  try {
    number = (await request.json())?.number ?? null;
  } catch {
    return NextResponse.json({ valid: false, reason: 'bad_json' }, { status: 400 });
  }
  const result = validate(number);
  return NextResponse.json(result, { status: result.valid ? 200 : 422 });
}
