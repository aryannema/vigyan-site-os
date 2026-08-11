'use client';

/**
 * A Tiptap editor restricted to exactly the node/mark set
 * `lib/content/tiptap.ts` can serialize (`EXPECTED_TIPTAP_NODES` /
 * `EXPECTED_TIPTAP_MARKS`). Every StarterKit extension NOT on that list is
 * explicitly disabled — Strike, HorizontalRule, HardBreak — so the toolbar
 * cannot produce formatting the block format has nowhere to put. That is the
 * whole point of the restriction: what you can type here is exactly what will
 * survive a save, with nothing silently dropped.
 *
 * On every change: `editor.getJSON()` -> `tiptapDocToBlocks()` -> the parent's
 * `onChange`, so the caller always holds real `Block[]`, not ProseMirror JSON.
 */

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { blocksToTiptapDoc, tiptapDocToBlocks, type TiptapDoc } from '@/lib/content/tiptap';
import type { Block } from '@/lib/content/blocks';
import { isSafeUrl } from '@/lib/content/blocks';
import { uploadPostImage } from './upload-actions';

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

function Toolbar({ editor }: { editor: Editor }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileSelected(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadPostImage(formData);
      if (result.ok) {
        // eslint-disable-next-line no-alert
        const alt = window.prompt('Alt text (required — describe the image):') ?? '';
        editor.chain().focus().setImage({ src: result.url, alt }).run();
      } else {
        setUploadError(result.error);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted px-2 py-1.5">
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

      <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

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

      <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

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
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="h-4 w-4" />
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
          // eslint-disable-next-line no-alert
          const alt = window.prompt('Alt text (required — describe the image):') ?? '';
          editor.chain().focus().setImage({ src: url, alt }).run();
        }}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      {uploadError && (
        <span className="ml-1 text-xs text-destructive" role="alert">
          {uploadError}
        </span>
      )}
    </div>
  );
}

export function RichEditor({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
}) {
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
        // Matches lib/content/blocks.ts's isSafeUrl allow-list; the toolbar's
        // own prompt also checks this, but a pasted link must be checked too.
        protocols: ['http', 'https', 'mailto', 'tel'],
      }),
      Image.configure({ inline: false }),
    ],
    content: blocksToTiptapDoc(blocks) as unknown as Record<string, unknown>,
    onUpdate: ({ editor: e }) => {
      onChange(tiptapDocToBlocks(e.getJSON() as unknown as TiptapDoc));
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[240px] px-4 py-3 ' +
          'focus:outline-none prose-headings:text-foreground prose-headings:font-bold ' +
          'prose-p:text-foreground prose-a:text-primary prose-strong:text-foreground',
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
      <div className="min-h-[280px] animate-pulse rounded-lg border border-border bg-muted" />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
