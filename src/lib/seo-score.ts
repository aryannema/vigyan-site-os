// SERVER ONLY. A Wix/Yoast-style per-page SEO score: fetches each page's
// LIVE rendered HTML (same bytes Google's crawler sees, not source-code
// assumptions) and scores it against the exact checklist used in the
// 2026-09-08 GSC audit -- see docs/OPS.md §9.1 and the seo-optimize skill.
// Deliberately regex-based rather than a DOM-parsing dependency (cheerio
// etc.) -- this repo has no HTML-parsing dependency anywhere, and the same
// regex approach already proved out during that manual audit.

import { siteConfig } from '@/config/site';

export interface SeoCheck {
  id: string;
  label: string;
  pass: boolean;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface PageSeoScore {
  path: string;
  url: string;
  score: number; // 0-100
  checks: SeoCheck[];
  title: string | null;
  metaDescription: string | null;
  wordCount: number;
  fetchError: string | null;
}

/** The pages this audits -- mirrors src/app/sitemap.ts's route list plus home. */
export const AUDITED_PAGES = [
  { path: '/', label: 'Home' },
  { path: '/about', label: 'About' },
  { path: '/blog', label: 'Blog' },
  { path: '/careers', label: 'Careers' },
  { path: '/contact', label: 'Contact' },
  { path: '/services', label: 'Services' },
  { path: '/voice', label: 'Voice Bot' },
  { path: '/privacy', label: 'Privacy Policy' },
  { path: '/terms', label: 'Terms of Service' },
  { path: '/data-deletion', label: 'Data Deletion' },
];

function extract(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern);
  return m ? m[1].trim() : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

interface RawPageData {
  html: string | null;
  error: string | null;
}

async function fetchPage(path: string): Promise<RawPageData> {
  try {
    const res = await fetch(`${siteConfig.url}${path}`, { cache: 'no-store' });
    if (!res.ok) return { html: null, error: `HTTP ${res.status}` };
    return { html: await res.text(), error: null };
  } catch (err) {
    return { html: null, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

function bodyWordCount(html: string): number {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;
  body = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

/**
 * Scores every page in AUDITED_PAGES in one pass. Cross-page checks (title
 * duplication, internal-link graph) need every page's HTML at once, so this
 * is a single batch function rather than one score() call per page.
 */
export async function scoreSite(): Promise<PageSeoScore[]> {
  const fetched = await Promise.all(AUDITED_PAGES.map((p) => fetchPage(p.path)));

  const titles = fetched.map((f) => (f.html ? decodeEntities(extract(f.html, /<title>(.*?)<\/title>/i) ?? '') : ''));
  const descriptions = fetched.map((f) =>
    f.html ? decodeEntities(extract(f.html, /<meta\s+name="description"\s+content="([^"]*)"/i) ?? '') : ''
  );

  // A page "has" an internal link if any OTHER page's HTML contains an
  // href to it. Includes self-matches from shared global chrome (header/
  // footer render on every page) -- that's fine, a page linked from the
  // footer legitimately counts as linked even when the check runs on its
  // own fetched HTML too.
  const allHtml = fetched.map((f) => f.html ?? '').join('\n');
  function hasInternalLink(path: string): boolean {
    if (path === '/') return true; // homepage is always reachable, not meaningfully "orphaned"
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`href=(["'\`])${escaped}(["'\`/])`, 'i');
    return re.test(allHtml);
  }

  return AUDITED_PAGES.map((page, i) => {
    const { html, error } = fetched[i];
    if (!html) {
      return {
        path: page.path,
        url: `${siteConfig.url}${page.path}`,
        score: 0,
        checks: [],
        title: null,
        metaDescription: null,
        wordCount: 0,
        fetchError: error ?? 'no HTML returned',
      };
    }

    const title = titles[i];
    const description = descriptions[i];
    const canonical = extract(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
    const ogTitle = extract(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i);
    const ogDescription = extract(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i);
    const ogImage = extract(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
    const wordCount = bodyWordCount(html);

    const isDuplicateTitle = titles.filter((t, j) => t && t === title && j !== i).length > 0;
    const isDuplicateDescription = descriptions.filter((d, j) => d && d === description && j !== i).length > 0;
    const canonicalOk = !!canonical && canonical.replace(/\/$/, '') === `${siteConfig.url}${page.path}`.replace(/\/$/, '');

    const checks: SeoCheck[] = [
      {
        id: 'title',
        label: 'Title tag',
        pass: !!title && title.length >= 10 && title.length <= 60 && !isDuplicateTitle,
        points: !!title && title.length >= 10 && title.length <= 60 && !isDuplicateTitle ? 20 : 0,
        maxPoints: 20,
        detail: !title
          ? 'Missing.'
          : isDuplicateTitle
          ? `Duplicate of another page's title: "${title}"`
          : `${title.length} chars — "${title}"`,
      },
      {
        id: 'meta_description',
        label: 'Meta description',
        pass: !!description && description.length >= 50 && description.length <= 160 && !isDuplicateDescription,
        points:
          !!description && description.length >= 50 && description.length <= 160 && !isDuplicateDescription ? 20 : 0,
        maxPoints: 20,
        detail: !description
          ? 'Missing.'
          : isDuplicateDescription
          ? 'Duplicate of another page\'s description.'
          : `${description.length} chars`,
      },
      {
        id: 'h1',
        label: 'Exactly one H1',
        pass: h1s.length === 1,
        points: h1s.length === 1 ? 15 : 0,
        maxPoints: 15,
        detail: h1s.length === 0 ? 'No H1 found.' : h1s.length === 1 ? 'OK.' : `${h1s.length} H1 tags found.`,
      },
      {
        id: 'canonical',
        label: 'Canonical tag',
        pass: canonicalOk,
        points: canonicalOk ? 15 : 0,
        maxPoints: 15,
        detail: !canonical ? 'Missing.' : canonicalOk ? 'Self-referencing, correct.' : `Points elsewhere: ${canonical}`,
      },
      {
        id: 'og_tags',
        label: 'Open Graph tags',
        pass: !!ogTitle && !!ogDescription && !!ogImage,
        points: !!ogTitle && !!ogDescription && !!ogImage ? 10 : 0,
        maxPoints: 10,
        detail: ogTitle && ogDescription && ogImage ? 'og:title/description/image all present.' : 'One or more OG tags missing.',
      },
      {
        id: 'internal_links',
        label: 'Internal links pointing here',
        pass: hasInternalLink(page.path),
        points: hasInternalLink(page.path) ? 10 : 0,
        maxPoints: 10,
        detail: hasInternalLink(page.path) ? 'Reachable from at least one other page.' : 'Orphan — no nav/footer/CTA links here.',
      },
      {
        id: 'content_depth',
        label: 'Content depth',
        pass: wordCount >= 150,
        points: wordCount >= 150 ? 10 : 0,
        maxPoints: 10,
        detail: `${wordCount} words.`,
      },
    ];

    const score = checks.reduce((sum, c) => sum + c.points, 0);

    return {
      path: page.path,
      url: `${siteConfig.url}${page.path}`,
      score,
      checks,
      title: title || null,
      metaDescription: description || null,
      wordCount,
      fetchError: null,
    };
  });
}
