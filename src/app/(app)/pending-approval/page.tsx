import type { Metadata } from 'next';
import Link from 'next/link';

import BrandMark from '@/components/brand/BrandMark';

/**
 * /pending-approval — where an allow-listed account with no role lands.
 *
 * Reached from `src/app/auth/callback/route.ts` when the signed-in email IS in
 * `public.admin_users` but has no `public.user_roles` row and is not in
 * BOOTSTRAP_ADMIN_EMAILS. The session is real; the authorisation is not there
 * yet. Under the deny-by-default capability model (003_role_expansion.sql) a
 * user with no role can do nothing, so this page is the honest description of
 * that state rather than an error.
 *
 * Dependency-free on purpose: it must render for someone who cannot read a
 * single row of the database.
 */

export const metadata: Metadata = {
  title: 'Pending approval · YourSite',
  robots: { index: false, follow: false },
};

export default function PendingApprovalPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-md space-y-5 text-center">
        <div className="inline-flex items-center justify-center">
          <BrandMark size={44} on="ivory" className="dark:hidden" />
          <BrandMark size={44} on="deep" className="hidden dark:block" />
        </div>
        <div className="vb-card space-y-3 p-8 shadow-warm-md">
          <h1 className="text-lg font-bold text-ink">Pending approval</h1>
          <p className="text-sm leading-relaxed text-muted">
            Your account is on the administrator allow-list, but no role has been
            assigned to it yet. An existing administrator needs to grant you one
            before you can use the admin console.
          </p>
        </div>
        <div className="flex items-center justify-center gap-4 text-xs">
          <Link href="/login" className="text-muted transition hover:text-saffron-ink">
            Back to sign in
          </Link>
          <Link href="/" className="text-muted transition hover:text-saffron-ink">
            Return to site
          </Link>
        </div>
      </div>
    </main>
  );
}
