/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The stable prod server (site-prod.service, port 3002, serves
  // the WhatsApp webhook) and the dev server (port 3000, used for iteration)
  // must NOT share a .next directory -- dev's constant recompiling silently
  // corrupts a production build sitting underneath it (confirmed live:
  // MODULE_NOT_FOUND on vendor chunks after the dev server rebuilt mid-serve).
  // Build/start the stable server with BUILD_TARGET=stable to route it to its
  // own .next-stable directory instead.
  distDir: process.env.BUILD_TARGET === 'stable' ? '.next-stable' : '.next',
  /**
   * Security headers.
   *
   * The site sent none — no clickjacking protection, no MIME-sniffing
   * protection, no referrer policy, no CSP. Each turns a class of attack from
   * "works" into "blocked by the browser", and they cost nothing to send.
   *
   * The CSP is deliberately REPORT-ONLY for now. This app uses inline <style>
   * blocks and inline JSON-LD, and Next injects its own inline bootstrap, so a
   * strict policy would break the site the moment it shipped. Report-only makes
   * violations visible before anything is enforced — shipping an enforcing CSP
   * blind is how a deploy takes the site down at 2am.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline' is required today by Next's bootstrap, the GA4 snippet
      // and the JSON-LD blocks. Removing it needs nonces throughout; report-only
      // documents that gap rather than hiding it.
      "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://www.googletagmanager.com https://www.google-analytics.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.supabase.co https://*.r2.cloudflarestorage.com https://www.google-analytics.com",
      // Razorpay's checkout is an iframe; a Google Maps embed is opt-in.
      "frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.google.com https://www.youtube-nocookie.com",
      // Nothing may embed US — the clickjacking defence, alongside
      // X-Frame-Options for browsers that predate CSP level 2.
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // A compromised page cannot post a form to somebody else's server.
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Origin only cross-site, full URL same-site. A referrer carrying a
          // full admin URL to a third party is a quiet leak.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
      {
        // RSC payloads (Next's prefetch / client navigation) share a URL with
        // the HTML page. Cloudflare's cache key ignores query and Vary, so a
        // cached RSC response would be served to browsers as the page itself.
        source: '/:path*',
        has: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/:path*',
        has: [{ type: 'query', key: '_rsc' }],
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        // The admin must never be cached by a proxy or indexed anywhere.
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // The admin dashboard moved from /app to /admin. Keep old links/bookmarks working.
      { source: '/app', destination: '/admin', permanent: false },
      { source: '/app/:path*', destination: '/admin/:path*', permanent: false },
      // /home was the old Google Sites homepage slug (pre-2026-08-15 migration);
      // still indexed/linked externally, so redirect rather than let it 404.
      { source: '/home', destination: '/', permanent: true },
    ];
  },
};

export default nextConfig;
