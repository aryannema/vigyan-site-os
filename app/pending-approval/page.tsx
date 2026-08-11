import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * /pending-approval — where an allow-listed account with no role lands.
 *
 * Reached from `app/auth/callback/route.ts` when the signed-in email IS in
 * `public.admin_users` but has no `public.user_roles` row and is not in
 * BOOTSTRAP_ADMIN_EMAILS. The session is real; the authorisation is not there
 * yet. Under the deny-by-default capability model (003_role_expansion.sql) a
 * user with no role can do nothing, so this page is the honest description of
 * that state rather than an error.
 *
 * Static and dependency-free on purpose: it must render for someone who cannot
 * read a single row of the database.
 */

export const metadata: Metadata = {
  title: 'Pending approval',
  robots: { index: false, follow: false },
};

export default function PendingApprovalPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border p-6 text-center">
        <h1 className="text-lg font-semibold">Pending approval</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your account is pending approval. An administrator needs to assign your
          role before you can access the admin panel.
        </p>
        <div className="flex items-center justify-center gap-4 pt-2 text-xs">
          <Link
            href="/login"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Back to sign in
          </Link>
          <Link
            href="/"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Return to site
          </Link>
        </div>
      </div>
    </main>
  );
}
