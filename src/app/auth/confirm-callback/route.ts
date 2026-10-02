/**
 * GET /auth/confirm-callback — lands here after a user clicks the
 * confirmation link GoTrue emails after email+password signUp()
 * (options.emailRedirectTo points here from account/register/page.tsx).
 *
 * Mirrors auth/site-callback/route.ts's PKCE code-exchange pattern (this
 * app's @supabase/ssr clients default to flowType: 'pkce', which GoTrue's
 * confirmation links also use) -- verify this holds against live behavior
 * the first time a real confirmation email is clicked; if GoTrue instead
 * sends a hash-fragment token for this specific deployed version, this
 * route needs a client-side companion to read `#access_token=...` before it
 * can help (a materially different mechanism, not just a tweak here).
 *
 * A password-authenticated user always lands on /complete-profile
 * unconditionally on their very first confirmation -- a brand-new
 * site_accounts row can never already be complete, so there's no need to
 * re-check (unlike auth/site-callback/route.ts, which handles both fresh
 * and returning Google sign-ins and does need the check).
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createRouteHandlerSupabaseClient } from '@/lib/supabase-server';
import { safeNextPath } from '@/lib/site-accounts';
import { publicOrigin } from '@/lib/public-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/account/register?error=${reason}`);

  if (searchParams.get('error') || searchParams.get('error_description')) {
    return fail('auth_failed');
  }
  if (!code) return fail('missing_code');

  const cookieSink = new NextResponse(null);
  const supabase = createRouteHandlerSupabaseClient(request, cookieSink);

  const withSession = (response: NextResponse): NextResponse => {
    for (const cookie of cookieSink.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    response.headers.set(
      'Cache-Control',
      'private, no-cache, no-store, must-revalidate, max-age=0',
    );
    return response;
  };

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return withSession(fail('auth_failed'));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    await supabase.auth.signOut();
    return withSession(fail('auth_failed'));
  }

  // Same self-insert RLS policy (011 §4) as auth/site-callback/route.ts —
  // the just-established session authorizes this write, no service-role
  // connection involved.
  const { error: upsertError } = await supabase.from('site_accounts').upsert(
    { user_id: user.id, email: user.email.trim().toLowerCase() },
    { onConflict: 'user_id' },
  );
  if (upsertError) {
    console.error('[auth/confirm-callback] site_accounts upsert failed:', upsertError);
  }

  return withSession(
    NextResponse.redirect(`${origin}/complete-profile?next=${encodeURIComponent(next)}`),
  );
}
