import WaitlistForm from '@/components/forms/WaitlistForm';
import type { Metadata } from 'next';
import Link from 'next/link';
import Eyebrow from '@/components/site/Eyebrow';
import ConfirmPlaceholder from '@/components/site/ConfirmPlaceholder';
import { BRAND_LABEL } from '@/lib/brand';
import { isFeatureEnabled } from '@/lib/feature-flags';

// Pre-launch product page. The route and the 'sample_product_live' flag are
// generic machinery: rename the copy below to your own upcoming product.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Sample Product',
  description: 'Sample Product — an upcoming product. Join the waitlist to hear when it opens.',
  alternates: { canonical: '/sample-product' },
};

const FAQ = [
  { q: 'When does it open?', a: 'Replace with your answer.' },
  { q: 'How is it priced?', a: 'Replace with your answer.' },
  { q: 'Can I export my data and leave?', a: 'Replace with your answer.' },
];

export default async function SampleProductPage() {
  // While the flag is off the page shows a waitlist instead of product claims:
  // someone who found the URL is the most qualified visitor it will get.
  if (!(await isFeatureEnabled('sample_product_live'))) {
    return <ProductWaitlist />;
  }

  return (
    <div>
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-16 md:pt-20">
        <Eyebrow>{BRAND_LABEL}</Eyebrow>
        <h1 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,5.5vw,3.25rem)] font-semibold leading-[1.06] tracking-[-0.02em] text-ink">
          Sample Product
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body md:text-xl">
          <ConfirmPlaceholder>one paragraph on what the product does and who it is for</ConfirmPlaceholder>
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="#pricing"
            className="inline-flex h-12 items-center rounded-ui-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:brightness-[1.04]"
          >
            See plans
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center rounded-ui-lg border border-hairline-strong px-6 text-sm font-semibold text-ink transition hover:border-saffron-500/60"
          >
            Get in touch
          </Link>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-[1200px] scroll-mt-24 px-6 py-16">
        <h2 className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink">Pricing</h2>
        <p className="mt-3 max-w-2xl text-base text-muted">
          <ConfirmPlaceholder>plans and prices — never invent one; set real prices in Admin &gt; Products</ConfirmPlaceholder>
        </p>
      </section>

      <section className="bg-sand">
        <div className="mx-auto w-full max-w-[760px] px-6 py-16">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink">Questions</h2>
          <dl className="mt-8 flex flex-col gap-7">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt className="font-display text-lg font-semibold text-ink">{item.q}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-body">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}

/** Shown in place of the full page until `sample_product_live` is on. */
function ProductWaitlist() {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-6 pb-24 pt-24 md:pt-28">
      <Eyebrow>{BRAND_LABEL}</Eyebrow>
      <h1 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,5.5vw,3.25rem)] font-semibold leading-[1.06] tracking-[-0.02em] text-ink">
        Sample Product
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body md:text-xl">
        An upcoming product. Replace this line with a one-sentence description.
      </p>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-body opacity-80">
        It is not open yet.
      </p>
      <div className="mt-10">
        <WaitlistForm
          product="sample_product"
          label="Tell me when it opens"
          askNote="What would you use it for? (optional)"
          source="/sample-product"
        />
      </div>
    </section>
  );
}
