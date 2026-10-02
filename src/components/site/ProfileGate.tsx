'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import CompleteProfileForm from '@/app/(marketing)/complete-profile/CompleteProfileForm';

type FormProps = Omit<React.ComponentProps<typeof CompleteProfileForm>, 'next' | 'onComplete'>;
type Status =
  | { signedIn: false }
  | {
      signedIn: true;
      email: string | null;
      emailVerified: boolean;
      profileComplete: boolean;
      complete: boolean;
      form: FormProps | null;
    };

// Pages a signed-in but unfinished visitor must still be able to reach: the
// onboarding and auth flows themselves, and the legal pages the consent text
// refers to.
const EXEMPT = ['/complete-profile', '/account/register', '/login', '/auth', '/privacy', '/terms', '/refund-policy', '/data-deletion'];

/**
 * Blocks the site for a signed-in visitor until their email is confirmed and
 * their profile (name, verified WhatsApp, billing location) is complete. It
 * cannot be dismissed: no close button, Escape and backdrop clicks do nothing.
 * The only other exit is signing out. Checkout enforces the same rule on the
 * server, so this is the UX, not the security boundary.
 */
export default function ProfileGate() {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const exempt = EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const load = useCallback(async () => {
    if (!/sb-[^=]*-auth-token/.test(document.cookie)) {
      setStatus({ signedIn: false });
      return;
    }
    try {
      const res = await fetch('/api/profile/status', { cache: 'no-store' });
      setStatus(res.ok ? await res.json() : { signedIn: false });
    } catch {
      setStatus({ signedIn: false });
    }
  }, []);

  useEffect(() => {
    if (!exempt) void load();
  }, [exempt, pathname, load]);

  const open = !exempt && status?.signedIn === true && !status.complete;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const block = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', block, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', block, true);
    };
  }, [open]);

  if (!open || !status?.signedIn) return null;

  const signOut = async () => {
    const { createBrowserSupabaseClient } = await import('@/lib/supabase-browser');
    await createBrowserSupabaseClient().auth.signOut();
    window.location.href = '/';
  };

  const resend = async () => {
    if (!status.email) return;
    setResendState('sending');
    const { createBrowserSupabaseClient } = await import('@/lib/supabase-browser');
    const { error } = await createBrowserSupabaseClient().auth.resend({
      type: 'signup',
      email: status.email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm-callback?next=${encodeURIComponent(pathname)}` },
    });
    setResendState(error ? 'error' : 'sent');
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-gate-title"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="space-y-1 text-center">
          <h2 id="profile-gate-title" className="text-xl font-bold text-white">
            {status.emailVerified ? 'Finish setting up your account' : 'Confirm your email'}
          </h2>
          <p className="text-sm text-white/80">
            {status.emailVerified
              ? 'We need your name, a verified WhatsApp number and your billing location before you continue.'
              : `We sent a confirmation link to ${status.email ?? 'your email'}. Open it to continue.`}
          </p>
        </div>

        {status.emailVerified && status.form ? (
          <CompleteProfileForm {...status.form} next={pathname} onComplete={load} />
        ) : (
          <div className="vb-card space-y-4 p-6 text-sm text-body">
            <p>Didn&apos;t get it? Check spam, or send it again.</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={resend}
                disabled={resendState === 'sending' || resendState === 'sent'}
                className="rounded-card bg-saffron-500 px-4 py-2 text-xs font-bold text-[#1c1814] disabled:opacity-60"
              >
                {resendState === 'sending' ? 'Sending…' : resendState === 'sent' ? 'Sent — check your inbox' : 'Resend confirmation email'}
              </button>
              <button type="button" onClick={load} className="text-xs font-bold text-saffron-ink hover:underline">
                I&apos;ve confirmed it
              </button>
            </div>
            {resendState === 'error' && <p className="text-xs font-bold text-red-600">Could not send right now — try again in a minute.</p>}
          </div>
        )}

        <p className="text-center text-xs text-white/70">
          Not now?{' '}
          <button type="button" onClick={signOut} className="font-bold underline">
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
