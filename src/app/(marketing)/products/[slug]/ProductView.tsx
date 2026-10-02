import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { priceState } from '@/lib/pricing';
import { siteConfig } from '@/config/site';
import Eyebrow from '@/components/site/Eyebrow';
import { CountdownTimer } from './CountdownTimer';
import { defaultCtaLabel, isProductType, isPubliclyVisible, type ProductType } from '@/lib/product-types';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

type Product = {
  id: string; slug: string; title: string; description: string | null;
  category: string | null; price_paise: number; status: string;
  discount_bp: number | null; offer_ends_at: string | null; offer_label: string | null;
  cta_label: string | null; cta_subtext: string | null;
  fulfilment_kind: string | null; is_lead_magnet: boolean | null;
  product_type: string | null;
};

const COLUMNS =
  'id, slug, title, description, category, price_paise, status, discount_bp, offer_ends_at, ' +
  'offer_label, cta_label, cta_subtext, fulfilment_kind, is_lead_magnet, product_type';

export async function getProduct(slug: string, preview: boolean): Promise<Product | null> {
  const query = supabaseAdmin.from('products').select(COLUMNS).eq('slug', slug);
  // A draft is reachable only through /products/[slug]/preview, which is how
  // the admin checks a launch before publishing it.
  const { data } = await (preview ? query : query.eq('status', 'active')).maybeSingle();
  return (data as Product | null) ?? null;
}

/**
 * The public product page.
 *
 * Until now the commerce path had a complete data layer -- price, discount,
 * deadline, GST, invoice, fulfilment, campaign attribution -- and nowhere for a
 * customer to actually see or buy anything. This is that page.
 *
 * The price shown here is computed by the same priceState() the checkout uses,
 * so the page and the charge cannot disagree. The countdown is decoration: the
 * server re-decides at order time whether the offer still stands.
 */
export default async function ProductView(
  { slug, preview }: { slug: string; preview: boolean },
) {
  const product = await getProduct(slug, preview);
  if (!product) notFound();

  const price = priceState({
    price_paise: product.price_paise,
    discount_bp: product.discount_bp,
    offer_ends_at: product.offer_ends_at,
    offer_label: product.offer_label,
  });

  const isFree = Boolean(product.is_lead_magnet) || price.effectiveP === 0;
  // Untyped from the database, so it is narrowed rather than trusted; an
  // unrecognised value falls back to the safest generic rather than crashing.
  const productType: ProductType = isProductType(product.product_type) ? product.product_type : 'one_off';

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 pb-20 pt-16 md:pt-20">
      {preview && !isPubliclyVisible(product.status) && (
        <div className="mb-8 rounded-xl border border-saffron-500/40 bg-saffron-500/10 px-4 py-3">
          <p className="text-sm font-bold text-ink">Preview — not published</p>
          <p className="mt-1 text-xs text-body">
            Status is <strong>{product.status}</strong>. Only people with this link can see it, and search
            engines are told not to index it. Publish it from the admin when it is ready.
          </p>
        </div>
      )}

      {product.category && <Eyebrow>{product.category}</Eyebrow>}

      <h1 className="mt-4 text-[clamp(2.25rem,5vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink">
        {product.title}
      </h1>

      {product.description && (
        <div className="mt-6 max-w-2xl whitespace-pre-wrap text-lg leading-relaxed text-body">
          {product.description}
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-hairline bg-surface p-6 md:p-8">
        {isFree ? (
          <p className="text-3xl font-extrabold text-ink">Free</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-4xl font-extrabold text-ink">{rupees(price.effectiveP)}</span>
            {price.offerActive && (
              <>
                <span className="text-lg text-muted line-through">{rupees(price.listP)}</span>
                <span className="rounded-full bg-saffron-500/15 px-2.5 py-1 text-xs font-bold text-saffron-ink">
                  {price.discountPercent}% off · save {rupees(price.savedP)}
                </span>
              </>
            )}
          </div>
        )}

        {price.offerActive && price.offerEndsAt && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {price.offerLabel && <span className="text-sm font-bold text-ink">{price.offerLabel}</span>}
            <CountdownTimer endsAt={price.offerEndsAt} />
          </div>
        )}

        <p className="mt-3 text-xs text-muted">
          {isFree ? 'No payment required.' : 'Price includes GST. A tax invoice is issued on payment.'}
        </p>

        <Link
          href={`/contact?product=${encodeURIComponent(product.slug)}`}
          className="mt-6 inline-flex items-center justify-center rounded-card bg-saffron-500 px-6 py-3 text-sm font-bold text-[#1c1814] transition hover:brightness-[1.04]"
        >
          {product.cta_label?.trim() || defaultCtaLabel(productType, isFree)}
        </Link>

        {product.cta_subtext?.trim() && (
          <p className="mt-2 text-xs text-muted">{product.cta_subtext}</p>
        )}
      </div>

      <p className="mt-8 text-xs text-muted">
        Questions before you buy? <Link href="/contact" className="font-bold text-saffron-ink hover:underline">Talk to us</Link>.
      </p>

      {isPubliclyVisible(product.status) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: product.title,
              description: product.description ?? undefined,
              offers: {
                '@type': 'Offer',
                price: (price.effectiveP / 100).toFixed(2),
                priceCurrency: 'INR',
                availability: 'https://schema.org/InStock',
                url: `${siteConfig.url}/products/${product.slug}`,
                ...(price.offerActive && price.offerEndsAt
                  ? { priceValidUntil: price.offerEndsAt.slice(0, 10) }
                  : {}),
              },
            }),
          }}
        />
      )}
    </div>
  );
}
