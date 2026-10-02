import { NextResponse, type NextRequest } from 'next/server';

import { createRouteHandlerSupabaseClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';
import { verifyOtpCode, OTP_MAX_ATTEMPTS } from '@/lib/whatsapp-otp';
import { getConfigNumber } from '@/lib/app-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/profile/whatsapp/verify-otp
 * body: { phone_number: string, code: string }
 *
 * PATCH, not POST -- this updates whatsapp_verified_at on the caller's own
 * existing site_accounts row, it doesn't create anything.
 *
 * The code itself is generated and sent by the webhook
 * (api/webhook/whatsapp/route.ts), triggered by the customer's own inbound
 * "VERIFY" message — this route only checks what the user typed against that
 * challenge row. phone_number is normalized to match the digits-only, no-'+'
 * format the webhook stores (Meta's own `message.from` shape) — the form
 * itself may pass E.164 with a '+', so this comparison would silently fail
 * without normalizing first.
 *
 * On a correct, unexpired, not-yet-consumed code: marks the challenge
 * consumed (replay prevention) via supabaseAdmin, then writes
 * whatsapp_number/whatsapp_verified_at onto site_accounts via the user's OWN
 * session client — that write is already within site_accounts_self_update's
 * RLS scope, least-privilege is preferable to reaching for the service-role
 * client for a write that doesn't need it.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const response = new NextResponse(null);
  const supabase = createRouteHandlerSupabaseClient(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return withCookies(NextResponse.json({ error: 'Not signed in' }, { status: 401 }), response);
  }

  let body: { phone_number?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return withCookies(NextResponse.json({ error: 'Invalid request body' }, { status: 400 }), response);
  }

  const code = (body.code || '').trim();
  const phoneNumber = normalizeWhatsAppNumber((body.phone_number || '').trim());
  if (!phoneNumber || !code) {
    return withCookies(NextResponse.json({ error: 'Phone number and code are required.' }, { status: 400 }), response);
  }

  const { data: challenge, error: fetchError } = await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('user_id', user.id)
    .eq('phone_number', phoneNumber)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError || !challenge) {
    return withCookies(
      NextResponse.json({ error: 'Code expired or not found — request a new one.' }, { status: 400 }),
      response,
    );
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return withCookies(
      NextResponse.json({ error: 'Code expired or not found — request a new one.' }, { status: 400 }),
      response,
    );
  }
  const maxAttempts = await getConfigNumber('whatsapp_otp_max_attempts', OTP_MAX_ATTEMPTS);
  if (challenge.attempts >= maxAttempts) {
    return withCookies(
      NextResponse.json({ error: 'Too many attempts — request a new code.' }, { status: 400 }),
      response,
    );
  }

  const isMatch = verifyOtpCode(code, challenge.code_hash);
  if (!isMatch) {
    await supabaseAdmin
      .from('whatsapp_otp_challenges')
      .update({ attempts: challenge.attempts + 1 })
      .eq('id', challenge.id);
    return withCookies(
      NextResponse.json(
        { error: 'Incorrect code.', attempts_remaining: maxAttempts - (challenge.attempts + 1) },
        { status: 400 },
      ),
      response,
    );
  }

  await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challenge.id);

  const { error: updateError } = await supabase
    .from('site_accounts')
    .update({
      whatsapp_number: phoneNumber,
      whatsapp_verified_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);
  if (updateError) {
    console.error('[verify-otp] site_accounts update failed:', updateError);
    return withCookies(NextResponse.json({ error: 'Verified, but could not save — please try again.' }, { status: 500 }), response);
  }

  return withCookies(NextResponse.json({ success: true }), response);
}

function withCookies(json: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    json.cookies.set(cookie);
  }
  return json;
}
