import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';
import { sendTransactionalEmail } from '@/lib/resend-email';
import { generateEmailToken, hashDeletionToken, EMAIL_TOKEN_EXPIRY_MINUTES } from '@/lib/account-deletion';
import { getConfigNumber } from '@/lib/app-config';
import { siteConfig } from '@/config/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Always-generic response, whether or not a match was found -- avoids
// confirming to an unauthenticated caller whether a given email/phone
// combination has an account (account enumeration).
const GENERIC_RESPONSE = {
  message:
    "If that email and WhatsApp number match an account, we've sent a confirmation link to that email and you can message our WhatsApp number \"DELETE\" to get a confirmation code. Both must be confirmed before anything is deleted.",
};

/**
 * POST /api/account-deletion/request
 * body: { email: string, phone_number: string }
 *
 * Unauthenticated entry point for someone who wants their YourSite
 * account deleted but isn't signed in. Requires BOTH the email AND the
 * WhatsApp number to already match one site_accounts record (both fields
 * are mandatory/verified at profile-completion time, so a genuine account
 * always has both) -- proving you know both is the ownership check before
 * we even start the dual-channel verification. See docs/OPS.md / migration
 * 021 for the full design (why deletion isn't a hard delete, etc).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { email?: string; phone_number?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const phone = normalizeWhatsAppNumber((body.phone_number || '').trim());
  if (!email || !phone) {
    return NextResponse.json({ error: 'Email and WhatsApp number are required.' }, { status: 400 });
  }

  const { data: account, error: lookupError } = await supabaseAdmin
    .from('site_accounts')
    .select('user_id')
    .eq('email', email)
    .eq('whatsapp_number', phone)
    .is('deleted_at', null)
    .maybeSingle();

  if (lookupError) {
    console.error('[account-deletion/request] lookup failed:', lookupError);
    return NextResponse.json(GENERIC_RESPONSE);
  }
  if (!account) {
    // Deliberately generic -- no account-enumeration signal.
    return NextResponse.json(GENERIC_RESPONSE);
  }

  // Replace any earlier pending request for this user rather than
  // accumulating stale rows.
  await supabaseAdmin.from('account_deletion_requests').delete().eq('user_id', account.user_id);

  const tokenExpiryMinutes = await getConfigNumber('deletion_email_token_expiry_minutes', EMAIL_TOKEN_EXPIRY_MINUTES);
  const rawToken = generateEmailToken();
  const { error: insertError } = await supabaseAdmin.from('account_deletion_requests').insert({
    user_id: account.user_id,
    requested_email: email,
    requested_phone: phone,
    email_token_hash: hashDeletionToken(rawToken),
    email_token_expires_at: new Date(Date.now() + tokenExpiryMinutes * 60 * 1000).toISOString(),
  });
  if (insertError) {
    console.error('[account-deletion/request] insert failed:', insertError);
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const confirmUrl = `${siteConfig.url}/api/account-deletion/confirm-email?token=${rawToken}`;
  await sendTransactionalEmail(
    email,
    'Confirm your YourSite account deletion request',
    `<p>We received a request to delete the YourSite account associated with this email.</p>
     <p><a href="${confirmUrl}">Click here to confirm this email</a> (expires in ${tokenExpiryMinutes} minutes).</p>
     <p>This only completes deletion once you've <strong>also</strong> confirmed via WhatsApp — message our WhatsApp
     number "DELETE" and enter the code it sends you on the deletion request page.</p>
     <p>If you didn't request this, you can safely ignore this email — nothing will be deleted without both confirmations.</p>`,
  );

  return NextResponse.json(GENERIC_RESPONSE);
}
