import { secretMatches } from '@/lib/app-secrets';
import { NextResponse } from 'next/server';

/**
 * Relay for the blog-published -> n8n webhook. Exists because a DIRECT
 * Tailscale Funnel proxy from dev-box to a REMOTE tailnet node
 * (gpu-box) hangs indefinitely on POST requests with a body -- confirmed
 * live 2026-08-13 via curl -v: TLS handshake completes, full request body is
 * sent, then no response ever arrives. GET requests to the same funneled path
 * return promptly (502), so this is specific to body-bearing cross-node
 * proxying, not a general Funnel outage.
 *
 * Route around it by only ever funneling to THIS server (localhost on
 * dev-box -- the same reliable path /api/webhook/whatsapp has used all
 * night), which then makes its own plain server-side fetch() to n8n on
 * gpu-box. That direct dev-box -> gpu-box:5678 call is
 * confirmed working (200, "Workflow was started").
 *
 * This route only makes sense running on the LOCAL stable server
 * (site-prod.service, port 3002) which can reach gpu-box
 * over the tailnet. It also exists (harmlessly) in the Vercel deployment of
 * this same codebase, where it would fail if called -- nothing calls it
 * there, N8N_BLOG_PUBLISHED_WEBHOOK_URL points at the funneled local address.
 */
const N8N_TARGET = 'http://gpu-box.your-tailnet.ts.net:5678/webhook/blog-published';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  // Fails closed: with CRON_SECRET unset this used to accept any caller.
  if (!(await secretMatches('CRON_SECRET', authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.text();

  try {
    const res = await fetch(N8N_TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await res.text();
    return NextResponse.json({ status: 'ok', n8n_status: res.status, n8n_response: text });
  } catch (err) {
    console.error('[relay/n8n-blog-published] forward to n8n failed:', err);
    return NextResponse.json({ error: 'n8n unreachable' }, { status: 502 });
  }
}
