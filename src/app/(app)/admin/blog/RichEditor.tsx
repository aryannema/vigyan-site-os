'use client';

/**
 * A Tiptap editor restricted to exactly the node/mark set
 * `src/lib/content/tiptap.ts` can serialize (`EXPECTED_TIPTAP_NODES` /
 * `EXPECTED_TIPTAP_MARKS`). Every StarterKit extension NOT on that list is
 * explicitly disabled — Strike, HorizontalRule, HardBreak — so the toolbar
 * cannot produce formatting the block format has nowhere to put. That is the
 * whole point of the restriction: what you can type here is exactly what will
 * survive a save, with nothing silently dropped.
 *
 * On every change: `editor.getJSON()` -> `tiptapDocToBlocks()` -> the parent's
 * `onChange`, so the caller always holds real `Block[]`, not ProseMirror JSON.
 *
 * Ported from vigyan-site-os; wired to this repo's `@/components/ui/button` and
 * its own design tokens (`hairline`, `sand`, `surface`, `ink`, `saffron-ink`)
 * rather than the template's brand-neutral ones.
 */

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect, useRef, useState } from 'react';
import { VideoNode } from './VideoNode';
import { MarkdownNode } from './MarkdownNode';
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Code as CodeIcon,
  Link as LinkIcon,
  List as ListIcon,
  ListOrdered,
  Quote as QuoteIcon,
  Heading2,
  Heading3,
  ImageIcon,
  Code2,
  Loader2,
  Sparkles,
  Workflow,
  Youtube,
  FileText,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { blocksToTiptapDoc, tiptapDocToBlocks, type TiptapDoc } from '@/lib/content/tiptap';
import type { Block } from '@/lib/content/blocks';
import { isSafeUrl } from '@/lib/content/blocks';
import { parseYouTubeId } from '@/lib/content/video';
import { markdownToBlocks, type MarkdownMeta } from '@/lib/content/markdown';

import { uploadPostImage } from './upload-actions';
import { generateAndSaveImage } from './ai-actions';

function ToolbarButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      className="h-8 w-8 p-0"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor, onToggleImport }: { editor: Editor; onToggleImport: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function insertImage(url: string) {
    // eslint-disable-next-line no-alert
    const alt = window.prompt('Alt text (required — describe the image):') ?? '';
    editor.chain().focus().setImage({ src: url, alt }).run();
  }

  async function handleFileSelected(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadPostImage(formData);
      if (result.ok) insertImage(result.url);
      else setUploadError(result.error);
    } finally {
      setUploading(false);
    }
  }

  async function handleGenerateImage() {
    // eslint-disable-next-line no-alert
    const prompt = window.prompt('Describe the image to generate:');
    if (!prompt) return;
    // eslint-disable-next-line no-alert
    const referenceUrl = window.prompt(
      'Reference image URL, for a consistent character/face across generations (optional — leave blank to skip; ' +
        'find URLs in /admin/media, "Media Library"):',
    );
    setGenerating(true);
    setUploadError(null);
    try {
      const result = await generateAndSaveImage(prompt, referenceUrl || undefined);
      if (result.ok) insertImage(result.url);
      else setUploadError(result.error);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-hairline bg-sand px-2 py-1.5">
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <BoldIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Link"
        active={editor.isActive('link')}
        onClick={() => {
          const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
          // eslint-disable-next-line no-alert
          const url = window.prompt('Link URL (http(s), mailto:, tel:, or a relative path):', previous);
          if (url === null) return;
          if (url.trim() === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
          }
          if (!isSafeUrl(url)) {
            // eslint-disable-next-line no-alert
            window.alert('That URL is not allowed (only http(s), mailto:, tel:, or a relative path).');
            return;
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-hairline-strong" aria-hidden="true" />

      <ToolbarButton
        label="Heading 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-hairline-strong" aria-hidden="true" />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <QuoteIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={editor.isActive('codeBlock') && editor.getAttributes('codeBlock').language !== 'mermaid'}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Mermaid diagram"
        active={editor.isActive('codeBlock', { language: 'mermaid' })}
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'codeBlock',
              attrs: { language: 'mermaid' },
              content: [{ type: 'text', text: 'graph TD\n    A[Start] --> B[End]' }],
            })
            .run()
        }
      >
        <Workflow className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Upload image"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
      </ToolbarButton>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void handleFileSelected(file);
        }}
      />
      <ToolbarButton
        label="Insert image from URL"
        onClick={() => {
          // eslint-disable-next-line no-alert
          const url = window.prompt('Image URL (for an already-hosted image — use the upload button above for local files):');
          if (!url) return;
          if (!isSafeUrl(url)) {
            // eslint-disable-next-line no-alert
            window.alert('That URL is not allowed (only http(s) or a relative path).');
            return;
          }
          insertImage(url);
        }}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Embed YouTube video"
        onClick={() => {
          // eslint-disable-next-line no-alert
          const url = window.prompt('YouTube link (unlisted works): youtube.com/watch?v=… or youtu.be/…');
          if (!url) return;
          if (!parseYouTubeId(url)) {
            // eslint-disable-next-line no-alert
            window.alert('That is not a YouTube link.');
            return;
          }
          // eslint-disable-next-line no-alert
          const title = window.prompt('Video title (required — used for accessibility and search):') ?? '';
          if (!title.trim()) return;
          editor.chain().focus().insertContent({ type: 'video', attrs: { url: url.trim(), title: title.trim() } }).run();
        }}
      >
        <Youtube className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Import Markdown / MDX" onClick={onToggleImport}>
        <FileText className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Generate image (AI)"
        disabled={generating}
        onClick={handleGenerateImage}
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      </ToolbarButton>
      {uploadError && (
        <span className="ml-1 text-xs text-red-600" role="alert">
          {uploadError}
        </span>
      )}
    </div>
  );
}

