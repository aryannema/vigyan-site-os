/**
 * GET /auth/callback — OAuth callback + the authorisation gate.
 *
 * This is the only place a browser session becomes an *authorised* session, so
 * it is the security boundary for the whole admin surface. `middleware.ts` only
 * answers "is there a session?"; the questions "may this person be here?" and
 * "what may they do?" are answered here and in the database.
 *
 * ── Sequence ───────────────────────────────────────────────────────────────
 *   1. exchangeCodeForSession(code)      -> a real GoTrue session, cookies set
 *   2. lower(email) ∈ public.admin_users -> otherwise SIGN OUT + /login?error=unauthorized
 *   3. existing public.user_roles row    -> keep it, verbatim. NEVER downgraded.
 *   4. else email ∈ BOOTSTRAP_ADMIN_EMAILS -> insert user_roles(role='admin')
 *   5. else                              -> no role at all -> /pending-approval
 *
 * Step 5 is the "pending approval" state that 002_admin_auth.sql describes: on
 * the deny-by-default capability model (003), a user with no `user_roles` row
 * can do precisely nothing, which is the correct resting state for someone an
 * admin has allow-listed but not yet assigned a role to. It is a distinct state
 * from "not allow-listed", and it must not be collapsed into either an error or
 * a silent admin grant.
 *
 * Step 3 before step 4 is deliberate: BOOTSTRAP_ADMIN_EMAILS grants a role only
 * when there is none. If an operator later demotes a bootstrap address to
 * `viewer` through the admin UI, that demotion must survive the next sign-in —
 * an env var that silently re-promotes on every login is a privilege-escalation
 * backdoor, not a bootstrap.
 *
 * ── Cookies ────────────────────────────────────────────────────────────────
 * `cookies()` from `next/headers` is READ-ONLY inside a Route Handler, so auth
 * cookies must be written onto a NextResponse object. The final redirect target
 * is not known until the database has been consulted, so cookies are collected
 * on a scratch response and transferred onto whichever redirect wins. Returning
 * a response that did not receive them would drop the session on the floor.
 *
 * ── Database identity ──────────────────────────────────────────────────────
 * The allow-list lives in an RLS-enabled table with no policies (002), i.e. it
 * is reachable only by the service role. This route therefore connects with
 * `pg` straight to `DATABASE_URL` — the same service-role connection pattern as
 * `app/api/mcp/route.ts` and `app/admin/lib/db.ts`, each of which owns a
 * globalThis-cached pool so Next's dev-mode module reloading cannot leak one per
 * compile.
 *
 * ── Failure posture ────────────────────────────────────────────────────────
 * Every unexpected condition signs the user out and returns them to /login.
 * A callback that cannot reach the database cannot know whether the caller is
 * allowed in, and "cannot know" must resolve to "no".
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';

import type { Role } from '../../../types/schema';
import { createRouteHandlerSupabaseClient } from '../../../lib/supabase-server';

// A pooled `pg` connection cannot run on the edge runtime.
export const runtime = 'nodejs';
// Nothing about this route is cacheable.
export const dynamic = 'force-dynamic';

declare global {
  // eslint-disable-next-line no-var
  var __vigyanAuthPool: Pool | undefined;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set; the OAuth callback cannot check the admin allow-list.',
    );
  }
  globalThis.__vigyanAuthPool ??= new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return globalThis.__vigyanAuthPool;
}

/** The role granted to a bootstrap address that has no role yet. */
const BOOTSTRAP_ROLE: Role = 'admin';

/**
 * Parses BOOTSTRAP_ADMIN_EMAILS (comma-separated, case-insensitive).
 *
 * Unset is a normal, expected state — a deployment past its bootstrap has no
 * reason to keep it set, and an empty list simply means "grant nobody a role
 * automatically", which lands every new sign-in in pending-approval.
 */
function bootstrapAdminEmails(): Set<string> {
  return new Set(
    (process.env.BOOTSTRAP_ADMIN_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * Only same-origin, path-absolute `next` values are honoured.
 *
 * `?next=` is attacker-controllable, and a redirect that accepts `//evil.test`
 * or `https://evil.test` turns the login flow into an open redirect — a
 * ready-made credential-phishing primitive, because the link genuinely starts on
 * this site's domain.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/admin';
  if (!raw.startsWith('/')) return '/admin';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/admin';
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${reason}`);

  // The provider can also hand back an error instead of a code (user pressed
  // "cancel", consent withdrawn, misconfigured client).
  if (searchParams.get('error') || searchParams.get('error_description')) {
    return fail('auth_failed');
  }
  if (!code) return fail('missing_code');

  // Scratch response whose only job is to collect the auth cookies that
  // exchangeCodeForSession()/signOut() write, so they can be moved onto the
  // redirect that is chosen further down.
  const cookieSink = new NextResponse(null);
  const supabase = createRouteHandlerSupabaseClient(request, cookieSink);

  /** Moves collected cookies + cache headers onto the response being returned. */
  const withSession = (response: NextResponse): NextResponse => {
    for (const cookie of cookieSink.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    // A response that sets auth cookies must never be cached by a CDN or a
    // reverse proxy; one user's tokens served to another is the failure mode.
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

  const email = user?.email?.trim().toLowerCase() ?? '';
  if (!user || !email) {
    await supabase.auth.signOut();
    return withSession(fail('auth_failed'));
  }

  let destination: string;
  try {
    const client = await getPool().connect();
    try {
      // ── Gate 1: the allow-list ───────────────────────────────────────────
      // admin_users is keyed by the raw email string, so compare lowered on
      // both sides — an address added through the admin UI with different
      // casing must still match.
      const allowed = await client.query<{ email: string }>(
        `SELECT email FROM public.admin_users WHERE lower(email) = $1 LIMIT 1`,
        [email],
      );

      if (allowed.rowCount === 0) {
        await supabase.auth.signOut();
        return withSession(fail('unauthorized'));
      }

      // ── Gate 2: the role ─────────────────────────────────────────────────
      const existing = await client.query<{ role: Role }>(
        `SELECT role FROM public.user_roles WHERE user_id = $1 LIMIT 1`,
        [user.id],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        // Already has a role — whatever it is. Not touched, not upgraded.
        destination = `${origin}${next}`;
      } else if (bootstrapAdminEmails().has(email)) {
        // First admin(s), per 002_admin_auth.sql. ON CONFLICT DO NOTHING makes
        // the concurrent-sign-in race a no-op rather than a 23505.
        //
        // NOTE: user_roles.user_id references auth.users(id). Under real GoTrue
        // that row exists by the time this runs, because GoTrue created it
        // before issuing the code. Against the local 000_local_auth_stub.sql
        // schema with no GoTrue attached, this insert can fail the foreign key —
        // which is caught below and fails closed.
        await client.query(
          `INSERT INTO public.user_roles (user_id, role)
             VALUES ($1, $2)
             ON CONFLICT (user_id) DO NOTHING`,
          [user.id, BOOTSTRAP_ROLE],
        );
        destination = `${origin}${next}`;
      } else {
        // Allow-listed, but nobody has assigned a role yet. No row is written:
        // an absent user_roles row IS the pending state, and deny-by-default
        // does the rest.
        destination = `${origin}/pending-approval`;
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[auth/callback] authorisation check failed:', error);
    await supabase.auth.signOut();
    return withSession(fail('server_error'));
  }

  return withSession(NextResponse.redirect(destination));
}
