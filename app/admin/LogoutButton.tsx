'use client';

/**
 * Sign-out control for the admin shell.
 *
 * `signOut()` clears the GoTrue session cookies client-side; the hard navigation
 * afterwards (rather than `router.push`) is deliberate — it discards every
 * cached Server Component payload rendered for the old session instead of
 * leaving admin data sitting in the client router cache after logout.
 */

import { useCallback, useState } from 'react';

import { createClient } from '../../lib/supabase-browser';

export function LogoutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  const signOut = useCallback(async () => {
    setPending(true);
    try {
      await createClient().auth.signOut();
    } catch {
      // Already signed out, or no auth backend configured. Either way the
      // correct next step is the same: go to /login.
    }
    window.location.assign('/login');
  }, []);

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className={
        className ??
        'w-full rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
      }
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export default LogoutButton;
