import { NextResponse, type NextRequest } from 'next/server';
import { createRouteHandlerSupabaseClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';
import {
  generateOtpCode,
  hashOtpCode,
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_DAILY_CAP,
} from '@/lib/whatsapp-otp';
import { getConfigNumber, getConfigString } from '@/lib/app-config';
import { sendAuthCodeTemplate } from '@/lib/whatsapp-template';
import { getFlag } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/profile/whatsapp/send-otp  body: { phone_number }
 *
 * Sends the verification code to the caller's pending WhatsApp number using
 * the approved AUTHENTICATION template named in app_config
 * `whatsapp_otp_template`. Until that key is set this returns 409 with
 * `mode: 'verify-message'`, and the form falls back to the customer-initiated
 * "VERIFY" flow handled by the webhook. The code is checked by verify-otp.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = new NextResponse(null);
  const supabase = createRouteHandlerSupabaseClient(request, response);
  const reply = (body: unknown, status = 200) => withCookies(NextResponse.json(body, { status }), response);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply({ error: 'Not signed in' }, 401);

  // Template sending is opt-in from Admin > Settings even once a template is
  // approved; until then the customer-sent "VERIFY" flow is used.
  const [template, templateLive] = await Promise.all([
    getConfigString('whatsapp_otp_template', ''),
    getFlag('whatsapp_otp_template_live', false),
  ]);
  if (!template || !templateLive) return reply({ mode: 'verify-message' }, 409);

  let body: { phone_number?: string };
  try {
    body = await request.json();
  } catch {
    return reply({ error: 'Invalid request body' }, 400);
  }
  const phoneNumber = normalizeWhatsAppNumber((body.phone_number || '').trim());
  if (!phoneNumber) return reply({ error: 'Phone number is required.' }, 400);

  // Only the number this account saved (unverified) can receive a code, so the
  // endpoint cannot be used to message arbitrary numbers.
  const { data: account } = await supabaseAdmin
    .from('site_accounts')
    .select('whatsapp_number, whatsapp_verified_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!account || account.whatsapp_number !== phoneNumber) {
    return reply({ error: 'Save this number first, then request a code.' }, 400);
  }
  if (account.whatsapp_verified_at) return reply({ error: 'This number is already verified.' }, 400);

  const [expiryMinutes, cooldownSeconds, dailyCap, language] = await Promise.all([
    getConfigNumber('whatsapp_otp_expiry_minutes', OTP_EXPIRY_MINUTES),
    getConfigNumber('whatsapp_otp_resend_cooldown_seconds', OTP_RESEND_COOLDOWN_SECONDS),
    getConfigNumber('whatsapp_otp_daily_cap', OTP_DAILY_CAP),
    getConfigString('whatsapp_otp_template_language', 'en'),
  ]);

  const cooldownCutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .select('created_at')
    .eq('user_id', user.id)
    .gte('created_at', cooldownCutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) {
    const wait = Math.ceil((new Date(recent.created_at).getTime() + cooldownSeconds * 1000 - Date.now()) / 1000);
    return reply(
      { error: `A code was just sent. You can request another in ${Math.max(wait, 1)}s.`, retryAfter: Math.max(wait, 1) },
      429,
    );
  }

  const dailyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', dailyCutoff);
  if ((count ?? 0) >= dailyCap) {
    return reply({ error: "You've reached today's limit for codes. Try again tomorrow." }, 429);
  }

  const code = generateOtpCode();
  const { data: challenge, error: insertError } = await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .insert({
      user_id: user.id,
      phone_number: phoneNumber,
      code_hash: hashOtpCode(code),
      expires_at: new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !challenge) {
    console.error('[send-otp] could not store challenge:', insertError);
    return reply({ error: 'Could not create a code — please try again.' }, 500);
  }

  const sent = await sendAuthCodeTemplate({ to: phoneNumber, code, template, language });
  if (!sent.ok) {
    // An undelivered code must not count against the cooldown or daily cap.
    await supabaseAdmin.from('whatsapp_otp_challenges').delete().eq('id', challenge.id);
    return reply({ error: `WhatsApp could not deliver the code: ${sent.error}` }, 502);
  }

  await supabaseAdmin.from('whatsapp_messages').insert({
    phone_number: phoneNumber,
    direction: 'outbound',
    body: `[template ${template}] verification code`,
    wa_message_id: sent.id,
  });

  return reply({ mode: 'template', expiresInMinutes: expiryMinutes, resendAfterSeconds: cooldownSeconds });
}

function withCookies(json: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) json.cookies.set(cookie);
  return json;
}
