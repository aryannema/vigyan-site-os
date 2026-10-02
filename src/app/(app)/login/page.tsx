'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import BrandMark from '@/components/brand/BrandMark';

/**
 * Query-string error states this page knows how to explain. The OAuth callback
 * (`src/app/auth/callback/route.ts`) is the only writer of these values, so the
 * two must be kept in step — `missing_code` and `server_error` were added there
 * when the callback was reconciled with the new roles-and-capabilities schema.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized:
    'Access denied. This account is not on the administrator allow-list.',
  auth_failed: 'Sign-in could not be completed. Please try again.',
  missing_code: 'The sign-in response was incomplete. Please try again.',
  server_error:
    'The server could not complete sign-in. Please try again, or contact an administrator if this persists.',
};

function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [alreadySignedIn, setAlreadySignedIn] = useState(false);
  const searchParams = useSearchParams();
  const authError = searchParams.get('error');
  const errorMessage = authError
    ? (ERROR_MESSAGES[authError] ?? ERROR_MESSAGES.auth_failed)
    : null;

  useEffect(() => {
    createBrowserSupabaseClient().auth.getSession().then(({ data }) => {
      if (data.session) setAlreadySignedIn(true);
    });
  }, []);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    // Middleware puts the originally-requested admin path in `?next=` when it
    // bounces an unauthenticated visitor here; forward it so the callback can
    // land them where they were going. The callback validates it as a
    // same-origin, path-absolute value before redirecting.
    const nextPath = searchParams.get('next');
    const callback = new URL('/auth/callback', window.location.origin);
    if (nextPath) callback.searchParams.set('next', nextPath);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
      },
    });
  };

  const handleSignOut = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    setAlreadySignedIn(false);
  };

  if (alreadySignedIn) {
    return (
      <div className="vb-card space-y-4 p-8 text-center shadow-warm-md">
        <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-green-700/20 bg-green-700/10">
          <svg className="h-5 w-5 text-green-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-ink">You are signed in</p>
        <p className="text-xs text-muted">Your session is active.</p>
        <a
          href="/admin"
          className="mt-2 inline-block rounded-card bg-saffron-500 px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition hover:brightness-[1.04]"
        >
          Go to Dashboard
        </a>
        <div>
          <button onClick={handleSignOut} className="text-xs text-muted transition hover:text-ink">
            Sign out and use a different account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vb-card space-y-6 p-8 shadow-warm-md">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-bold text-red-600"
        >
          {errorMessage}
        </div>
      )}

      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-card border border-hairline-strong bg-surface py-4 text-sm font-bold text-ink shadow-warm-sm transition hover:border-saffron-500/50 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <svg className="h-5 w-5 animate-spin text-muted" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        {loading ? 'Redirecting…' : 'Sign in with Google'}
      </button>

    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper p-4">
      <div className="relative z-10 w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <div className="mb-4 inline-flex items-center justify-center">
            <BrandMark size={48} on="ivory" className="dark:hidden" />
            <BrandMark size={48} on="deep" className="hidden dark:block" />
          </div>
          <h1 className="text-2xl font-bold text-ink">Sign in</h1>
        </div>

        <Suspense fallback={<div className="vb-card h-32 animate-pulse" />}>
          <LoginForm />
        </Suspense>

        <div className="text-center">
          <Link href="/" className="text-xs text-muted transition hover:text-saffron-ink">
            ← Return to Public Site
          </Link>
        </div>
      </div>
    </div>
  );
}
