import Link from 'next/link';
import Eyebrow from '@/components/site/Eyebrow';
import { getSectionContent } from '@/lib/getContent';

type CTASectionProps = {
  title?: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export default async function CTASection({
  title: propTitle,
  description: propDescription,
  primaryHref: propPrimaryHref,
  primaryLabel: propPrimaryLabel,
  secondaryHref: propSecondaryHref,
  secondaryLabel: propSecondaryLabel,
}: CTASectionProps) {
  const globalConfig = await getSectionContent('cta-global-config', {
    title: "Stop running AI pilots. Start shipping production agents.",
    description: "We help enterprises and founders who need architecture thinking, not just prompt engineering.",
    primaryLabel: "Book a Consultation",
    primaryHref: "/contact",
    secondaryLabel: "Explore Services",
    secondaryHref: "/services"
  });

  const title = propTitle ?? globalConfig.title;
  const description = propDescription ?? globalConfig.description;
  const primaryHref = propPrimaryHref ?? globalConfig.primaryHref ?? "/contact";
  const primaryLabel = propPrimaryLabel ?? globalConfig.primaryLabel ?? "Book a Consultation";
  const secondaryHref = propSecondaryHref ?? globalConfig.secondaryHref ?? "/services";
  const secondaryLabel = propSecondaryLabel ?? globalConfig.secondaryLabel ?? "Explore Services";

  return (
    <section className="border-t border-hairline bg-sand">
      <div className="mx-auto w-full max-w-[1200px] px-6 py-20 text-center md:py-24">
        <Eyebrow dot={false} className="justify-center">Let&apos;s build</Eyebrow>
        <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-[-0.03em] text-ink md:text-[40px]">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted md:text-lg">{description}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3.5">
          <Link
            href={primaryHref}
            className="inline-flex items-center justify-center rounded-card bg-saffron-500 px-7 py-3.5 text-[15px] font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-[1.04]"
          >
            {primaryLabel}
          </Link>
          <Link
            href={secondaryHref}
            className="inline-flex items-center justify-center rounded-card border border-hairline-strong bg-surface px-7 py-3.5 text-[15px] font-bold text-ink transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-saffron-500/50"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
