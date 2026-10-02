/**
 * Runs once when the server process starts. Next calls `register()` on boot.
 *
 * WHY THIS EXISTS: a deploy invalidates the edge cache, and nothing was doing
 * it.
 *
 * Cached HTML references JavaScript chunks by content hash —
 * `/_next/static/chunks/9330-OLDHASH.js`. A deploy replaces the container, so
 * those files are gone. If Cloudflare is still handing out the previous build's
 * HTML, every visitor gets a 404 on the chunk and a page with no JavaScript.
 *
 * This was harmless while every page sent `no-store`, because nothing was
 * cached. The moment per-content-type revalidate landed it became a real
 * hazard: /privacy is cached for a DAY, so a deploy could serve broken HTML for
 * 24 hours. Raising the TTLs without purging on deploy is worse than not
 * raising them.
 *
 * `vigyan-secrets.md` documents a token named
 * `yoursite-cache-purge-github-actions` "to purge Cloudflare's cache after
 * each Coolify deploy". That workflow was never built. Doing it here instead of
 * in CI is deliberate: it fires whenever a new server actually starts —
 * a Coolify redeploy, a manual restart, a container reschedule — rather than
 * only when a particular pipeline runs. The thing that invalidates the cache is
 * a new build serving traffic, and that is exactly this moment.
 */
export async function register() {
  // Next also calls register() for the edge runtime; the purge only needs to
  // happen once, from the Node server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Never in dev. A local restart purging the production edge cache would be a
  // genuinely surprising side effect of `pnpm dev`.
  if (process.env.NODE_ENV !== 'production') return;

  try {
    // READ FROM process.env, NOT getSecret(). instrumentation.ts is compiled
    // for BOTH the node and edge runtimes, and app-secrets.ts imports Node's
    // crypto — which the edge bundle cannot resolve, failing the build. The
    // `node:` prefix does not help; webpack rejects the scheme outright.
    //
    // That is fine on its own terms: these two are infrastructure credentials
    // needed at BOOT, which by our own rule (vigyan-secrets.md 0.3) is exactly
    // what belongs in the environment rather than in app_secrets. The admin
    // button still goes through getSecret(), which falls back to env anyway —
    // so putting them in Coolify satisfies both callers.
    const token = process.env.CLOUDFLARE_CACHE_PURGE_TOKEN;
    const zone = process.env.CLOUDFLARE_ZONE_ID;

    if (!token || !zone) {
      // Say so once, loudly, rather than failing silently. Without a purge the
      // stale-chunk window above is live, and an operator should know.
      console.warn(
        '[startup] Cloudflare purge skipped: CLOUDFLARE_CACHE_PURGE_TOKEN or ' +
          'CLOUDFLARE_ZONE_ID is not set. Cached HTML from the previous build may ' +
          'reference JavaScript chunks this build no longer has.',
      );
      return;
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      console.log('[startup] Cloudflare cache purged for the new build.');
    } else {
      console.error('[startup] Cloudflare purge failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    // A failed purge must NEVER stop the server booting. A site that is up with
    // a stale edge cache is recoverable; a site that will not start is not.
    console.error('[startup] Cloudflare purge threw (ignored):', err);
  }
}
