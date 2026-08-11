/**
 * Edge middleware — the session gate in front of /admin/*.
 *
 * BLOCKERS.md #3 records the root cause it closes: `/admin/*` had no auth gate
 * of any kind, so every visitor reached every admin page. This file is that
 * gate. `app/admin/layout.tsx` predicted exactly this shape ("add middleware.ts
 * at the repo root with matcher ['/admin/:path*']"), so no page under the admin
 * layout needs to change.
 *
 * ── What this does and does NOT decide ─────────────────────────────────────
 * It answers ONE question: is there a valid session? It does NOT decide whether
 * the user is allow-listed or what they may do. Those live where the data is:
 *
 *   allow-list  -> app/auth/callback/route.ts (public.admin_users)
 *   capability  -> the database (public.perform_action / user_has_capability)
 *
 * Middleware runs on the edge runtime with no database connection available, so
 * putting an authorisation decision here would mean either duplicating the rule
 * or trusting a client-readable claim. Both drift; the database does not.
 *
 * ── Session refresh ────────────────────────────────────────────────────────
 * `getUser()` is what refreshes an expiring token, and the refreshed cookies are
 * written onto the response object that `createMiddlewareSupabaseClient` hands
 * back. That response MUST be the one returned (or its cookies copied onto a
 * redirect), or users get randomly logged out when a token rotates. Note also:
 * use `getUser()`, never `getSession()`, in server code — `getSession()` trusts
 * the cookie contents without revalidating them against the auth server.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createMiddlewareSupabaseClient } from './lib/supabase-server';

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

  // /login is matched only so the session is refreshed while it renders; an
  // already-signed-in visitor is NOT bounced to /admin from here, because
  // middleware cannot tell an authorised user from one sitting in
  // pending-approval. The page offers a "Continue to admin" link instead.
  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/login'],
};
