'use client';

/**
 * Public site registration — sign in with Google, land in public.site_accounts.
 *
 * Grants ZERO admin console access by construction: this goes through
 * /auth/site-callback, not /auth/callback, and site_accounts has no
 * relationship to admin_users/user_roles/role_capabilities (see that route's
 * header and migration 011 §4). A visitor who registers here can never open
 * /admin — the two auth flows share only "Google sign-in", nothing else.
 */

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import BrandMark from '@/components/brand/BrandMark';

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Sign-in could not be completed. Please try again.',
  missing_code: 'The sign-in response was incomplete. Please try again.',
};

type PasswordMode = 'signup' | 'signin';

function RegisterForm() {
  const [loading, setLoading] = useState(false);
  const [alreadySignedIn, setAlreadySignedIn] = useState(false);
  const searchParams = useSearchParams();
  const authError = searchParams.get('error');
  const errorMessage = authError ? (ERROR_MESSAGES[authError] ?? ERROR_MESSAGES.auth_failed) : null;

  const [passwordMode, setPasswordMode] = useState<PasswordMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [checkEmailSent, setCheckEmailSent] = useState(false);

  useEffect(() => {
    createBrowserSupabaseClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) setAlreadySignedIn(true);
      });
  }, []);

  const nextParam = searchParams.get('next');

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    const callback = new URL('/auth/site-callback', window.location.origin);
    if (nextParam) callback.searchParams.set('next', nextParam);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordLoading(true);
    const supabase = createBrowserSupabaseClient();
    try {
      if (passwordMode === 'signup') {
        const callback = new URL('/auth/confirm-callback', window.location.origin);
        if (nextParam) callback.searchParams.set('next', nextParam);
        const { error, data } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callback.toString() },
        });
        if (error) {
          setPasswordError(error.message);
          return;
        }
        // Self-hosted GoTrue requires email confirmation (see docs/OPS.md
        // §11) — no active session yet, data.session is null until the
        // user clicks the emailed link.
        if (!data.session) {
          setCheckEmailSent(true);
          return;
        }
        // Some GoTrue configs return an active session immediately even
        // with confirmation nominally required — handle that path too.
        window.location.href = nextParam ? `/complete-profile?next=${encodeURIComponent(nextParam)}` : '/complete-profile';
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setPasswordError(error.message);
          return;
        }
        // account/page.tsx's own gate redirects to /complete-profile if
        // this account's profile isn't complete yet — no need to
        // duplicate that check here.
        window.location.href = nextParam || '/account';
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    setAlreadySignedIn(false);
  };

  if (alreadySignedIn) {
    return (
      <div className="vb-card space-y-4 p-8 text-center shadow-warm-md">
        <p className="text-sm font-semibold text-ink">You are signed in</p>
        <a
          href="/account"
          className="mt-2 inline-block rounded-card bg-saffron-500 px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition hover:brightness-[1.04]"
        >
          Go to My Account
        </a>
        <div>
          <button onClick={handleSignOut} className="text-xs text-muted transition hover:text-ink">
            Sign out and use a different account
          </button>
        </div>
      </div>
    );
  }

  if (checkEmailSent) {
    return (
      <div className="vb-card space-y-4 p-8 text-center shadow-warm-md">
        <p className="text-sm font-semibold text-ink">Check your email</p>
        <p className="text-xs text-muted">
          We sent a confirmation link to <span className="font-bold text-ink">{email}</span>. Click it to finish creating your account.
        </p>
        <button
          onClick={() => setCheckEmailSent(false)}
          className="text-xs font-bold text-saffron-ink hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="vb-card space-y-6 p-8 shadow-warm-md">
      {errorMessage && (
        <div role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-bold text-red-600">
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
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-hairline" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-faint">or</span>
        <div className="h-px flex-1 bg-hairline" />
      </div>

      {passwordError && (
        <div role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-bold text-red-600">
          {passwordError}
        </div>
      )}

      <form onSubmit={handlePasswordSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
        />
        <button
          type="submit"
          disabled={passwordLoading}
          className="w-full rounded-card bg-saffron-500 py-3 text-sm font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {passwordLoading ? 'Please wait…' : passwordMode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button
        onClick={() => {
          setPasswordMode(passwordMode === 'signup' ? 'signin' : 'signup');
          setPasswordError(null);
        }}
        className="w-full text-center text-xs text-muted transition hover:text-ink"
      >
        {passwordMode === 'signup' ? 'I already have an account' : "I don't have an account yet"}
      </button>

      <p className="text-center text-[11px] text-muted">
        Create your YourSite account to track orders and access purchased blueprints. By continuing,
        you agree to our{' '}
        <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-bold text-saffron-ink hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="relative flex min-h-[80vh] items-center justify-center overflow-hidden bg-paper p-4 pt-24">
      <div className="relative z-10 w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <div className="mb-4 inline-flex items-center justify-center">
            <BrandMark size={48} on="ivory" className="dark:hidden" />
            <BrandMark size={48} on="deep" className="hidden dark:block" />
          </div>
          <h1 className="text-2xl font-bold text-ink">Create your account</h1>
          <p className="text-sm text-muted">YourSite</p>
        </div>

        <Suspense fallback={<div className="vb-card h-32 animate-pulse" />}>
          <RegisterForm />
        </Suspense>

        <div className="text-center">
          <Link href="/" className="text-xs text-muted transition hover:text-saffron-ink">
            ← Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
