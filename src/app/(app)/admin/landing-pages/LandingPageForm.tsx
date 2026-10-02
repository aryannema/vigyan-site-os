'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { safeParseBlocks, type Block } from '@/lib/content/blocks';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { SubmitButton } from '../components/SubmitButton';
import { slugify, type FormState } from '../lib/form';
import { RichEditor } from '../blog/RichEditor';
import { LivePreview } from '../blog/LivePreview';

export type LandingFormPage = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  body_blocks: unknown;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  product_id: string | null;
  cta_label: string | null;
  cta_url: string | null;
  status: string;
};

export type MenuOptions = {
  parents: { id: string; label: string }[];
  current: { parent: string; label: string } | null; // parent: '__top__' or a nav item id
};

export type ProductOption = { id: string; title: string; status: string; price_paise: number };

function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor: string; hint?: string; error?: string; children: React.ReactNode;
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

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5 md:p-6">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function LandingPageForm({ page, products, menu, action, submitLabel }: {
  page?: LandingFormPage;
  products: ProductOption[];
  menu: MenuOptions;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const errors = state.fieldErrors ?? {};

  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(page?.slug));
  const [seoTitle, setSeoTitle] = useState(page?.seo_title ?? '');
  const [seoDesc, setSeoDesc] = useState(page?.seo_description ?? '');
  const [productId, setProductId] = useState(page?.product_id ?? '');
  const initial = useMemo(() => safeParseBlocks(page?.body_blocks ?? []), [page]);
  const [blocks, setBlocks] = useState<Block[]>(initial.ok ? initial.blocks : []);

  const product = products.find((p) => p.id === productId);

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-5">
      {state.error && !Object.keys(errors).length ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="rounded-md border border-hairline bg-sand px-3 py-2 text-sm font-semibold text-ink">{state.success}</p>
      ) : null}

      <Card title="Page" note="The headline and URL visitors and search engines see.">
        <Field label="Headline (H1)" htmlFor="title" error={errors.title}>
          <Input id="title" name="title" required value={title} onChange={(e) => {
            setTitle(e.currentTarget.value);
            if (!slugTouched) setSlug(slugify(e.currentTarget.value));
          }} />
        </Field>
        <Field label="URL" htmlFor="slug" error={errors.slug}
          hint={`Lives at /services/${slug || 'your-page'} — permanent once shared, so choose carefully.`}>
          <Input id="slug" name="slug" required value={slug} onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.currentTarget.value);
          }} />
        </Field>
        <Field label="Subheading" htmlFor="subtitle" error={errors.subtitle} hint="One or two sentences under the headline.">
          <Textarea id="subtitle" name="subtitle" rows={2} defaultValue={page?.subtitle ?? ''} />
        </Field>
      </Card>

      <Card title="Content" note="Headings, paragraphs, lists, quotes, images and code. Rendered on the server as real HTML, so search engines read every word.">
        <input type="hidden" name="body" value={JSON.stringify(blocks)} />
        {errors.body ? <p className="text-xs text-destructive">{errors.body}</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs text-muted">Editing</p>
            <RichEditor blocks={blocks} onChange={setBlocks} />
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted">Live preview</p>
            <div className="h-[520px] lg:h-full lg:min-h-[480px]"><LivePreview title={title} blocks={blocks} /></div>
          </div>
        </div>
      </Card>

      <Card title="Search & sharing" note="What Google, Bing and social previews show.">
        <Field label="SEO title" htmlFor="seo_title" error={errors.seo_title}
          hint={`${seoTitle.length}/70 — leave blank to use the headline.`}>
          <Input id="seo_title" name="seo_title" value={seoTitle} onChange={(e) => setSeoTitle(e.currentTarget.value)} />
        </Field>
        <Field label="SEO description" htmlFor="seo_description" error={errors.seo_description}
          hint={`${seoDesc.length}/170 — aim for 100–160.`}>
          <Textarea id="seo_description" name="seo_description" rows={2} value={seoDesc} onChange={(e) => setSeoDesc(e.currentTarget.value)} />
        </Field>
        <Field label="Share image URL" htmlFor="og_image_url" error={errors.og_image_url}>
          <Input id="og_image_url" name="og_image_url" defaultValue={page?.og_image_url ?? ''} placeholder="https://…" />
        </Field>
      </Card>

      <Card title="Call to action" note="Attach a product to sell it here with Razorpay checkout, or point the button anywhere.">
        <Field label="Product to sell" htmlFor="product_id" error={errors.product_id}
          hint={product
            ? product.status === 'active'
              ? `Buyers pay ₹${(product.price_paise / 100).toLocaleString('en-IN')} (+GST) via Razorpay checkout. Price always comes from the product.`
              : 'This product is not active, so the page falls back to the button below until you activate it.'
            : 'None — the page shows a plain button instead of checkout.'}>
          <Select id="product_id" name="product_id" value={productId} onChange={(e) => setProductId(e.currentTarget.value)}>
            <option value="">No product (contact button)</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.title}{p.status !== 'active' ? ` (${p.status})` : ''}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Button label" htmlFor="cta_label" error={errors.cta_label} hint="Blank uses the product’s label, or “Talk to us”.">
            <Input id="cta_label" name="cta_label" defaultValue={page?.cta_label ?? ''} />
          </Field>
          <Field label="Button link" htmlFor="cta_url" error={errors.cta_url} hint="Used when no product is sold. Blank goes to /contact.">
            <Input id="cta_url" name="cta_url" defaultValue={page?.cta_url ?? ''} placeholder="/contact or https://…" />
          </Field>
        </div>
      </Card>

      <Card title="Show in menu" note="Put this page in the header menu, on its own or as a submenu item. It appears only while the page is published, and follows the page if you change its address.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Where" htmlFor="menu_parent">
            <Select id="menu_parent" name="menu_parent" defaultValue={menu.current?.parent ?? ''}>
              <option value="">Not in the menu</option>
              <option value="__top__">Top of the menu</option>
              {menu.parents.map((m) => <option key={m.id} value={m.id}>Submenu of {m.label}</option>)}
            </Select>
          </Field>
          <Field label="Menu label" htmlFor="menu_label" error={errors.menu_label} hint="Blank uses the page title.">
            <Input id="menu_label" name="menu_label" maxLength={40} defaultValue={menu.current?.label ?? ''} />
          </Field>
        </div>
      </Card>

      <Card title="Publish" note="Publishing updates the page, sitemap and edge cache immediately, and notifies Bing, Yandex and Google.">
        <Field label="Status" htmlFor="status" error={errors.status}>
          <Select id="status" name="status" defaultValue={page?.status ?? 'draft'}>
            <option value="draft">Draft — only visible in preview</option>
            <option value="published">Published — live and in the sitemap</option>
            <option value="archived">Archived — removed from the site</option>
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>{submitLabel}</SubmitButton>
          {page ? (
            <>
              <Link href={`/services/${page.slug}/preview`} target="_blank" className="text-sm text-muted underline transition hover:text-ink">Preview ↗</Link>
              {page.status === 'published' ? (
                <Link href={`/services/${page.slug}`} target="_blank" className="text-sm text-muted underline transition hover:text-ink">View live ↗</Link>
              ) : null}
            </>
          ) : null}
          <Link href="/admin/landing-pages" className="text-sm text-muted underline transition hover:text-ink">Back to pages</Link>
        </div>
      </Card>
    </form>
  );
}
