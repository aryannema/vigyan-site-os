import { siteConfig } from '@/config/site';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * /llms.txt — a curated Markdown map of this site for language models.
 *
 * Distinct from the two files it sits beside:
 *
 *   robots.txt   permission  — what a crawler may fetch
 *   sitemap.xml  inventory   — every URL, for completeness
 *   llms.txt     curation    — what is worth reading, and what each thing says
 *
 * The argument for it: a model reading this site hits navigation, marketing
 * chrome and JavaScript, and has to infer what matters. This says so directly,
 * in the format proposed by Answer.AI — H1, a summary, then sections of links
 * with one-line descriptions.
 *
 * HONEST STATUS: publishers have adopted this (Anthropic, Stripe and Cloudflare
 * all serve one today) but there is no confirmation that any AI search system
 * reads it for retrieval or ranking. Treat it as cheap hedging, not a channel.
 * It costs one route and stays correct on its own because it is generated from
 * the same rows as the sitemap.
 *
 * Deliberately CURATED, not exhaustive: legal pages and thin routes are left
 * out. A short file pointing at genuinely substantive pages is more useful to a
 * model than a dump of every URL — the sitemap already covers completeness.
 */
export const revalidate = 3600;

type Post = { slug: string; title: string; seo_description: string | null; category: string | null };
type Product = { slug: string; title: string; description: string | null };
type Job = { slug: string; title: string; location: string | null; department: string | null };

const oneLine = (s: string | null | undefined, max = 140): string =>
  (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export async function GET() {
  const base = siteConfig.url;

  // A helper rather than three near-identical chains: the Supabase builder is
  // a PromiseLike, not a Promise, so it has no .catch() to hang a fallback on.
  const fetchRows = async <T>(
    table: string,
    columns: string,
    status: string,
  ): Promise<T[]> => {
    try {
      const { data, error } = await supabaseAdmin.from(table).select(columns).eq('status', status);
      if (error) {
        console.error(`[llms.txt] ${table} query failed:`, error.message);
        return [];
      }
      return (data ?? []) as unknown as T[];
    } catch (err) {
      console.error(`[llms.txt] ${table} threw:`, err);
      return [];
    }
  };

  const [posts, products, jobs] = await Promise.all([
    fetchRows<Post>('posts', 'slug, title, seo_description, category, published_at', 'published'),
    fetchRows<Product>('products', 'slug, title, description', 'active'),
    fetchRows<Job>('job_openings', 'slug, title, location, department', 'open'),
  ]);

  const lines: string[] = [
    `# ${siteConfig.name}`,
    '',
    siteConfig.description,
    '',
    `> ${siteConfig.tagline} This file lists the pages worth reading, with a`,
    `> one-line summary of each. The complete URL inventory is at`,
    `> ${base}/sitemap.xml.`,
    '',
    '## About',
    '',
    `- [What we do](${base}/services): the services offered and how engagements work`,
    `- [About](${base}/about): who we are and how we work`,
    `- [Contact](${base}/contact): how to get in touch`,
  ];

  if (products.length) {
    lines.push('', '## Products', '');
    for (const p of products) {
      const d = oneLine(p.description);
      lines.push(`- [${p.title}](${base}/products/${p.slug})${d ? `: ${d}` : ''}`);
    }
  }

  if (posts.length) {
    lines.push(
      '',
      '## Writing',
      '',
      '> Engineering and operational notes. These are the pages most likely to',
      '> answer a technical question directly.',
      '',
    );
    for (const p of posts) {
      const d = oneLine(p.seo_description);
      const cat = p.category ? ` (${p.category})` : '';
      lines.push(`- [${p.title}](${base}/blog/${p.slug})${cat}${d ? `: ${d}` : ''}`);
    }
  }

  if (jobs.length) {
    lines.push('', '## Open roles', '');
    for (const j of jobs) {
      const where = [j.department, j.location].filter(Boolean).join(', ');
      lines.push(`- [${j.title}](${base}/careers/${j.slug})${where ? `: ${where}` : ''}`);
    }
  }

  lines.push(
    '',
    '## Optional',
    '',
    `- [Privacy policy](${base}/privacy)`,
    `- [Terms](${base}/terms)`,
    `- [Data deletion](${base}/data-deletion)`,
    '',
  );

  return new Response(lines.join('\n'), {
    headers: {
      // text/plain, not text/markdown: it should render in a browser rather
      // than prompt a download, and every client can read it.
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