function ImportPanel({
  blocks,
  onChange,
  onMeta,
  onClose,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  onMeta?: (meta: MarkdownMeta) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const preview = text.trim() ? markdownToBlocks(text) : null;

  const [keep, setKeep] = useState(true);
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();

  function apply(mode: 'append' | 'replace') {
    if (!preview) return;
    const incoming: Block[] = keep
      ? body ? [{ type: 'markdown', text: body }] : []
      : preview.blocks;
    if (incoming.length === 0) return;
    onChange(mode === 'replace' ? incoming : [...blocks, ...incoming]);
    onMeta?.(preview.meta);
    setWarnings(keep ? [] : preview.warnings);
    if (keep || preview.warnings.length === 0) onClose();
    setText('');
  }

  return (
    <div className="space-y-2 border-b border-hairline bg-sand/60 p-3">
      <p className="text-xs text-body">
        Paste Markdown or MDX (headings, lists, quotes, code, <code>![alt](url &quot;caption&quot;)</code>, a YouTube link on its own line,{' '}
        <code>&lt;Video url=&quot;…&quot; title=&quot;…&quot; /&gt;</code>). Nothing is executed.
      </p>
      <div className="flex flex-col gap-1 text-xs text-body">
        <label className="flex items-start gap-2">
          <input type="radio" checked={keep} onChange={() => setKeep(true)} className="mt-0.5" />
          <span><b>Keep as Markdown (lossless)</b> — tables, LaTeX math, mermaid diagrams, task lists, footnotes all render as written. Edit the raw text later.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" checked={!keep} onChange={() => setKeep(false)} className="mt-0.5" />
          <span><b>Convert to editable blocks</b> — friendlier to edit visually, but tables, math and nested lists are dropped or flattened (see warnings).</span>
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="w-full rounded-card border border-hairline bg-surface p-2 font-mono text-xs text-ink"
        placeholder="# My article&#10;&#10;Write or paste here…"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".md,.mdx,text/markdown,text/plain"
          className="text-xs"
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            if (file) setText(await file.text());
          }}
        />
        <Button type="button" size="sm" disabled={!preview || (keep ? !body : preview.blocks.length === 0)} onClick={() => apply('append')}>
          Add to end{preview && !keep ? ` (${preview.blocks.length} blocks)` : ''}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!preview || (keep ? !body : preview.blocks.length === 0)} onClick={() => apply('replace')}>
          Replace everything
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      {!keep && (preview?.warnings.length ? preview.warnings : warnings).length > 0 && (
        <ul className="list-disc pl-5 text-xs text-saffron-ink">
          {(preview?.warnings.length ? preview.warnings : warnings).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RichEditor({
  blocks,
  onChange,
  onImportMeta,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  onImportMeta?: (meta: MarkdownMeta) => void;
}) {
  const [importing, setImporting] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Everything not in EXPECTED_TIPTAP_NODES/MARKS is off, on purpose —
        // see the file header. Enabling any of these means a user can produce
        // formatting that silently vanishes on save.
        strike: false,
        horizontalRule: false,
        hardBreak: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        // Matches src/lib/content/blocks.ts's isSafeUrl allow-list; the
        // toolbar's own prompt also checks this, but a pasted link must be
        // checked too.
        protocols: ['http', 'https', 'mailto', 'tel'],
      }),
      Image.configure({ inline: false }),
      VideoNode,
      MarkdownNode,
    ],
    content: blocksToTiptapDoc(blocks) as unknown as Record<string, unknown>,
    onUpdate: ({ editor: e }) => {
      onChange(tiptapDocToBlocks(e.getJSON() as unknown as TiptapDoc));
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[240px] px-4 py-3 ' +
          'focus:outline-none prose-headings:text-ink prose-headings:font-bold ' +
          'prose-p:text-body prose-a:text-saffron-ink prose-strong:text-ink',
      },
    },
  });

  // Keep the editor in sync if `blocks` changes from OUTSIDE this component
  // (e.g. the parent form loaded a different post). Guarded so we do not fight
  // our own onUpdate -> parent -> prop round-trip on every keystroke.
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(tiptapDocToBlocks(editor.getJSON() as unknown as TiptapDoc));
    const incoming = JSON.stringify(blocks);
    if (current !== incoming) {
      editor.commands.setContent(blocksToTiptapDoc(blocks) as unknown as Record<string, unknown>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, JSON.stringify(blocks)]);

  if (!editor) {
    return (
      <div className="min-h-[280px] animate-pulse rounded-card border border-hairline bg-sand" />
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <Toolbar editor={editor} onToggleImport={() => setImporting((v) => !v)} />
      {importing && (
        <ImportPanel blocks={blocks} onChange={onChange} onMeta={onImportMeta} onClose={() => setImporting(false)} />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
