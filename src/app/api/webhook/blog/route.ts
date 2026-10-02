import { secretMatches } from '@/lib/app-secrets';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { BLOG_CATEGORIES, type BlogCategory, type ContentBlock } from '@/lib/blog-schema';

// ── Slug generation ────────────────────────────────────────────────────────────

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await supabaseAdmin.from('posts').select('id').eq('slug', slug).single();
    if (!data) return slug;
    slug = `${base}-${Date.now().toString(36)}`;
  }
  throw new Error('Could not generate a unique slug after 5 attempts.');
}

// ── Markdown → ContentBlock conversion ────────────────────────────────────────
// Handles headings, lists, blockquotes, code fences, and paragraphs.

function markdownToContentBlocks(markdown: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = markdown.split('\n');
  let listBuffer: string[] = [];
  let inCodeFence = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({ type: 'list', items: [...listBuffer] });
      listBuffer = [];
    }
  };

  for (const line of lines) {
    // Code fence toggle
    if (line.startsWith('```')) {
      if (!inCodeFence) {
        flushList();
        inCodeFence = true;
        codeLang = line.slice(3).trim();
        codeBuffer = [];
      } else {
        inCodeFence = false;
        if (codeBuffer.length > 0) {
          blocks.push({ type: 'code', text: codeBuffer.join('\n'), language: codeLang || undefined });
        }
        codeBuffer = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeFence) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushList();
      // Body headings are h2–h6: the post title owns the page's single h1, so a
      // Markdown `# Heading` becomes an h2. See HEADING_LEVELS in
      // src/lib/content/blocks.ts — a level-1 block fails validation and would
      // be dropped by the renderer entirely.
      const level = Math.min(6, Math.max(2, headingMatch[1].length));
      blocks.push({ type: 'heading', level, text: headingMatch[2] });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList();
      blocks.push({ type: 'quote', text: trimmed.slice(2) });
      continue;
    }

    // Unordered list items
    if (/^[-*+]\s/.test(trimmed)) {
      listBuffer.push(trimmed.slice(2));
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^\d+\.\s/, ''));
      continue;
    }

    // Paragraph (strip inline markdown for text storage)
    flushList();
    const text = trimmed
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1');
    blocks.push({ type: 'paragraph', text });
  }

  flushList();
  if (inCodeFence && codeBuffer.length > 0) {
    blocks.push({ type: 'code', text: codeBuffer.join('\n'), language: codeLang || undefined });
  }

  return blocks.filter(b => b.type === 'paragraph' ? !!b.text : true);
}

// ── Category inference from tags ───────────────────────────────────────────────

const TAG_CATEGORY_MAP: Record<string, BlogCategory> = {
  engineering: 'ENGINEERING',
  architecture: 'ENGINEERING',
  cloud: 'ENGINEERING',
  data: 'ENGINEERING',
  infrastructure: 'ENGINEERING',
  backend: 'ENGINEERING',
  frontend: 'ENGINEERING',
  design: 'DESIGN',
  ux: 'DESIGN',
  ui: 'DESIGN',
  product: 'DESIGN',
  performance: 'PERFORMANCE',
  optimization: 'PERFORMANCE',
  speed: 'PERFORMANCE',
  strategy: 'STRATEGY',
  business: 'STRATEGY',
  growth: 'STRATEGY',
  leadership: 'STRATEGY',
  ai: 'AI',
  ml: 'AI',
  llm: 'AI',
  'machine-learning': 'AI',
  'artificial-intelligence': 'AI',
  genai: 'AI',
};

function tagsToCategory(tags: string[]): BlogCategory {
  for (const tag of tags) {
    const key = tag.toLowerCase().trim();
    if (TAG_CATEGORY_MAP[key]) return TAG_CATEGORY_MAP[key];
  }
  return 'STRATEGY';
}

// ── SEO description extraction ─────────────────────────────────────────────────

function extractSeoDescription(body: string, explicit?: string): string {
  if (explicit && explicit.length >= 100) return explicit.slice(0, 170);

  // Strip markdown and take the first ~160 chars
  const plain = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/[*_`>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length >= 100) return plain.slice(0, 170);

  // Pad to minimum 100 chars if the body is very short
  return (plain + ' ' + 'YourSite insight.').slice(0, 170).padEnd(100, '.');
}

// ── Payload type ───────────────────────────────────────────────────────────────

interface WebhookPayload {
  title: string;
  body: string;
  tags?: string[];
  source?: 'linkedin' | 'notion' | 'manual';
  published?: boolean;
  slug?: string;
  category?: BlogCategory;
  seo_description?: string;
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Auth: validate the shared webhook secret
  const secret = request.headers.get('x-webhook-secret');
  if (!(await secretMatches('WEBHOOK_SECRET', secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Required fields
  if (!payload.title || typeof payload.title !== 'string' || payload.title.trim().length < 5) {
    return NextResponse.json({ error: '`title` is required (min 5 chars)' }, { status: 400 });
  }
  if (!payload.body || typeof payload.body !== 'string' || payload.body.trim().length === 0) {
    return NextResponse.json({ error: '`body` is required' }, { status: 400 });
  }

  const title = payload.title.trim();
  const tags  = Array.isArray(payload.tags) ? payload.tags : [];

  // Derive category
  const category: BlogCategory =
    payload.category && (BLOG_CATEGORIES as readonly string[]).includes(payload.category)
      ? payload.category
      : tagsToCategory(tags);

  // Convert markdown body to content blocks
  const contentBlocks = markdownToContentBlocks(payload.body);
  if (contentBlocks.length === 0) {
    return NextResponse.json({ error: '`body` produced zero content blocks' }, { status: 400 });
  }

  // Generate slug
  const baseSlug = payload.slug
    ? payload.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 80)
    : titleToSlug(title);

  let slug: string;
  try {
    slug = await ensureUniqueSlug(baseSlug);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }

  const seoDescription = extractSeoDescription(payload.body, payload.seo_description);
  const status = payload.published === false ? 'draft' : 'published';
  const now = new Date().toISOString();

  const post = {
    title,
    slug,
    category,
    seo_description: seoDescription,
    content_blocks: contentBlocks,
    status,
    published_at: status === 'published' ? now : null,
    created_at: now,
  };

  const { data, error: insertError } = await supabaseAdmin
    .from('posts')
    .insert([post])
    .select('id, slug')
    .single();

  if (insertError) {
    console.error('[Webhook/Blog] Insert failed:', insertError.message);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Audit log
  try {
    await supabaseAdmin.from('mcp_audit_log').insert({
      tool_name: 'webhook_blog_ingest',
      arguments: { title, slug, category, source: payload.source ?? 'manual', status },
      success: true,
      changed_by: `webhook:${payload.source ?? 'manual'}`,
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ success: true, id: data.id, slug: data.slug });
}
