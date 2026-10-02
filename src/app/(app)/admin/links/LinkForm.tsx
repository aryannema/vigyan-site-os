'use client';

import { useActionState, useState } from 'react';

import { siteConfig } from '@/config/site';
import { LINK_OFFER_TYPES, LINK_STATUSES, type LinkOfferType, type ShortLink } from '@/lib/links-schema';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

import { SubmitButton } from '../components/SubmitButton';
import { slugify, type FormState } from '../lib/form';

interface LinkFormProps {
  link?: ShortLink;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /** Slugs of active `products` rows — used only to suggest offer_type from target_url; not authoritative. */
  productSlugs: string[];
}

// Our own social profiles, plus the places we post that are not profiles of
// ours. Reddit and Quora are destinations, not accounts, so they do not belong
// in siteConfig.links.social -- but they still need a consistent label here,
// because free text produces "Reddit" / "reddit" / "r/india" and splits the
// reporting three ways. See docs/POSTING_RULES.md for what works where.
const PLATFORM_OPTIONS = [
  ...Object.keys(siteConfig.links.social),
  'whatsapp',
  'reddit',
  'quora',
  'hackernews',
  'discord',
  'github',
  'blog',
  'email',
  'newsletter',
  'other',
];

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
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function suggestOfferType(targetUrl: string, productSlugs: string[]): LinkOfferType | null {
  if (!targetUrl) return null;
  if (targetUrl.includes('/checkout/')) return 'paid';
  const hit = productSlugs.some((slug) => targetUrl.includes(slug));
  return hit ? 'paid' : null;
}

export function LinkForm({ link, action, submitLabel, productSlugs }: LinkFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);

  const [targetUrl, setTargetUrl] = useState(link?.target_url ?? '');
  const [campaign, setCampaign] = useState(link?.utm_campaign ?? '');
  const [slug, setSlug] = useState(link?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(link?.slug));
  const [source, setSource] = useState(link?.utm_source ?? '');
  const [sourceTouched, setSourceTouched] = useState(Boolean(link?.utm_source));
  const [offerType, setOfferType] = useState<LinkOfferType>(link?.offer_type ?? 'free');
  const [offerTouched, setOfferTouched] = useState(Boolean(link));

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5">
      {state.error && !Object.keys(errors).length ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md border border-hairline bg-sand px-3 py-2 text-sm text-muted">
          {state.success}
        </p>
      ) : null}

      <Field label="Target URL" htmlFor="target_url" hint="Where the link actually goes — utm_* params are appended at redirect time." error={errors.target_url}>
        <Input
          id="target_url"
          name="target_url"
          required
          value={targetUrl}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setTargetUrl(value);
            if (!offerTouched) {
              const suggested = suggestOfferType(value, productSlugs);
              if (suggested) setOfferType(suggested);
            }
          }}
          placeholder="https://www.example.com/blog/some-post"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Campaign" htmlFor="utm_campaign" hint="Shared across every platform's link for the same content — that's what rolls them up together in Analytics." error={errors.utm_campaign}>
          <Input
            id="utm_campaign"
            name="utm_campaign"
            value={campaign}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCampaign(value);
              if (!slugTouched) setSlug(slugify(value));
            }}
          />
        </Field>

        <Field
          label="Slug"
          htmlFor="slug"
          hint={`/go/<slug> — ${siteConfig.url}/go/${slug || '…'}`}
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
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Source" htmlFor="utm_source" error={errors.utm_source}>
          <Input
            id="utm_source"
            name="utm_source"
            value={source}
            onChange={(event) => {
              setSourceTouched(true);
              setSource(event.currentTarget.value);
            }}
            placeholder="linkedin"
          />
        </Field>

        <Field label="Medium" htmlFor="utm_medium" error={errors.utm_medium}>
          <Input id="utm_medium" name="utm_medium" defaultValue={link?.utm_medium ?? ''} placeholder="social" />
        </Field>

        <Field label="Platform" htmlFor="platform" error={errors.platform}>
          <Select
            id="platform"
            name="platform"
            defaultValue={link?.platform ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (!sourceTouched) setSource(value);
            }}
          >
            <option value="">—</option>
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Term" htmlFor="utm_term" error={errors.utm_term}>
          <Input id="utm_term" name="utm_term" defaultValue={link?.utm_term ?? ''} />
        </Field>

        <Field label="Content" htmlFor="utm_content" error={errors.utm_content}>
          <Input id="utm_content" name="utm_content" defaultValue={link?.utm_content ?? ''} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Offer type"
          htmlFor="offer_type"
          hint="Reporting label only — no ad-spend flow behind it. 'Paid' = points at something sold via products/checkout."
          error={errors.offer_type}
        >
          <Select
            id="offer_type"
            name="offer_type"
            value={offerType}
            onChange={(event) => {
              setOfferTouched(true);
              setOfferType(event.currentTarget.value as LinkOfferType);
            }}
          >
            {LINK_OFFER_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor="status" error={errors.status}>
          <Select id="status" name="status" defaultValue={link?.status ?? 'active'}>
            {LINK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </form>
  );
}
