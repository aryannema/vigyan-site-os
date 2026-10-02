/**
 * Middleware — the session gate in front of /admin/*.
 *
 * ── What this does and does NOT decide ─────────────────────────────────────
 * It answers ONE question: is there a valid session? It does NOT decide whether
 * the user is allow-listed or what they may do. Those live where the data is:
 *
 *   allow-list  -> src/app/auth/callback/route.ts  (public.admin_users)
 *   capability  -> the database (public.perform_action / user_has_capability)
 *
 * Middleware has no database connection available, so putting an authorisation
 * decision here would mean either duplicating the rule or trusting a
 * client-readable claim. Both drift; the database does not.
 *
 * ── Session refresh ────────────────────────────────────────────────────────
 * `getUser()` is what refreshes an expiring token, and the refreshed cookies are
 * written onto the response object that `createMiddlewareSupabaseClient` hands
 * back. That response MUST be the one returned (or its cookies copied onto a
 * redirect), or users get randomly logged out when a token rotates. The previous
 * version of this file dropped those cookies on the /login redirect path.
 * Note also: use `getUser()`, never `getSession()`, in server code —
 * `getSession()` trusts the cookie contents without revalidating them.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createMiddlewareSupabaseClient } from '@/lib/supabase-server';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { supabase, getResponse } = createMiddlewareSupabaseClient(request);

  // Always call this, on every matched request: it is both the session check
  // and the token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const response = getResponse();
  const { pathname } = request.nextUrl;

  // Unauthenticated -> /login, remembering where they were headed so the
  // callback can send them back (validated as a same-origin path there).
  if (pathname.startsWith('/admin') && !user) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/admin') {
      loginUrl.searchParams.set('next', pathname);
    }
    const redirect = NextResponse.redirect(loginUrl);
    // Carry any refreshed cookies across, so the redirect does not discard a
    // token rotation that just happened.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  // /login and /pending-approval are matched only so the session is refreshed
  // while they render; an already-signed-in visitor is NOT bounced to /admin
  // from here, because middleware cannot tell an authorised user from one
  // sitting in pending-approval. The login page offers a "Go to Dashboard"
  // link instead.
  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/login', '/pending-approval'],
};
