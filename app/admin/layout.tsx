import type { Metadata } from 'next';

import { AdminNav } from './components/AdminNav';
import { LogoutButton } from './LogoutButton';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/**
 * ⚠ THIS ROUTE GROUP IS SESSION-GATED, NOT YET CAPABILITY-GATED.
 *
 * Step 1 of the plan below is now done: `middleware.ts` at the repo root matches
 * `/admin/:path*`, resolves the GoTrue session and bounces unauthenticated
 * requests to `/login`. Whether the signed-in person is ALLOWED here (the
 * `public.admin_users` allow-list) is decided in `app/auth/callback/route.ts`;
 * WHAT they may do is decided in the database.
 *
 * STILL OUTSTANDING:
 *
 *   2. Resolve the session user here and pass it down (context or props) so the
 *      nav can hide sections the user lacks `<resource>:view` for. The nav's
 *      section names already match RESOURCE_KEYS for exactly this reason.
 *   3. Switch `mutate()` in `app/admin/lib/db.ts` over to
 *      `public.perform_action()` with the real session user id (it currently
 *      uses the `ADMIN_ACTOR` env var), which turns on the per-action
 *      capability check for every admin write at once.
 *
 * Until (3) lands, every signed-in admin acts as the single configured actor, so
 * the per-user capability matrix is not yet enforced on writes. See BLOCKERS.md #3.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border p-4 md:sticky md:top-0 md:h-screen md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
          <div className="mb-4 px-2">
            <div className="text-sm font-semibold">Admin</div>
            <div className="text-xs text-muted-foreground">Site OS</div>
          </div>
          <AdminNav />
          <div className="mt-6">
            <LogoutButton />
          </div>
          <p className="mt-3 rounded-md border border-border px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Sign-in is required to reach these pages. Per-user capability checks
            on writes are not enabled yet.
          </p>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
