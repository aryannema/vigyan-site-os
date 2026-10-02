import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { SectionContent } from './content-schema';

/**
 * Loads every site_content row in ONE query, memoized per request.
 *
 * WHY THIS EXISTS: getSectionContent was issuing a separate Supabase round-trip
 * per section. The homepage calls it 27 times, sequentially — at build time that
 * is 27 serial network round-trips, and `next build` failed with:
 *
 *   Failed to build /(marketing)/page: / (attempt 1 of 3)
 *   because it took more than 60 seconds
 *
 * on both / and /about. One query instead of 27 removes the timeout entirely,
 * and every page benefits, not just the homepage.
 *
 * React's `cache()` scopes memoization to a single request/render pass, so a
 * static build fetches once while a dynamic render still gets fresh data on the
 * next request. A module-level promise would have cached across requests and
 * served stale content — which the original comment about bypassing caches
 * explicitly did not want.
 */
const loadAllContent = cache(
  async (): Promise<Map<string, unknown>> => {
    try {
      // supabaseAdmin (service role) as before: bypasses RLS so server-side
      // rendering sees the latest rows.
      const { data, error } = await supabaseAdmin
        .from('site_content')
        .select('section_id, content_data');

      if (error || !data) return new Map();
      return new Map(data.map((row) => [row.section_id, row.content_data]));
    } catch (err) {
      console.error('[content] Failed to load site_content:', err);
      return new Map();
    }
  },
);

/**
 * Fetches content for a specific site section from Supabase.
 * If the section doesn't exist or an error occurs, it returns the provided fallback.
 *
 * Signature is unchanged — callers do not need editing.
 */
export async function getSectionContent<T extends SectionContent>(
  sectionId: string,
  fallback: T,
): Promise<T> {
  try {
    const content = await loadAllContent();
    const value = content.get(sectionId);

    // Graceful degradation preserved: an empty table, a missing row, or an
    // unreachable database all fall back to the hardcoded content, so the site
    // still builds and renders.
    if (value === undefined || value === null) return fallback;

    return value as T;
  } catch (err) {
    console.error(`[content] Error resolving section "${sectionId}":`, err);
    return fallback;
  }
}
