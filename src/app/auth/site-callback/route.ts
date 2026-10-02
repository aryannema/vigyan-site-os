/**
 * GET /auth/site-callback — OAuth callback for PUBLIC site registration.
 *
 * Deliberately a SEPARATE route from /auth/callback (the admin gate). That
 * route signs out and rejects any email not on admin_users — reusing it here
 * would bounce every ordinary visitor who tries to create a site account.
 * This route does the opposite: it never checks admin_users, never touches
 * user_roles, and only ever upserts public.site_accounts — a table with zero
 * relationship to the admin RBAC system (see migration
 * 011_products_razorpay_public_accounts.sql §4, and admin/lib/db.ts's header
 * on the same separation). Signing in here can never grant /admin access;
 * middleware.ts's admin gate is keyed off admin_users membership alone, which
 * this route does not write to.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createRouteHandlerSupabaseClient } from '@/lib/supabase-server';
import { isProfileComplete, safeNextPath } from '@/lib/site-accounts';
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

  // Uses the just-established user session, not a service-role connection —
  // site_accounts' own "self insert/update" RLS policies (011 §4) are what
  // authorize this write, the same trust boundary a client-side insert would
  // go through. No admin/owner connection is involved anywhere in this route.
  const { error: upsertError } = await supabase.from('site_accounts').upsert(
    {
      user_id: user.id,
      email: user.email.trim().toLowerCase(),
      full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    { onConflict: 'user_id' },
  );
  if (upsertError) {
    console.error('[auth/site-callback] site_accounts upsert failed:', upsertError);
    // The session is still valid even if this write failed — do not sign the
    // user out over a bookkeeping row. /account can re-attempt on next load.
  }

  // Mandatory profile-completion gate: every Google sign-in (fresh or
  // returning) lands here first, so this is the earliest point to check —
  // catches it before the user ever sees `next`. A returning session that
  // doesn't hit this route again (no fresh OAuth redirect) is caught by the
  // equivalent check in account/page.tsx.
  const { data: account } = await supabase
    .from('site_accounts')
    .select('first_name, last_name, whatsapp_verified_at, billing_country, billing_state_code')
    .eq('user_id', user.id)
    .maybeSingle();

  const target = isProfileComplete(account)
    ? next
    : `/complete-profile?next=${encodeURIComponent(next)}`;

  return withSession(NextResponse.redirect(`${origin}${target}`));
}
