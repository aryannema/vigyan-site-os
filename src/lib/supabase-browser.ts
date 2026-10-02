/**
 * Browser-side Supabase (GoTrue) client factory.
 *
 * BROWSER ONLY. Every importer is a `'use client'` module — the anon key is
 * publishable by design, but nothing here should be pulled into a Server
 * Component, because a server render has no `document.cookie` to read the
 * session from.
 *
 * `createBrowserClient()` is a singleton per (url, key) pair, so calling this
 * from several components is cheap and returns the same client. Centralising it
 * means the env-var names are read in exactly one place.
 *
 * NEXT_PUBLIC_* vars are inlined at build time by Next, so they cannot be read
 * from a variable name or a destructured `process.env` — the literal member
 * access below is required.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createBrowserSupabaseClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_ID ||
      '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  );
}

/** Shorter alias, matching the name used by code ported from vigyan-site-os. */
export const createClient = createBrowserSupabaseClient;
