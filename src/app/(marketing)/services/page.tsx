import type { Metadata } from 'next';
import Link from 'next/link';
import CTASection from '@/components/site/CTASection';
import Eyebrow from '@/components/site/Eyebrow';
import { siteConfig } from '@/config/site';
import { getSectionContent } from '@/lib/getContent';
import {
  TextContent,
  ListContent,
} from '@/lib/content-schema';

// Marketing copy. Edited occasionally, never urgently.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Services',
  description: `What ${siteConfig.name} offers — replace with a one-line summary of your services.`,
  alternates: { canonical: '/services' },
};

// --- Default (Fallback) Content ---
// Shown until the services-* page sections are filled in admin or via the site MCP.
const fallbackHeaderTitle: TextContent = { text: "What we do" };
const fallbackHeaderDescription: TextContent = {
  text: "One or two sentences on the services you offer and who they are for."
};
const fallbackExpertiseItems: ListContent = { items: [...siteConfig.content.coreOffers] };

const fallbackEnterprise: any = {
  title: "For larger teams",
  points: ["A benefit for larger customers", "Another benefit", "A third benefit"]
};

const fallbackFounders: any = {
  title: "For small businesses",
  points: ["A benefit for smaller customers", "Another benefit", "A third benefit"]
};

/**
 * The service portfolio. Each entry: the outcome in one line, what is
 * delivered, and an id that doubles as the page anchor and the ?service=
 * value the contact form pre-selects. Every CTA is "Request a quote" until a
 * service has a real price in public.products.
 */
const SERVICE_CATEGORIES = [
  {
    id: 'consulting',
    title: 'Consulting',
    blurb: 'Advice and planning before anything is built.',
    items: [
      'A discovery session to understand the problem',
      'A written plan with costs and risks named',
      'Yours to keep, whoever builds it',
    ],
  },
  {
    id: 'implementation',
    title: 'Implementation',
    blurb: 'We build and launch it for you.',
    items: [
      'Fixed milestones with a demo at each one',
      'Testing and launch included',
      'Handover documentation',
    ],
  },
  {
    id: 'support',
    title: 'Ongoing support',
    blurb: 'Keep it running after launch.',
    items: [
      'Monitoring and fixes',
      'Monthly improvements',
      'A named contact',
    ],
  },
  {
    id: 'blueprint',
    title: 'The blueprint',
    blurb: 'A sample one-off deliverable — replace with your own.',
    items: [
      'A written plan for your project',
      'The order to build it in, with the risks named',
      'Yours to keep',
    ],
  },
];

export default async function ServicesPage() {
  const headerTitle = await getSectionContent('services-header-title', fallbackHeaderTitle);
  const headerDescription = await getSectionContent('services-header-description', fallbackHeaderDescription);
  const expertiseItems = await getSectionContent('services-expertise-items', fallbackExpertiseItems);
  const segmentEnterprise = await getSectionContent('services-segments-enterprise', fallbackEnterprise);
  const segmentFounders = await getSectionContent('services-segments-founders', fallbackFounders);

  const segments = [segmentEnterprise, segmentFounders];

  return (
    <div>
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-16 md:pt-20">
        <Eyebrow>Our Expertise</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-[clamp(2.5rem,5.5vw,3rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
          {headerTitle.text}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body md:text-xl">
          {headerDescription.text}
        </p>

        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {expertiseItems.items.map((offer: string) => (
            <div key={offer} className="flex items-center gap-3 rounded-md border border-hairline bg-surface px-5 py-4">
              <span className="h-2 w-2 shrink-0 rounded-full bg-green-700" aria-hidden="true" />
              <span className="text-[15px] font-semibold text-body">{offer}</span>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-10">
          {SERVICE_CATEGORIES.map((cat) => (
            <div key={cat.id} id={cat.id} className="vb-card scroll-mt-24 p-8 md:p-10">
              <h2 className="text-2xl font-bold text-ink">{cat.title}</h2>
              <p className="mt-2 text-base text-muted">{cat.blurb}</p>
              <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {cat.items.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[15px] text-body">
                    <span className="text-saffron-500" aria-hidden="true">—</span>
                    {item}
                  </li>
                ))}
              </ul>
              {/* "Request a quote", not "Buy": none of these has a fixed price
                  yet, so there is nothing for Razorpay checkout to charge.
                  An entry switches to Buy only once a real price exists. */}
              <Link
                href={`/contact?service=${cat.id}`}
                className="mt-6 inline-flex h-11 items-center rounded-ui-lg border border-hairline-strong px-5 text-sm font-semibold text-ink transition hover:border-saffron-500/60 hover:text-saffron-ink"
              >
                Request a quote
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {segments.map((s: any) => (
            <div key={s.title} className="vb-card p-9">
              <h2 className="text-2xl font-bold text-ink">{s.title}</h2>
              <ul className="mt-5 flex flex-col gap-3">
                {s.points.map((point: string, i: number) => (
                  <li key={i} className="flex gap-2.5 text-[15px] text-body">
                    <span className="text-saffron-500" aria-hidden="true">—</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Blueprint promo band */}
        <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-feature border border-hairline bg-sand p-9 md:flex-row md:items-center">
          <div>
            <span className="inline-flex items-center rounded-full border border-saffron-500/30 bg-saffron-500/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-saffron-ink">
              Blueprint
            </span>
            <h3 className="mt-3 text-[22px] font-bold text-ink">Starter Kit</h3>
            <p className="mt-1 text-[15px] text-muted">A sample product promotion — replace with your own.</p>
          </div>
          <a
            href="/contact"
            className="inline-flex shrink-0 items-center justify-center rounded-card bg-saffron-500 px-6 py-3 text-sm font-bold text-primary-foreground shadow-warm-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-[1.04]"
          >
            Get the blueprint
          </a>
        </div>
      </section>

      <CTASection />
    </div>
  );
}
