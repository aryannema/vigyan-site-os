/**
 * Browser-side Supabase (GoTrue) client factory.
 *
 * BROWSER ONLY. Every importer is a `'use client'` module — the anon key is
 * publishable by design, but nothing here should be pulled into a Server
 * Component, because a server render has no `document.cookie` to read the
 * session from.
 *
 * ── Why a wrapper and not `createBrowserClient` inline ──────────────────────
 * `createBrowserClient()` is a singleton per (url, key) pair, so calling this
 * from several components is cheap and returns the same client. Centralising it
 * means the env-var names are read in exactly one place, so the day the auth
 * backend moves (Supabase Cloud -> self-hosted GoTrue -> anything else) there is
 * one file to change rather than every component that signs a user in.
 *
 * ── Environment ────────────────────────────────────────────────────────────
 * NEXT_PUBLIC_SUPABASE_URL       e.g. http://127.0.0.1:9999 (self-hosted GoTrue)
 * NEXT_PUBLIC_SUPABASE_ANON_KEY  the anon JWT signed with GOTRUE_JWT_SECRET
 *
 * NEITHER IS SET YET. There is no auth server running for this repo (see
 * BLOCKERS.md #3), so these are read with `!` on the understanding that they
 * will exist before any of this code is exercised. `NEXT_PUBLIC_*` vars are
 * inlined at build time by Next, so they cannot be read from a variable name or
 * a destructured `process.env` — the literal member access below is required.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Longer alias, mirroring the server helper's naming. */
export const createBrowserSupabaseClient = createClient;
