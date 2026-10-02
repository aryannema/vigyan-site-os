import { NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, serializeAttribution } from '@/lib/attribution';

// Public UTM-tagged short-link redirect. NOT under (app)/admin -- unauthenticated
// by design, reached by anyone who clicks a shared link. Uses supabaseAdmin
// (service-role, bypasses RLS, no capability check/audit -- same pattern as the
// other public write surfaces: webhooks, the WhatsApp CRM) rather than the admin
// pg pool (admin/lib/db.ts), so a hot public redirect path never competes with
// the admin UI's 5-connection pool. See supabase/migrations/017_utm_link_shortener.sql
// and docs/LINK_BUILDER_AND_CAMPAIGNS.md.
//
// Does NOT filter by status -- a shared link must keep resolving regardless of
// its admin-list status; status is a UI/reporting filter only, not an access gate.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { data: link } = await supabaseAdmin
    .from('link_shortener')
    .select('id, target_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
    .eq('slug', slug)
    .maybeSingle();

  if (!link) {
    return new NextResponse('Not found', { status: 404 });
  }

  let target: URL;
  try {
    target = new URL(link.target_url);
  } catch {
    return new NextResponse('Misconfigured link', { status: 500 });
  }

  for (const [key, value] of Object.entries({
    utm_source: link.utm_source,
    utm_medium: link.utm_medium,
    utm_campaign: link.utm_campaign,
    utm_term: link.utm_term,
    utm_content: link.utm_content,
  })) {
    if (value) target.searchParams.set(key, value);
  }

  // Logged after the response is sent (Next.js 15 after()) so the click-log
  // write never adds latency to the redirect itself.
  after(async () => {
    await supabaseAdmin.from('link_clicks').insert({
      link_id: link.id,
      referrer: request.headers.get('referer'),
      user_agent: request.headers.get('user-agent'),
    });
  });

  // Remember which campaign sent this visitor, so the order they may place
  // later can be credited to it. Without this, link_clicks counts clicks and
  // orders counts revenue with nothing joining the two.
  const response = NextResponse.redirect(target.toString(), { status: 302 });
  response.cookies.set({
    name: ATTRIBUTION_COOKIE,
    value: serializeAttribution({
      link_slug: slug,
      utm_source: link.utm_source ?? undefined,
      utm_medium: link.utm_medium ?? undefined,
      utm_campaign: link.utm_campaign ?? undefined,
    }),
    maxAge: ATTRIBUTION_MAX_AGE,
    httpOnly: true,     // nothing in the browser needs to read it
    sameSite: 'lax',    // must survive the redirect and later navigation
    secure: true,
    path: '/',
  });
  return response;
}
