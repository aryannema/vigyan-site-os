import type { Metadata } from 'next';

import { AdminNav } from './components/AdminNav';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/**
 * ⚠ THIS ROUTE GROUP IS CURRENTLY UNAUTHENTICATED.
 *
 * No GoTrue/auth backend is wired up in this phase, so there is deliberately no
 * middleware, no session lookup and no login stub here — a fake auth layer would
 * be worse than an obviously absent one, because it looks like protection.
 *
 * WHEN AUTH LANDS, gating `/admin/*` should need no change to any page:
 *
 *   1. Add `middleware.ts` at the repo root with
 *      `export const config = { matcher: ['/admin/:path*'] }`, resolving the
 *      session and redirecting unauthenticated requests to the login route.
 *      That covers every route under this layout in one place.
 *   2. Resolve the session user here and pass it down (context or props) so the
 *      nav can hide sections the user lacks `<resource>:view` for. The nav's
 *      section names already match RESOURCE_KEYS for exactly this reason.
 *   3. Switch `mutate()` in `app/admin/lib/db.ts` over to
 *      `public.perform_action()` with the real user id, which turns on the
 *      per-action capability check for every admin write at once.
 *
 * See BLOCKERS.md #3.
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
          <p className="mt-6 rounded-md border border-border px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
            No authentication layer is configured. Every visitor has full access.
          </p>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
