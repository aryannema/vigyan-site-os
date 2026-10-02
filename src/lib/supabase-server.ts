/**
 * Server-side Supabase (GoTrue) client factories.
 *
 * SERVER ONLY.
 *
 * Three call sites need three different cookie strategies, and conflating them
 * is the usual source of "random logout" bugs, so each gets its own factory:
 *
 *   createServerSupabaseClient()          Server Components / Server Actions.
 *                                         `cookies()` from `next/headers` is
 *                                         READ-ONLY in a Server Component, so
 *                                         `setAll` is a no-op guarded by
 *                                         try/catch. Session REFRESH therefore
 *                                         has to happen in middleware — see
 *                                         `src/middleware.ts`.
 *
 *   createRouteHandlerSupabaseClient(req, res)
 *                                         Route Handlers. Cookies are read off
 *                                         the request and written onto a
 *                                         NextResponse the caller built FIRST,
 *                                         because `cookies()` is likewise
 *                                         read-only there. Used by
 *                                         `src/app/auth/callback/route.ts`.
 *
 *   createMiddlewareSupabaseClient(req)   Middleware. Returns the client plus
 *                                         the response it writes refreshed
 *                                         tokens onto; the caller MUST return
 *                                         that response (or copy its cookies)
 *                                         or the refreshed session is dropped.
 *
 * These are the ANON key paths: they authenticate a *user*. Service-role
 * database work does NOT go through them — the admin write path uses `pg`
 * against `DATABASE_URL` (`src/app/(app)/admin/lib/db.ts`), and the older
 * surfaces use `supabaseAdmin` from `src/lib/supabase.ts`.
 *
 * Ported from vigyan-site-os's `lib/supabase-server.ts` (2026-08-11), which
 * replaced this file's single hand-rolled factory. The
 * `NEXT_PUBLIC_SUPABASE_ID` fallback that used to be here is kept for the
 * benefit of any environment still setting that older name.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_* vars are inlined at build time by Next, so they cannot be read
// from a variable name or a destructured `process.env` — the literal member
// access below is required.
function supabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_ID ||
    ''
  );
}

function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

/**
 * For Server Components and Server Actions.
 *
 * Next 15 makes `cookies()` async, hence the await. Writes are attempted and
 * swallowed: from a Server Action they succeed, from a Server Component they
 * throw, and there is nothing useful to do about it there because middleware
 * already refreshed the session for that request.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. Safe to ignore — middleware owns session refresh.
        }
      },
    },
  });
}

/**
 * For Route Handlers.
 *
 * `response` must be a NextResponse the caller has ALREADY constructed (usually
 * the redirect it intends to return), because cookies set on any other object
 * are discarded. Returning a different response than the one passed here loses
 * the session.
 */
export function createRouteHandlerSupabaseClient(
  request: NextRequest,
  response: NextResponse,
): SupabaseClient {
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Auth cookies must never be cached by a CDN or reverse proxy, or one
        // user's tokens can be served to another. @supabase/ssr supplies the
        // exact headers; just apply them.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });
}

/**
 * For middleware.
 *
 * Returns the client and a `getResponse()` accessor — NOT a plain `response`
 * property. The response object is REPLACED on every `setAll` (the documented
 * @supabase/ssr middleware pattern, so refreshed cookies are visible both to the
 * downstream render via `request.cookies` and to the browser via
 * `response.cookies`), so a property destructured before `getUser()` runs would
 * be a stale object with no refreshed tokens on it. A function call forces the
 * read to happen after.
 */
export function createMiddlewareSupabaseClient(request: NextRequest): {
  supabase: SupabaseClient;
  getResponse: () => NextResponse;
} {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  return { supabase, getResponse: () => response };
}
