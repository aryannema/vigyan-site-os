import type { ReactNode } from 'react';

/**
 * Caps how long the registration shell may be cached.
 *
 * page.tsx is a client component, and route segment config is INERT there —
 * `export const dynamic` written in that file has no effect at all. So the
 * segment inherits the (marketing) layout, which is a 86400 CEILING, and the
 * sign-in shell would be served from a day-old cache.
 *
 * Nothing user-specific is server-rendered here (the Supabase client and
 * useSearchParams both run in the browser), so this is a staleness concern
 * rather than a privacy one: a change to the copy or the error messages on an
 * auth surface should reach people in minutes, not tomorrow.
 */
export const revalidate = 300;

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
