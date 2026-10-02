import { secretMatches } from '@/lib/app-secrets';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { onBlogPostPublished } from '@/lib/blog-publish-hooks';

/**
 * Promotes blog posts from status='scheduled' to status='published' once their
 * published_at has passed. Without this, 'scheduled' is a dead-end state --
 * confirmed live 2026-08-12 that /blog's query only checks status='published',
 * nothing ever re-checks published_at to flip a scheduled post live.
 *
 * Triggered by Vercel Cron (see vercel.json) once daily -- Hobby plan allows no
 * finer granularity (±59 min precision on the configured time). Vercel signs
 * cron-triggered requests with `Authorization: Bearer $CRON_SECRET` automatically
 * when CRON_SECRET is set as an env var; verified here so this route can't be
 * triggered by an arbitrary public request.
 *
 * After promoting, fires onBlogPostPublished() (src/lib/blog-publish-hooks.ts)
 * per post -- creates/reuses a UTM short link and posts the best-effort n8n
 * webhook. This route is the single place that actually knows the exact
 * moment a post transitions to published via the scheduled path, so it owns
 * emitting that event. Fire-and-forget by design: promoting the post is the
 * critical path, the short link/webhook are not.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  // Fails closed: with CRON_SECRET unset this used to accept any caller.
  if (!(await secretMatches('CRON_SECRET', authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: due, error: selectError } = await supabaseAdmin
    .from('posts')
    .select('id, slug, title, seo_description, published_at')
    .eq('status', 'scheduled')
    .lte('published_at', nowIso);

  if (selectError) {
    console.error('[cron/publish-scheduled] select failed:', selectError);
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ status: 'ok', promoted: 0 });
  }

  const ids = due.map((p) => p.id);
  const { error: updateError } = await supabaseAdmin
    .from('posts')
    .update({ status: 'published' })
    .in('id', ids);

  if (updateError) {
    console.error('[cron/publish-scheduled] update failed:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  console.log(`[cron/publish-scheduled] promoted ${due.length} post(s):`, due.map((p) => p.slug));

  for (const post of due) {
    // Not awaited before responding -- see onBlogPostPublished's own header
    // for why that's safe on this persistent-process deployment.
    void onBlogPostPublished(post);
  }

  return NextResponse.json({ status: 'ok', promoted: due.length, slugs: due.map((p) => p.slug) });
}
