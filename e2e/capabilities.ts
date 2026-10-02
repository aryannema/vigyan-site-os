/**
 * What can this install actually test?
 *
 * The problem this solves: a skipped test and a passing test look identical in
 * a green summary. Ship this suite to an adopter who has no brand configured,
 * no Resend key and no WhatsApp number, and they get "42 passed" while the
 * branding, email and OTP suites quietly did nothing. They would trust a
 * result that measured almost none of their site.
 *
 * So capability detection happens ONCE, up front, and is PRINTED. Every skip
 * names the capability it needed and how to switch it on. A suite is allowed
 * to cover less than its name suggests — it is not allowed to be quiet about
 * which parts.
 *
 * The same file drives the agentic pass (.claude/skills/agentic-ui-test), so
 * the explorer and the regression suite agree on what exists rather than
 * drifting into two different pictures of the same site.
 */

export type CapabilityId =
  | 'site'
  | 'database'
  | 'brand'
  | 'email'
  | 'whatsapp'
  | 'payments'
  | 'admin-auth';

export interface Capability {
  id: CapabilityId;
  /** Shown in the printed matrix. */
  label: string;
  available: boolean;
  /** Why it is off, and what to do about it. Empty when available. */
  reason: string;
  /** What silently goes untested when this is off. */
  covers: string;
}

const env = (k: string) => (process.env[k] ?? '').trim();

async function reachable(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * A route that returns 404 is not implemented on this build. Worth knowing
 * before a test asserts against it — otherwise the test passes by aiming at
 * nothing, which is the failure mode this whole file exists to prevent.
 */
async function routeExists(baseUrl: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(path, baseUrl), { method: 'POST', body: '{}',
      headers: { 'content-type': 'application/json' } });
    return res.status !== 404;
  } catch {
    return false;
  }
}

export async function detectCapabilities(baseUrl: string): Promise<Capability[]> {
  const siteUp = await reachable(baseUrl);

  // Brand is "configured" when the tokens the suite checks are real names in
  // this install. An adopter who has not run site-bootstrap has the template's
  // defaults, and asserting our palette against theirs would fail on their
  // first run — which teaches them the suite is noise.
  let brandConfigured = false;
  if (siteUp) {
    try {
      const html = await (await fetch(baseUrl)).text();
      brandConfigured = /--(bg|accent|text-body)\s*:/.test(html) || html.includes('tokens.css');
    } catch { /* leave false */ }
  }

  const caps: Capability[] = [
    {
      id: 'site',
      label: 'Site reachable',
      available: siteUp,
      reason: siteUp ? '' : `nothing answering at ${baseUrl} — start the dev server, or set E2E_BASE_URL`,
      covers: 'everything in this suite',
    },
    {
      id: 'database',
      label: 'Postgres (DATABASE_URL)',
      available: Boolean(env('DATABASE_URL')),
      reason: env('DATABASE_URL') ? '' : 'set DATABASE_URL — permissions, RLS and PII masking live in `pnpm test:db`',
      covers: 'anything that reads or writes a row: contact submissions, OTP records, orders',
    },
    {
      id: 'brand',
      label: 'Branding configured',
      available: brandConfigured,
      reason: brandConfigured ? '' : 'no design tokens found — run the site-bootstrap skill, then fill in e2e/brand.expectations.ts',
      covers: 'design tokens resolve, contrast meets AA, the home link is named for the brand',
    },
    {
      id: 'email',
      label: 'Transactional email (Resend)',
      available: Boolean(env('RESEND_API_KEY')),
      reason: env('RESEND_API_KEY') ? '' : 'set RESEND_API_KEY to run the delivery round-trip. Without it the send is INTERCEPTED and only the request shape is checked',
      covers: 'invoice email actually leaves the building',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp / OTP',
      available: Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID')),
      reason:
        env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID')
          ? ''
          : 'set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID. Without them OTP is tested against an intercepted send — the code path runs, the message does not',
      covers: 'an OTP is delivered to a real handset',
    },
    {
      id: 'payments',
      label: 'Payment gateway',
      available: Boolean(env('RAZORPAY_KEY_ID')),
      reason: env('RAZORPAY_KEY_ID') ? '' : 'set RAZORPAY_KEY_ID — checkout quoting is tested regardless, order creation is not',
      covers: 'an order reaches the gateway',
    },
    {
      id: 'admin-auth',
      label: 'Admin authentication',
      available: false,
      reason: 'no auth layer exists yet — /admin is unauthenticated (see BLOCKERS.md §3). The test asserting it IS protected is the one that must go red the day this changes',
      covers: 'admin routes refuse a signed-out visitor',
    },
  ];

  if (siteUp) {
    // Record which endpoints are actually present, so a functional test can
    // skip with "not on this build" rather than assert against a 404.
    const present = await Promise.all([
      routeExists(baseUrl, '/api/validate/phone'),
      routeExists(baseUrl, '/api/contact'),
      routeExists(baseUrl, '/api/profile/whatsapp/verify-otp'),
    ]);
    routePresence['/api/validate/phone'] = present[0];
    routePresence['/api/contact'] = present[1];
    routePresence['/api/profile/whatsapp/verify-otp'] = present[2];
  }

  return caps;
}

/** Populated by detectCapabilities(); read by functional specs. */
export const routePresence: Record<string, boolean> = {};

/** The printed matrix. This is the artifact that makes a skip honest. */
export function formatMatrix(caps: Capability[]): string {
  const width = Math.max(...caps.map((c) => c.label.length));
  const lines = caps.map((c) => {
    const mark = c.available ? 'ON ' : 'OFF';
    const head = `  [${mark}] ${c.label.padEnd(width)}`;
    return c.available ? head : `${head}\n         ↳ ${c.reason}\n         ↳ untested: ${c.covers}`;
  });
  const off = caps.filter((c) => !c.available).length;
  return [
    '',
    '  ── Test capabilities ───────────────────────────────────────────────',
    ...lines,
    '',
    off === 0
      ? '  Everything above is exercised.'
      : `  ${off} of ${caps.length} capabilities are OFF. The suite can still go green;`,
    off === 0 ? '' : '  what it proves is limited to the ON rows above.',
    '  ────────────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}
