'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, Copy, ExternalLink, Link2, Package, Sparkles } from 'lucide-react';

import { siteConfig } from '@/config/site';
import {
  CAMPAIGN_PLATFORMS,
  PLATFORM_GROUPS,
  campaignLinkSlug,
  type CampaignPlatform,
} from '@/lib/campaign-platforms';
import { LINK_OFFER_TYPES, shortLinkUrl } from '@/lib/links-schema';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

import { slugify } from '../../lib/form';
import { createCampaignLinks, type CampaignLinksResult } from '../actions';

export interface BuilderProduct {
  id: string;
  slug: string;
  title: string;
  price_paise: number;
}

export interface BuilderLanding {
  slug: string;
  title: string;
  product_id: string | null;
}

const CUSTOM = '__custom__';
const LP = 'lp:';

function destination(base: string, platform: CampaignPlatform, campaign: string): string {
  try {
    const url = new URL(base);
    url.searchParams.set('utm_source', platform.key);
    url.searchParams.set('utm_medium', platform.medium);
    url.searchParams.set('utm_campaign', campaign);
    return url.toString();
  } catch {
    return '';
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard can be blocked; the link is visible to copy by hand */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1 text-xs font-bold text-muted transition hover:border-hairline-strong hover:text-saffron-ink"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CampaignBuilder({
  products,
  landings,
  initialLanding,
}: {
  products: BuilderProduct[];
  landings: BuilderLanding[];
  initialLanding: string | null;
}) {
  const [target, setTarget] = useState<string>(
    initialLanding && landings.some((l) => l.slug === initialLanding)
      ? `${LP}${initialLanding}`
      : (products[0]?.id ?? CUSTOM),
  );
  const [customUrl, setCustomUrl] = useState('');
  const [name, setName] = useState('');
  const [offerType, setOfferType] = useState<string>('free');
  const [offerTouched, setOfferTouched] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CampaignLinksResult | null>(null);

  const landing = target.startsWith(LP) ? (landings.find((l) => `${LP}${l.slug}` === target) ?? null) : null;
  const product = landing
    ? (products.find((p) => p.id === landing.product_id) ?? null)
    : (products.find((p) => p.id === target) ?? null);
  const campaign = slugify(name);
  const baseUrl = landing
    ? `${siteConfig.url}/services/${landing.slug}`
    : product
      ? `${siteConfig.url}/products/${product.slug}`
      : customUrl;
  const effectiveOffer = offerTouched
    ? offerType
    : product
      ? product.price_paise > 0
        ? 'paid'
        : 'lead_magnet'
      : 'free';

  const chosen = useMemo(() => CAMPAIGN_PLATFORMS.filter((p) => picked.has(p.key)), [picked]);
  const ready = Boolean(campaign) && chosen.length > 0 && Boolean(baseUrl) && !pending;

  function toggle(key: string) {
    setResult(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      setResult(
        await createCampaignLinks({
          campaign: name,
          productId: landing ? null : (product?.id ?? null),
          landingSlug: landing?.slug ?? null,
          customUrl: product || landing ? null : customUrl,
          offerType: effectiveOffer,
          platforms: [...picked],
        }),
      );
    });
  }

  const created = result?.ok ? result.links : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-hairline bg-surface p-6">
          <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted">
            <Package className="h-4 w-4" /> What are you promoting
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target">Product or service</Label>
              <Select
                id="target"
                value={target}
                onChange={(e) => {
                  setResult(null);
                  setTarget(e.currentTarget.value);
                }}
              >
                <optgroup label="Products">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </optgroup>
                {landings.length > 0 ? (
                  <optgroup label="Landing pages">
                    {landings.map((l) => (
                      <option key={l.slug} value={`${LP}${l.slug}`}>
                        {l.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <option value={CUSTOM}>Another page or URL…</option>
              </Select>
              <p className="text-xs text-muted">Orders from these links are credited to this product.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offer">Offer type</Label>
              <Select
                id="offer"
                value={effectiveOffer}
                onChange={(e) => {
                  setOfferTouched(true);
                  setOfferType(e.currentTarget.value);
                }}
              >
                {LINK_OFFER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted">Set from the price; change it if this post is a free hook.</p>
            </div>
          </div>
          {!product && !landing ? (
            <div className="mt-4 flex flex-col gap-1.5">
              <Label htmlFor="customUrl">Page URL</Label>
              <Input
                id="customUrl"
                value={customUrl}
                onChange={(e) => {
                  setResult(null);
                  setCustomUrl(e.currentTarget.value);
                }}
                placeholder="https://www.example.com/blog/some-post"
              />
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-6">
          <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted">
            <Sparkles className="h-4 w-4" /> Campaign name
          </div>
          <Input
            id="campaign"
            value={name}
            onChange={(e) => {
              setResult(null);
              setName(e.currentTarget.value);
            }}
            placeholder="Calculator launch, October"
            aria-label="Campaign name"
          />
          <p className="mt-2 text-xs text-muted">
            Reports group by this. Links will look like{' '}
            <span className="font-mono text-ink">/go/{campaignLinkSlug(campaign || 'campaign', 'linkedin')}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted">
              <Link2 className="h-4 w-4" /> Where will you post it
            </div>
            <span className="text-xs font-semibold text-muted">{chosen.length} selected</span>
          </div>
          <div className="space-y-5">
            {PLATFORM_GROUPS.map((group) => (
              <div key={group}>
                <p className="mb-2 text-xs font-bold text-ink">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {CAMPAIGN_PLATFORMS.filter((p) => p.group === group).map((p) => {
                    const on = picked.has(p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(p.key)}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${
                          on
                            ? 'border-brand-primary bg-brand-primary/20 text-ink'
                            : 'border-hairline bg-surface text-muted hover:border-hairline-strong hover:text-ink'
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            on ? 'bg-brand-primary text-[#1c1814]' : 'bg-sand text-muted'
                          }`}
                        >
                          {on ? <Check className="h-3 w-3" /> : p.label[0]}
                        </span>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-hairline bg-surface">
          <div className="border-b border-hairline px-6 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
              {created ? 'Links created' : 'Preview'}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {created
                ? `${created.length} tracked link${created.length === 1 ? '' : 's'} ready to post`
                : chosen.length
                  ? `${chosen.length} link${chosen.length === 1 ? '' : 's'} will be created`
                  : 'Pick platforms to see the links'}
            </p>
          </div>

          <ul className="divide-y divide-hairline-faint">
            {(created
              ? created.map((c) => ({ key: c.platform, slug: c.slug, url: c.url }))
              : chosen.map((p) => ({
                  key: p.key,
                  slug: campaignLinkSlug(campaign || 'campaign', p.key),
                  url: shortLinkUrl(campaignLinkSlug(campaign || 'campaign', p.key)),
                }))
            ).map((row) => {
              const p = CAMPAIGN_PLATFORMS.find((x) => x.key === row.key)!;
              return (
                <li key={row.key} className="space-y-1.5 px-6 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-ink">{p.label}</span>
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                      {p.medium}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs text-ink" title={row.url}>
                      /go/{row.slug}
                    </span>
                    <CopyButton text={row.url} />
                  </div>
                  {baseUrl && campaign ? (
                    <p className="truncate text-[11px] text-muted" title={destination(baseUrl, p, campaign)}>
                      → {destination(baseUrl, p, campaign) || 'Enter a valid URL'}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="space-y-3 border-t border-hairline px-6 py-4">
            {result && !result.ok ? (
              <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">
                {result.error}
              </p>
            ) : null}
            {created ? (
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={created.map((c) => `${c.platform}: ${c.url}`).join('\n')} label="Copy all" />
                <a
                  href="/admin/links"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold text-saffron-ink hover:underline"
                >
                  View in Link Builder <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : (
              <button
                type="button"
                disabled={!ready}
                onClick={submit}
                className="w-full rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-lg shadow-brand-primary/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Creating…' : `Create ${chosen.length || ''} link${chosen.length === 1 ? '' : 's'}`.replace('  ', ' ')}
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
