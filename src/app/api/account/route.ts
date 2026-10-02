import { NextResponse, type NextRequest } from 'next/server';

import { createRouteHandlerSupabaseClient } from '@/lib/supabase-server';
import { executeAccountDeletion } from '@/lib/account-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/account
 *
 * Signed-in self-service deletion — being logged in already proves identity
 * (Google OAuth or password + confirmed email), so this doesn't need the
 * dual-channel verification the unauthenticated flow (api/account-deletion/*)
 * uses. The client confirms via a typed "DELETE" step, not an OTP.
 *
 * Resource-oriented: DELETE on the account resource itself, not a verb-named
 * sub-path (was POST .../account/delete) — moved 2026-09-09.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const response = new NextResponse(null);
  const supabase = createRouteHandlerSupabaseClient(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return withCookies(NextResponse.json({ error: 'Not signed in' }, { status: 401 }), response);
  }

  const result = await executeAccountDeletion(user.id, 'self_service');
  if (!result.success) {
    return withCookies(NextResponse.json({ error: result.error || 'Could not delete account.' }, { status: 500 }), response);
  }

  await supabase.auth.signOut();
  return withCookies(NextResponse.json({ success: true }), response);
}

function withCookies(json: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    json.cookies.set(cookie);
  }
  return json;
}
