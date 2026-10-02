import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';
import {
  verifyDeletionToken,
  executeAccountDeletion,
  DELETION_WHATSAPP_MAX_ATTEMPTS,
} from '@/lib/account-deletion';
import { getConfigNumber } from '@/lib/app-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/account-deletion/verify-whatsapp
 * body: { phone_number: string, code: string }
 *
 * PATCH, not POST -- this updates the whatsapp_verified_at state on an
 * existing pending deletion request, it doesn't create anything.
 *
 * The code itself is generated and sent by the webhook's
 * handleAccountDeletionRequest(), triggered by the person's own inbound
 * "DELETE" message. This route only checks what they typed against that
 * request row. Deletion only actually executes once the separate emailed
 * link has ALSO been confirmed for the same request.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let body: { phone_number?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const phone = normalizeWhatsAppNumber((body.phone_number || '').trim());
  const code = (body.code || '').trim();
  if (!phone || !code) {
    return NextResponse.json({ error: 'WhatsApp number and code are required.' }, { status: 400 });
  }

  const { data: pending, error: fetchError } = await supabaseAdmin
    .from('account_deletion_requests')
    .select('id, user_id, whatsapp_code_hash, whatsapp_code_expires_at, whatsapp_attempts, whatsapp_verified_at, email_verified_at')
    .eq('requested_phone', phone)
    .is('whatsapp_verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError || !pending || !pending.whatsapp_code_hash || !pending.whatsapp_code_expires_at) {
    return NextResponse.json({ error: 'No pending code found — message "DELETE" to our WhatsApp number first.' }, { status: 400 });
  }
  if (new Date(pending.whatsapp_code_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Code expired — message "DELETE" again for a new one.' }, { status: 400 });
  }
  const maxAttempts = await getConfigNumber('deletion_whatsapp_max_attempts', DELETION_WHATSAPP_MAX_ATTEMPTS);
  if (pending.whatsapp_attempts >= maxAttempts) {
    return NextResponse.json({ error: 'Too many attempts — message "DELETE" again for a new code.' }, { status: 400 });
  }

  const isMatch = verifyDeletionToken(code, pending.whatsapp_code_hash);
  if (!isMatch) {
    await supabaseAdmin
      .from('account_deletion_requests')
      .update({ whatsapp_attempts: pending.whatsapp_attempts + 1 })
      .eq('id', pending.id);
    return NextResponse.json(
      { error: 'Incorrect code.', attempts_remaining: maxAttempts - (pending.whatsapp_attempts + 1) },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from('account_deletion_requests')
    .update({ whatsapp_verified_at: now })
    .eq('id', pending.id);

  if (pending.email_verified_at) {
    const result = await executeAccountDeletion(pending.user_id, 'verified_request', {
      emailVerifiedAt: pending.email_verified_at,
      whatsappVerifiedAt: now,
    });
    await supabaseAdmin.from('account_deletion_requests').delete().eq('id', pending.id);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Could not complete deletion.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, completed: true });
  }

  return NextResponse.json({ success: true, completed: false });
}
