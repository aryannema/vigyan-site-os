import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase';
import { verifyDeletionToken, executeAccountDeletion } from '@/lib/account-deletion';
import { siteConfig } from '@/config/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/account-deletion/confirm-email?token=...
 *
 * Reached by clicking the link api/account-deletion/request emailed.
 * Verifying the token proves email ownership; deletion only actually
 * executes once the separate WhatsApp code (see api/account-deletion/
 * verify-whatsapp) has ALSO been confirmed for the same request.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || '';
  const redirect = (status: string) =>
    NextResponse.redirect(`${siteConfig.url}/data-deletion/request?status=${status}`);

  if (!token) return redirect('invalid');

  const { data: pendingRows, error: fetchError } = await supabaseAdmin
    .from('account_deletion_requests')
    .select('id, user_id, email_token_hash, email_token_expires_at, email_verified_at, whatsapp_verified_at')
    .is('email_verified_at', null)
    .gt('email_token_expires_at', new Date().toISOString());
  if (fetchError) {
    console.error('[account-deletion/confirm-email] lookup failed:', fetchError);
    return redirect('error');
  }

  const match = (pendingRows || []).find((row) => verifyDeletionToken(token, row.email_token_hash));
  if (!match) return redirect('expired');

  const now = new Date().toISOString();
  await supabaseAdmin
    .from('account_deletion_requests')
    .update({ email_verified_at: now })
    .eq('id', match.id);

  if (match.whatsapp_verified_at) {
    const result = await executeAccountDeletion(match.user_id, 'verified_request', {
      emailVerifiedAt: now,
      whatsappVerifiedAt: match.whatsapp_verified_at,
    });
    await supabaseAdmin.from('account_deletion_requests').delete().eq('id', match.id);
    return redirect(result.success ? 'completed' : 'error');
  }

  return redirect('email-confirmed');
}
