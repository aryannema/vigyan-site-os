import { createClient } from '@supabase/supabase-js';

// Support both URL and ID naming conventions found in .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_ID || 'https://placeholder.supabase.co';
// createClient() throws synchronously on an empty-string key (not just undefined) --
// in an environment with zero Supabase env vars set (e.g. a CI build with no
// secrets), that crashes every route/page at import time, not just DB calls.
// A non-empty placeholder lets the client construct; real calls still fail
// cleanly at request time via each caller's existing error handling.
const PLACEHOLDER_KEY = 'placeholder-key-no-supabase-env-set';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Client for public/frontend use (anon key, subject to RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Client for server-side administrative use — bypasses RLS.
// ONLY import this in API routes and async Server Components.
// Never use NEXT_PUBLIC_ for SUPABASE_SERVICE_ROLE_KEY.
if (!supabaseServiceKey && typeof window === 'undefined') {
  console.error(
    '[SECURITY] SUPABASE_SERVICE_ROLE_KEY is not set. ' +
    'supabaseAdmin is operating with the anon key — RLS will NOT be bypassed. ' +
    'Set this variable in .env.local for local dev and in Vercel for production.'
  );
}
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey || PLACEHOLDER_KEY
);
