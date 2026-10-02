import Link from 'next/link';
import { notFound } from 'next/navigation';
import Eyebrow from '@/components/site/Eyebrow';
import { BuyButton } from '@/components/checkout/BuyButton';
import { BlockRenderer } from '@/lib/content/renderer';
import { getLandingPage, landingPageUrl } from '@/lib/landing-pages';
import { priceState } from '@/lib/pricing';
import { siteConfig } from '@/config/site';
import { defaultCtaLabel, isProductType, type ProductType } from '@/lib/product-types';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default async function LandingView({ slug, preview }: { slug: string; preview: boolean }) {
  const page = await getLandingPage(slug, preview);
  if (!page) notFound();

  const product = page.product;
  const price = product
    ? priceState({
        price_paise: product.price_paise,
        discount_bp: product.discount_bp,
        offer_ends_at: product.offer_ends_at,
        offer_label: product.offer_label,
      })
    : null;
  const isFree = product ? Boolean(product.is_lead_magnet) || price?.effectiveP === 0 : false;
  const productType: ProductType = isProductType(product?.product_type) ? product!.product_type as ProductType : 'one_off';
  const ctaLabel = page.cta_label?.trim() || (product ? product.cta_label?.trim() || defaultCtaLabel(productType, isFree) : 'Talk to us');
  const ctaHref = page.cta_url?.trim() || `/contact?page=${encodeURIComponent(page.slug)}`;

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 pb-20 pt-16 md:pt-20">
      {preview && page.status !== 'published' && (
        <div className="mb-8 rounded-xl border border-saffron-500/40 bg-saffron-500/10 px-4 py-3">
          <p className="text-sm font-bold text-ink">Preview — not published</p>
          <p className="mt-1 text-xs text-body">
            Status is <strong>{page.status}</strong>. Search engines are told not to index this view.
          </p>
        </div>
      )}

      <Eyebrow>Services</Eyebrow>
      <h1 className="mt-4 text-[clamp(2.25rem,5vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink">
        {page.title}
      </h1>
      {page.subtitle && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body">{page.subtitle}</p>}

      <div className="mt-10">
        <BlockRenderer blocks={page.body_blocks} />
      </div>

      <div className="mt-12 rounded-2xl border border-hairline bg-surface p-6 md:p-8">
        {product && price && !isFree && (
          <div className="mb-4 flex flex-wrap items-baseline gap-3">
            <span className="text-4xl font-extrabold text-ink">{rupees(price.effectiveP)}</span>
            {price.offerActive && (
              <>
                <span className="text-lg text-muted line-through">{rupees(price.listP)}</span>
                <span className="rounded-full bg-saffron-500/15 px-2.5 py-1 text-xs font-bold text-saffron-ink">
                  {price.discountPercent}% off
                </span>
              </>
            )}
          </div>
        )}
        {product && price && !isFree ? (
          <>
            <BuyButton productId={product.id} priceP={price.effectiveP} label={ctaLabel} />
            <p className="mt-3 text-xs text-muted">Price includes GST. A tax invoice is issued on payment.</p>
            {product.cta_subtext?.trim() && <p className="mt-1 text-xs text-muted">{product.cta_subtext}</p>}
          </>
        ) : (
          <Link
            href={ctaHref}
            className="inline-flex items-center justify-center rounded-card bg-saffron-500 px-6 py-3 text-sm font-bold text-[#1c1814] transition hover:brightness-[1.04]"
          >
            {ctaLabel}
          </Link>
        )}
      </div>

      {page.status === 'published' && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': product ? 'Product' : 'Service',
              name: page.title,
              description: page.seo_description ?? page.subtitle ?? undefined,
              url: landingPageUrl(page.slug),
              provider: { '@type': 'Organization', name: siteConfig.name, url: siteConfig.url },
              ...(product && price
                ? {
                    offers: {
                      '@type': 'Offer',
                      price: (price.effectiveP / 100).toFixed(2),
                      priceCurrency: 'INR',
                      availability: 'https://schema.org/InStock',
                      url: landingPageUrl(page.slug),
                    },
                  }
                : {}),
            }),
          }}
        />
      )}
    </div>
  );
}
