/**
 * Markdown / MDX-style import → typed blocks.
 *
 * This is a CONVERTER, not a renderer: text goes in, `Block[]` comes out, and
 * the stored/rendered format stays the safe typed-block JSON. Nothing here (or
 * anywhere) evaluates JSX or JavaScript, so pasted or AI-written MDX can never
 * execute. MDX's `import`/`export` lines are dropped, and the only component
 * tags understood are the media ones below, read as plain attributes.
 *
 * Understood:
 *   frontmatter            ---\ntitle: …\ndescription: …\n---
 *   # / ## … ######        headings (a lone leading `# ` becomes meta.title)
 *   paragraphs             inline **bold** _italic_ `code` [link](url) untouched
 *   - / * / 1.  lists      one level (nested items are flattened, with a warning)
 *   > quote                a final `— Name` line becomes the attribution
 *   ```lang title="f"      fenced code, ```mermaid included
 *   ![alt](url "caption")  image on its own line
 *   https://youtu.be/ID    video on its own line (bare URL or [title](url))
 *   <Video url="…" title="…" caption="…" />   and   <Image src alt caption />
 */

import { blockSchema, type Block, type HeadingLevel } from './blocks';
import { parseYouTubeId } from './video';

export type MarkdownMeta = { title?: string; description?: string; slug?: string };
export type MarkdownImport = { blocks: Block[]; meta: MarkdownMeta; warnings: string[] };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FENCE = /^```\s*([A-Za-z0-9_+.-]*)\s*(.*)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"([^"]*)")?\s*\)$/;
const LINK_ONLY = /^\[([^\]]+)\]\(\s*(\S+?)\s*\)$/;
const HR = /^(-{3,}|\*{3,}|_{3,})$/;

/** key="value" / key='value' attributes of a component tag. */
function tagAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\})/g)) {
    out[m[1]!] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return out;
}

function parseFrontmatter(src: string): { body: string; meta: MarkdownMeta } {
  const m = FRONTMATTER.exec(src);
  if (!m) return { body: src, meta: {} };
  const meta: MarkdownMeta = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(title|description|slug)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1] as keyof MarkdownMeta] = kv[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return { body: src.slice(m[0].length), meta };
}

export function markdownToBlocks(source: string): MarkdownImport {
  const warnings: string[] = [];
  const { body, meta } = parseFrontmatter(source.replace(/\r\n/g, '\n'));
  const lines = body.split('\n');
  const blocks: Block[] = [];
  let leadingH1Candidate: number | null = null;
  let h1Count = 0;

  const push = (block: Block, note: string) => {
    const r = blockSchema.safeParse(block);
    if (r.success) blocks.push(r.data);
    else warnings.push(`${note}: ${r.error.issues[0]?.message ?? 'invalid block'} — skipped`);
  };

  const single = (text: string): Block | null => {
    const img = IMAGE_ONLY.exec(text);
    if (img) return { type: 'image', alt: img[1]!, url: img[2]!, ...(img[3] ? { caption: img[3] } : {}) };
    const link = LINK_ONLY.exec(text);
    if (link && parseYouTubeId(link[2])) return { type: 'video', url: link[2]!, title: link[1]! };
    if (/^https?:\/\/\S+$/.test(text) && parseYouTubeId(text)) return { type: 'video', url: text, title: 'Video' };
    const tag = /^<(Video|YouTube|Image|Figure)\b([\s\S]*?)\/?>(?:\s*<\/\1>)?$/i.exec(text);
    if (tag) {
      const a = tagAttrs(tag[2]!);
      if (/^image|figure$/i.test(tag[1]!)) {
        return { type: 'image', url: a.src ?? a.url ?? '', alt: a.alt ?? '', ...(a.caption ? { caption: a.caption } : {}) };
      }
      const url = a.url ?? a.src ?? (a.id ? `https://youtu.be/${a.id}` : '');
      return { type: 'video', url, title: a.title ?? 'Video', ...(a.caption ? { caption: a.caption } : {}) };
    }
    return null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') { i += 1; continue; }

    // MDX plumbing — never executed, just dropped.
    if (/^(import|export)\s/.test(trimmed)) {
      warnings.push(`Dropped MDX statement: "${trimmed.slice(0, 40)}"`);
      i += 1; continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence) {
      const start = i;
      const rest = fence[2] ?? '';
      const fname = /(?:title|filename)\s*=\s*"([^"]*)"/.exec(rest)?.[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) { code.push(lines[i]!); i += 1; }
      if (i >= lines.length) warnings.push(`Code fence opened on line ${start + 1} was never closed`);
      i += 1;
      push({ type: 'code', text: code.join('\n'), ...(fence[1] ? { language: fence[1] } : {}), ...(fname ? { filename: fname } : {}) }, 'code');
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      const n = heading[1]!.length;
      if (n === 1) {
        h1Count += 1;
        if (blocks.length === 0 && leadingH1Candidate === null) leadingH1Candidate = 0;
      }
      push({ type: 'heading', text: heading[2]!, level: Math.max(2, n) as HeadingLevel }, 'heading');
      i += 1; continue;
    }

    if (HR.test(trimmed)) { i += 1; continue; }

    if (trimmed.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) { q.push(lines[i]!.trim().replace(/^>\s?/, '')); i += 1; }
      const last = q[q.length - 1] ?? '';
      const attr = /^(?:—|--|–)\s*(.+)$/.exec(last);
      const text = (attr ? q.slice(0, -1) : q).join(' ').trim();
      push({ type: 'quote', text, ...(attr ? { attribution: attr[1]! } : {}) }, 'quote');
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d/.test(line);
      let nested = false;
      while (i < lines.length && lines[i]!.trim() !== '') {
        const m = LIST_ITEM.exec(lines[i]!);
        if (m) {
          if (m[1]!.length >= 2) nested = true;
          items.push(m[3]!.trim());
        } else if (items.length) {
          items[items.length - 1] += ` ${lines[i]!.trim()}`;
        } else break;
        i += 1;
      }
      if (nested) warnings.push('Nested list flattened to one level');
      push({ type: 'list', items, ...(ordered ? { ordered: true } : {}) }, 'list');
      continue;
    }

    if (trimmed.startsWith('|')) {
      while (i < lines.length && lines[i]!.trim().startsWith('|')) i += 1;
      warnings.push('Table skipped — tables are not supported; use a list or image');
      continue;
    }

    // Paragraph (or a lone media line). Multi-line JSX tags are joined first.
    const para: string[] = [];
    if (/^<[A-Za-z]/.test(trimmed) && !/>\s*$/.test(trimmed)) {
      while (i < lines.length && !/>\s*$/.test(lines[i]!.trim())) { para.push(lines[i]!.trim()); i += 1; }
      if (i < lines.length) { para.push(lines[i]!.trim()); i += 1; }
    } else {
      while (
        i < lines.length && lines[i]!.trim() !== '' &&
        !FENCE.test(lines[i]!.trim()) && !HEADING.test(lines[i]!.trim()) &&
        !lines[i]!.trim().startsWith('>') && !LIST_ITEM.test(lines[i]!)
      ) { para.push(lines[i]!.trim()); i += 1; }
    }
    const text = para.join(' ').trim();
    if (!text) continue;
    const media = single(text);
    if (media) { push(media, media.type); continue; }
    if (/^<\/?[A-Za-z]/.test(text)) { warnings.push(`Dropped HTML/JSX: ${text.slice(0, 40)}`); continue; }
    if (/!\[[^\]]*\]\([^)]*\)/.test(text)) warnings.push('An image inside a sentence stays as text — put images on their own line');
    push({ type: 'paragraph', text }, 'paragraph');
  }

  // A single leading `# Title` is the page title, not body copy.
  const first = blocks[0];
  if (h1Count === 1 && leadingH1Candidate === 0 && first?.type === 'heading') {
    meta.title ??= first.text;
    blocks.shift();
  } else if (h1Count > 1) {
    warnings.push('Several "# " headings found — all were imported as level-2 headings (the page title owns the only h1)');
  }
  return { blocks, meta, warnings };
}
