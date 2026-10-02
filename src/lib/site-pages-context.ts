import { supabaseAdmin } from '@/lib/supabase';
import { siteConfig } from '@/config/site';

/**
 * A short, generated list of what is currently published on the site
 * (landing pages and active products), appended to the WhatsApp assistant's
 * prompt at answer time. It is NOT written into kb.md: that file is shared
 * with other consumers and stays hand-curated. This only keeps the bot from
 * being ignorant of a page published five minutes ago.
 */

const TTL_MS = 60_000;
const MAX_ITEMS = 40;
const MAX_LINE = 220;
let cache: { value: string; at: number } | null = null;

const clip = (s: string | null | undefined) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE - 1)}…` : t;
};

export async function sitePagesContext(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  let value = '';
  try {
    const [landing, products] = await Promise.all([
      supabaseAdmin
        .from('landing_pages')
        .select('slug, title, subtitle, seo_description')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(MAX_ITEMS),
      supabaseAdmin
        .from('products')
        .select('slug, title, description')
        .eq('status', 'active')
        .order('title')
        .limit(MAX_ITEMS),
    ]);

    const lines: string[] = [];
    for (const p of landing.data ?? []) {
      const about = clip(p.seo_description || p.subtitle);
      lines.push(`- ${p.title}${about ? ` — ${about}` : ''} (${siteConfig.url}/services/${p.slug})`);
    }
    for (const p of products.data ?? []) {
      const about = clip(p.description);
      lines.push(`- Product: ${p.title}${about ? ` — ${about}` : ''} (${siteConfig.url}/products/${p.slug})`);
    }
    if (lines.length) {
      value =
        'Pages and products currently live on the website. Use them to point people to the right link; ' +
        'do not invent details beyond these one-line descriptions and the knowledge base.\n' +
        lines.join('\n');
    }
  } catch (err) {
    console.error('[site-pages-context] read failed (bot continues on the KB alone):', err);
  }

  cache = { value, at: Date.now() };
  return value;
}
