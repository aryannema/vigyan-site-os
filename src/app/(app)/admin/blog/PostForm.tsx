'use client';

/**
 * The blog post editor.
 *
 * REPLACES the previous PostForm, which was a single plain <textarea> whose
 * contents were stored as ONE `{type:'paragraph'}` block — headings, lists,
 * images and code in an existing post were flattened into prose on every save.
 *
 * Two modes, both writing the same thing:
 *   'rich'  a Tiptap WYSIWYG restricted to exactly the block/mark vocabulary
 *           `src/lib/content/blocks.ts` can store, beside a live preview that
 *           uses the REAL public-page renderer.
 *   'json'  the raw `content_blocks` array. The fallback that makes the editor
 *           safe: content this deployment cannot cleanly parse is never
 *           silently discarded, just edited as JSON.
 *
 * Ported from vigyan-site-os's `app/admin/blog/PostForm.tsx`, adapted to this
 * repo's UI primitives, tokens, and its fixed BLOG_CATEGORIES vocabulary.
 */

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { POST_STATUSES, type Post } from '@/types/schema';
import { safeParseBlocks, type Block } from '@/lib/content/blocks';
import { BLOG_CATEGORIES } from '@/lib/blog-schema';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

import { SubmitButton } from '../components/SubmitButton';
import { slugify, type FormState } from '../lib/form';
import { decodeContentBlocks } from './content-blocks';
import { RichEditor } from './RichEditor';
import { LivePreview } from './LivePreview';
import { AiSidebar } from './AiSidebar';

