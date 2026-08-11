'use client';

/**
 * /login — OAuth sign-in for the admin surface.
 *
 * Deliberately generic: this is a template, so there is no product name, logo or
 * brand colour here. Deployments style it; nothing below encodes an identity.
 *
 * ── Providers ──────────────────────────────────────────────────────────────
 * The plan calls for Google, Microsoft and GitHub eventually. Only Google has an
 * OAuth client configured today, so only Google renders as a working button —
 * the others are declared in PROVIDERS with `enabled: false` and are not
 * rendered at all. Turning one on is an array flag plus the matching GoTrue env
 * vars (GOTRUE_EXTERNAL_<PROVIDER>_ENABLED / _CLIENT_ID / _SECRET); no component
 * changes. Showing a button that cannot work would be worse than showing none.
 *
 * ── Flow ───────────────────────────────────────────────────────────────────
 * signInWithOAuth() redirects to the provider, which redirects back to
 * `${origin}/auth/callback`, which is where the authorisation decision actually
 * happens (admin_users lookup, bootstrap-admin role grant, pending-approval).
 * Nothing on this page is a security boundary — it only starts the flow. The
 * gate is `app/auth/callback/route.ts` and `middleware.ts`.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Provider } from '@supabase/supabase-js';

import { createClient } from '../../lib/supabase-browser';

interface OAuthProviderOption {
  /** The provider id GoTrue knows it by. */
  id: Provider;
  label: string;
  /**
   * False until an OAuth client exists for it server-side. Disabled providers
   * are not rendered — see the note above.
   */
  enabled: boolean;
}

/**
 * Add a provider here + its GoTrue env vars to enable it. Order is display
 * order.
 */
const PROVIDERS: OAuthProviderOption[] = [
  { id: 'google', label: 'Google', enabled: true },
  // Microsoft is `azure` in GoTrue/supabase-js, not `microsoft`.
  { id: 'azure', label: 'Microsoft', enabled: false },
  { id: 'github', label: 'GitHub', enabled: false },
];

/**
 * Query-string error states this page knows how to explain. Anything else falls
 * through to a generic message — the callback route is the only writer of these
 * values, so the two must be kept in step.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized:
    'Access denied. This account is not on the administrator allow-list.',
  auth_failed: 'Sign-in could not be completed. Please try again.',
  missing_code: 'The sign-in response was incomplete. Please try again.',
  server_error:
    'The server could not complete sign-in. Please try again, or contact an administrator if this persists.',
};

/** Provider marks. Inline so the page has no external asset dependency. */
function ProviderIcon({ id }: { id: Provider }) {
  if (id === 'google') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    );
  }
  return null;
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error');

  const [pending, setPending] = useState<Provider | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  // A session can already exist here (the user navigated to /login directly, or
  // the callback bounced them). Offering "continue" beats silently re-running
  // the OAuth dance.
  useEffect(() => {
    let cancelled = false;
    try {
      createClient()
        .auth.getSession()
        .then(({ data }) => {
          if (!cancelled && data.session) setSignedIn(true);
        })
        .catch(() => undefined);
    } catch {
      // Auth backend not configured yet (missing NEXT_PUBLIC_SUPABASE_* env).
      // Leave the page usable rather than crashing the render.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (provider: Provider) => {
    setClientError(null);
    setPending(provider);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setClientError(error.message);
        setPending(null);
      }
      // On success the browser is navigating away; leave `pending` set so the
      // button stays disabled for the rest of this document's life.
    } catch (error) {
      setClientError(
        error instanceof Error ? error.message : 'Sign-in could not be started.',
      );
      setPending(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await createClient().auth.signOut();
    } catch {
      // Nothing actionable; fall through and let the user try again.
    }
    setSignedIn(false);
  }, []);

  if (signedIn) {
    return (
      <div className="space-y-4 rounded-lg border border-border p-6 text-center">
        <p className="text-sm font-medium">You are already signed in.</p>
        <Link
          href="/admin"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Continue to admin
        </Link>
        <div>
          <button
            type="button"
            onClick={signOut}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Use a different account
          </button>
        </div>
      </div>
    );
  }

  const bannerMessage = clientError
    ? clientError
    : errorCode
      ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.auth_failed)
      : null;

  return (
    <div className="space-y-4 rounded-lg border border-border p-6">
      {bannerMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {bannerMessage}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {PROVIDERS.filter((provider) => provider.enabled).map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => void signIn(provider.id)}
            disabled={pending !== null}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 disabled:pointer-events-none disabled:opacity-50"
          >
            {pending === provider.id ? (
              <Spinner />
            ) : (
              <ProviderIcon id={provider.id} />
            )}
            {pending === provider.id
              ? 'Redirecting…'
              : `Sign in with ${provider.label}`}
          </button>
        ))}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Sign-in is restricted to accounts on the administrator allow-list. New
        accounts require approval before they can access the admin panel.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-xs text-muted-foreground">Admin access</p>
        </div>

        {/* useSearchParams() opts this subtree into client rendering; the
            boundary keeps the rest of the page statically renderable. */}
        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-lg border border-border" />
          }
        >
          <LoginForm />
        </Suspense>

        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Return to site
          </Link>
        </div>
      </div>
    </main>
  );
}
