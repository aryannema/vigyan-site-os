import { NextResponse } from 'next/server';

/**
 * Fire-and-forget notifier for "a new blog comment needs moderation".
 *
 * UNLIKE the older n8n-blog-published relay (same directory), this one does
 * NOT reach into the home tailnet — the whole site now runs on Hostinger,
 * which is deliberately tagged `tag:cloud-machines` with ZERO Tailscale
 * grants to dev-box/gpu-box (see docs/VIGYAN_SECRETS.md). This
 * route only ever makes a plain outbound HTTPS POST to whatever PUBLIC URL
 * `N8N_COMMENT_POSTED_WEBHOOK_URL` is set to — no funnel, no relay hop.
 *
 * No-ops (204) when the env var is unset, so comment posting itself never
 * depends on this being configured. Setting it up requires exposing an n8n
 * webhook trigger publicly (e.g. a Cloudflare Tunnel / Tailscale Funnel path
 * scoped to just that one webhook endpoint, mirroring the WhatsApp webhook's
 * existing pattern) — a real infra decision, not made here.
 */
export async function POST(request: Request) {
  const target = process.env.N8N_COMMENT_POSTED_WEBHOOK_URL;
  if (!target) return new NextResponse(null, { status: 204 });

  const body = await request.text();

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return NextResponse.json({ status: 'ok', n8n_status: res.status });
  } catch (err) {
    console.error('[relay/n8n-comment-posted] forward to n8n failed:', err);
    return NextResponse.json({ error: 'n8n unreachable' }, { status: 502 });
  }
}