interface PostFormProps {
  post?: Post;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /**
   * Distinct categories already in use, merged with this project's own
   * BLOG_CATEGORIES vocabulary for the field's suggestion list.
   *
   * `posts.category` has no CHECK constraint at the database level, so it is
   * genuinely open text — this is a suggestion list, not a closed dropdown.
   * Typing a value not in the list is valid; it just creates a new category.
   * (BLOG_CATEGORIES remains the closed enum the MCP tool validates against,
   * see `src/lib/blog-schema.ts`.)
   */
  categories?: string[];
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function PostForm({ post, action, submitLabel, categories = [] }: PostFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const body = decodeContentBlocks(post?.content_blocks);

  const [title, setTitle] = useState(post?.title ?? '');
  const [seoDescription, setSeoDescription] = useState(post?.seo_description ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  // A slug is a permanent URL, so it is auto-filled from the title only until the
  // user edits it themselves, and never for a post that already has one.
  const [slugTouched, setSlugTouched] = useState(Boolean(post?.slug));

  // Editor mode: 'rich' covers everything the block schema can express
  // (paragraph/heading/list/quote/image/code) via the WYSIWYG editor, with a
  // live preview using the real BlockRenderer. 'json' is the raw-text fallback.
  // Deliberately DOES default to 'rich' for an empty/new post — starting empty
  // in rich mode is exactly the common case this exists for.
  const initialParse = useMemo(() => safeParseBlocks(post?.content_blocks ?? []), [post]);
  const [mode, setMode] = useState<'rich' | 'json'>(initialParse.ok ? 'rich' : 'json');
  const [blocks, setBlocks] = useState<Block[]>(initialParse.ok ? initialParse.blocks : []);
  const [jsonValue, setJsonValue] = useState(body.mode === 'json' ? body.value : '[]');

  // How much room the live preview gets in 'rich' mode: 'split' (default) is
  // editor+preview side by side; 'preview' hides the editor so the preview
  // reads at full width, like the actual published page, instead of a
  // squeezed half-width strip -- the editor's content is untouched either way.
  const [previewView, setPreviewView] = useState<'split' | 'preview'>('split');

  const suggestions = useMemo(
    () => Array.from(new Set([...BLOG_CATEGORIES, ...categories])).sort(),
    [categories],
  );

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-5">
      {state.error && !Object.keys(errors).length ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md border border-hairline bg-sand px-3 py-2 text-sm text-muted">
          {state.success}
        </p>
      ) : null}

      <Field label="Title" htmlFor="title" error={errors.title}>
        <Input
          id="title"
          name="title"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            if (!slugTouched) setSlug(slugify(event.currentTarget.value));
          }}
        />
      </Field>

      <Field
        label="Slug"
        htmlFor="slug"
        hint="Lowercase letters, numbers and single hyphens. Must be unique."
        error={errors.slug}
      >
        <Input
          id="slug"
          name="slug"
          required
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.currentTarget.value);
          }}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Category"
          htmlFor="category"
          hint="Pick an existing one or type a new category."
          error={errors.category}
        >
          <Input
            id="category"
            name="category"
            required
            list="category-suggestions"
            defaultValue={post?.category ?? BLOG_CATEGORIES[0]}
            autoComplete="off"
          />
          <datalist id="category-suggestions">
            {suggestions.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Status"
          htmlFor="status"
          hint="Only 'published' is readable by anonymous visitors."
          error={errors.status}
        >
          <Select id="status" name="status" defaultValue={post?.status ?? 'draft'}>
            {POST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="SEO description"
        htmlFor="seo_description"
        hint={`${seoDescription.length} characters — aim for 100–170.`}
        error={errors.seo_description}
      >
        <Textarea
          id="seo_description"
          name="seo_description"
          rows={2}
          value={seoDescription}
          onChange={(event) => setSeoDescription(event.currentTarget.value)}
        />
      </Field>

      <Field
        label="Featured image URL"
        htmlFor="featured_image"
        error={errors.featured_image}
      >
        <Input id="featured_image" name="featured_image" defaultValue={post?.featured_image ?? ''} />
      </Field>

      {/*
        Both modes submit the same fields — body_mode is always 'json'
        server-side, since a RichEditor-produced Block[] IS valid content_blocks
        JSON. The distinction between 'rich' and 'json' below is purely a UI
        concern: which editor is driving the value, not a different server path.
      */}
      <input type="hidden" name="body_mode" value="json" />
      <input
        type="hidden"
        name="body"
        value={mode === 'rich' ? JSON.stringify(blocks) : jsonValue}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Content</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              variant={mode === 'rich' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (mode === 'json') {
                  try {
                    const parsed = safeParseBlocks(JSON.parse(jsonValue || '[]'));
                    if (parsed.ok) setBlocks(parsed.blocks);
                    // On invalid/unparseable JSON, deliberately keep the LAST
                    // known-good `blocks` rather than clearing the editor —
                    // switching modes must never look like data loss.
                  } catch {
                    // Same reasoning: malformed JSON, keep prior blocks state.
                  }
                }
                setMode('rich');
              }}
            >
              Editor
            </Button>
            <Button
              type="button"
              variant={mode === 'json' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (mode === 'rich') setJsonValue(JSON.stringify(blocks, null, 2));
                setMode('json');
              }}
            >
              Raw JSON
            </Button>
          </div>
        </div>

        {mode === 'rich' ? (
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex-1">
              <div className="mb-1.5 flex items-center gap-1">
                <Button
                  type="button"
                  variant={previewView === 'split' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPreviewView('split')}
                >
                  Side by side
                </Button>
                <Button
                  type="button"
                  variant={previewView === 'preview' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPreviewView('preview')}
                >
                  Preview
                </Button>
              </div>
              {previewView === 'split' ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-xs text-muted">Editing</p>
                    <RichEditor blocks={blocks} onChange={setBlocks} />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs text-muted">
                      Live preview — exactly what the published page will render
                    </p>
                    <div className="h-[520px] lg:h-full lg:min-h-[640px]">
                      <LivePreview title={title} blocks={blocks} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-[75vh] min-h-[520px]">
                  <LivePreview title={title} blocks={blocks} />
                </div>
              )}
            </div>
            <AiSidebar
              title={title}
              seoDescription={seoDescription}
              blocks={blocks}
              onApplyTitle={setTitle}
              onReplaceBody={setBlocks}
            />
          </div>
        ) : (
          <Field
            label=""
            htmlFor="body-json"
            hint='Raw content_blocks JSON. An array of objects, each with a "type" of paragraph, heading, list, quote, image, or code — see src/lib/content/FORMAT.md.'
            error={errors.body}
          >
            <Textarea
              id="body-json"
              rows={16}
              className="font-mono text-xs"
              value={jsonValue}
              onChange={(event) => setJsonValue(event.currentTarget.value)}
            />
          </Field>
        )}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/blog" className="text-sm text-muted underline transition hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export default PostForm;
