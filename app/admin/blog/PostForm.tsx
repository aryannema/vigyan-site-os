'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { POST_STATUSES, type Post } from '@/types/schema';

import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { SubmitButton } from '../components/SubmitButton';
import { slugify, type FormState } from '../lib/form';
import { decodeContentBlocks } from './content-blocks';

interface PostFormProps {
  post?: Post;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
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
      {!error && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PostForm({ post, action, submitLabel }: PostFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const body = decodeContentBlocks(post?.content_blocks);

  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  // A slug is a permanent URL, so it is auto-filled from the title only until the
  // user edits it themselves, and never for a post that already has one.
  const [slugTouched, setSlugTouched] = useState(Boolean(post?.slug));

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-5">
      {state.error && !Object.keys(errors).length ? (
        <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
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
        <Field label="Category" htmlFor="category" error={errors.category}>
          <Input id="category" name="category" required defaultValue={post?.category ?? ''} />
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
        error={errors.seo_description}
      >
        <Textarea
          id="seo_description"
          name="seo_description"
          rows={2}
          defaultValue={post?.seo_description ?? ''}
        />
      </Field>

      <Field
        label="Featured image URL"
        htmlFor="featured_image"
        error={errors.featured_image}
      >
        <Input id="featured_image" name="featured_image" defaultValue={post?.featured_image ?? ''} />
      </Field>

      <input type="hidden" name="body_mode" value={body.mode} />
      <Field
        label={body.mode === 'json' ? 'Content blocks (JSON)' : 'Body (Markdown)'}
        htmlFor="body"
        hint={
          body.mode === 'json'
            ? 'This post uses content blocks that are not plain Markdown, so it is edited as raw JSON to avoid discarding them. Must be a JSON array of objects, each with a "type".'
            : 'Stored as a single { "type": "markdown", "text": … } content block.'
        }
        error={errors.body}
      >
        <Textarea
          id="body"
          name="body"
          rows={body.mode === 'json' ? 16 : 12}
          className={body.mode === 'json' ? 'font-mono text-xs' : ''}
          defaultValue={body.value}
        />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/blog" className="text-sm text-muted-foreground underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
