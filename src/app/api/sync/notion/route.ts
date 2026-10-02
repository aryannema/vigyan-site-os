import { secretMatches } from '@/lib/app-secrets';
/**
 * Notion → YourSite blog sync
 *
 * POST /api/sync/notion
 * Header: X-Sync-Secret: <WEBHOOK_SECRET>  (reuses the same secret)
 *
 * Expected Notion database property names (case-sensitive):
 *   Name / Title   — title property (the page title)
 *   Slug           — rich_text   (URL slug; auto-generated from title if absent)
 *   Category       — select      (one of: ENGINEERING, DESIGN, PERFORMANCE, STRATEGY, AI)
 *   Tags           — multi_select
 *   SEO            — rich_text   (SEO description, min 100 chars)
 *   Published      — checkbox    (true = sync as published post)
 *
 * Run manually or wire a Notion webhook → this endpoint.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { BLOG_CATEGORIES, type BlogCategory, type ContentBlock } from '@/lib/blog-schema';

const NOTION_VERSION = '2022-06-28';

// ── Notion API helpers ─────────────────────────────────────────────────────────

async function notionFetch(path: string, options: RequestInit = {}): Promise<any> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error('NOTION_API_KEY is not set');

  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

async function queryDatabase(databaseId: string): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | undefined;

  do {
    const body: any = {
      filter: {
        property: 'Published',
        checkbox: { equals: true },
      },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const result = await notionFetch(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    pages.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function getPageBlocks(pageId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;

  do {
    const path = `/blocks/${pageId}/children${cursor ? `?start_cursor=${cursor}` : ''}`;
    const result = await notionFetch(path);
    blocks.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

// ── Notion property extractors ─────────────────────────────────────────────────

function extractTitle(page: any): string {
  // Notion title property can be named "Name" or "Title"
  const props = page.properties;
  const titleProp = props['Name'] || props['Title'] || props['name'] || props['title'];
  if (!titleProp) return '';
  return titleProp.title?.map((t: any) => t.plain_text).join('') ?? '';
}

function extractRichText(page: any, propName: string): string {
  const prop = page.properties[propName];
  if (!prop?.rich_text) return '';
  return prop.rich_text.map((t: any) => t.plain_text).join('');
}

function extractSelect(page: any, propName: string): string {
  return page.properties[propName]?.select?.name ?? '';
}

function extractMultiSelect(page: any, propName: string): string[] {
  return page.properties[propName]?.multi_select?.map((o: any) => o.name) ?? [];
}

// ── Notion blocks → ContentBlock conversion ────────────────────────────────────

function richTextToString(richText: any[]): string {
  return (richText ?? []).map((t: any) => t.plain_text).join('');
}

function notionBlocksToContentBlocks(notionBlocks: any[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let listBuffer: string[] = [];
  let listType: 'bulleted' | 'numbered' | null = null;

  const flushList = () => {
    if (listBuffer.length > 0) {
      // `ordered` was tracked but never emitted, so every numbered Notion list
      // imported as a bulleted one. ListBlock carries the flag (see
      // src/lib/content/blocks.ts) and the renderer honours it.
      blocks.push(
        listType === 'numbered'
          ? { type: 'list', items: [...listBuffer], ordered: true }
          : { type: 'list', items: [...listBuffer] },
      );
      listBuffer = [];
      listType = null;
    }
  };

  for (const b of notionBlocks) {
    switch (b.type) {
      case 'paragraph': {
        flushList();
        const text = richTextToString(b.paragraph?.rich_text);
        if (text) blocks.push({ type: 'paragraph', text });
        break;
      }

      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        flushList();
        // Notion's heading_1 maps to an h2, not an h1: the post title owns the
        // page's single h1. See HEADING_LEVELS in src/lib/content/blocks.ts —
        // a level-1 block fails validation and the renderer drops it.
        const level = Math.min(6, Math.max(2, parseInt(b.type.slice(-1), 10)));
        const text = richTextToString(b[b.type]?.rich_text);
        if (text) blocks.push({ type: 'heading', level, text });
        break;
      }

      case 'bulleted_list_item': {
        if (listType && listType !== 'bulleted') flushList();
        listType = 'bulleted';
        const text = richTextToString(b.bulleted_list_item?.rich_text);
        if (text) listBuffer.push(text);
        break;
      }

      case 'numbered_list_item': {
        if (listType && listType !== 'numbered') flushList();
        listType = 'numbered';
        const text = richTextToString(b.numbered_list_item?.rich_text);
        if (text) listBuffer.push(text);
        break;
      }

      case 'quote': {
        flushList();
        const text = richTextToString(b.quote?.rich_text);
        if (text) blocks.push({ type: 'quote', text });
        break;
      }

      case 'code': {
        flushList();
        const text = richTextToString(b.code?.rich_text);
        const lang = b.code?.language ?? '';
        if (text) blocks.push({ type: 'code', text, language: lang || undefined });
        break;
      }

      case 'image': {
        flushList();
        const url =
          b.image?.type === 'external' ? b.image.external?.url :
          b.image?.type === 'file'     ? b.image.file?.url :
          null;
        const alt = richTextToString(b.image?.caption) || 'Image';
        if (url) blocks.push({ type: 'image', url, alt });
        break;
      }

      // Dividers, callouts, toggles, etc. are silently skipped.
      default:
        flushList();
        break;
    }
  }

  flushList();
  return blocks;
}

// ── Slug helpers ───────────────────────────────────────────────────────────────

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

const TAG_CATEGORY_MAP: Record<string, BlogCategory> = {
  engineering: 'ENGINEERING', architecture: 'ENGINEERING', cloud: 'ENGINEERING',
  data: 'ENGINEERING', backend: 'ENGINEERING', frontend: 'ENGINEERING',
  design: 'DESIGN', ux: 'DESIGN', ui: 'DESIGN',
  performance: 'PERFORMANCE', optimization: 'PERFORMANCE',
  strategy: 'STRATEGY', business: 'STRATEGY', leadership: 'STRATEGY',
  ai: 'AI', ml: 'AI', llm: 'AI', genai: 'AI',
};

function resolveCategory(rawCategory: string, tags: string[]): BlogCategory {
  const upper = rawCategory.toUpperCase() as BlogCategory;
  if ((BLOG_CATEGORIES as readonly string[]).includes(upper)) return upper;

  for (const tag of tags) {
    const mapped = TAG_CATEGORY_MAP[tag.toLowerCase().trim()];
    if (mapped) return mapped;
  }
  return 'STRATEGY';
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const secret = request.headers.get('x-sync-secret');
  if (!(await secretMatches('WEBHOOK_SECRET', secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    return NextResponse.json({ error: 'NOTION_DATABASE_ID is not configured' }, { status: 500 });
  }

  const results = { synced: 0, skipped: 0, errors: [] as string[] };

  let pages: any[];
  try {
    pages = await queryDatabase(databaseId);
  } catch (err: any) {
    return NextResponse.json({ error: `Notion query failed: ${err.message}` }, { status: 502 });
  }

  for (const page of pages) {
    const title = extractTitle(page);
    if (!title) {
      results.errors.push(`Page ${page.id}: missing title — skipped`);
      results.skipped++;
      continue;
    }

    try {
      const rawSlug   = extractRichText(page, 'Slug');
      const slug      = rawSlug ? rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 80) : titleToSlug(title);
      const rawCat    = extractSelect(page, 'Category');
      const tags      = extractMultiSelect(page, 'Tags');
      const category  = resolveCategory(rawCat, tags);
      const rawSeo    = extractRichText(page, 'SEO');

      // Fetch and convert page blocks
      const notionBlocks   = await getPageBlocks(page.id);
      const contentBlocks  = notionBlocksToContentBlocks(notionBlocks);

      if (contentBlocks.length === 0) {
        results.errors.push(`Page "${title}": no renderable blocks — skipped`);
        results.skipped++;
        continue;
      }

      // Build seo_description
      const plainText = contentBlocks
        .filter(b => b.type === 'paragraph' || b.type === 'quote')
        .map(b => b.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      let seoDescription = rawSeo.length >= 100 ? rawSeo.slice(0, 170) : plainText.slice(0, 170);
      if (seoDescription.length < 100) {
        seoDescription = (seoDescription + ' ' + 'Published on YourSite.').slice(0, 170).padEnd(100, '.');
      }

      const now = new Date().toISOString();
      const post = {
        title,
        slug,
        category,
        seo_description: seoDescription,
        content_blocks: contentBlocks,
        status: 'published' as const,
        published_at: now,
        created_at: now,
      };

      // Upsert by slug — idempotent on re-runs
      const { error: upsertError } = await supabaseAdmin
        .from('posts')
        .upsert(post, { onConflict: 'slug' });

      if (upsertError) throw upsertError;

      results.synced++;
    } catch (err: any) {
      results.errors.push(`Page "${title}" (${page.id}): ${err.message}`);
      results.skipped++;
    }
  }

  // Audit
  try {
    await supabaseAdmin.from('mcp_audit_log').insert({
      tool_name: 'notion_sync',
      arguments: { database_id: databaseId, pages_found: pages.length, synced: results.synced },
      success: results.errors.length === 0,
      changed_by: 'webhook:notion',
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json(results);
}
