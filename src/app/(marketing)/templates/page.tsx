import type { Metadata } from 'next';
import { siteConfig } from "@/config/site";
import CTASection from "@/components/site/CTASection";
import Eyebrow from "@/components/site/Eyebrow";
import Link from "next/link";
import { getSectionContent } from "@/lib/getContent";
import { HeadingContent, TextContent, TemplateGridContent } from "@/lib/content-schema";

// The product catalogue. Prices are rendered here too.
export const revalidate = 60;

// Without this the page inherits the layout default, and the title template
// applies twice — rendering the literal 'YourSite | YourSite' alongside
// the homepage's description. Google then sees a duplicate of the homepage.
export const metadata: Metadata = {
  title: 'Templates',
  description:
    'Production-ready templates and tools you can buy, download and run yourself — no subscription, no vendor lock-in.',
};

// --- Default (Fallback) Content ---
const fallbackHeaderTitle: HeadingContent = {
  text: "Engineering ",
  highlight: "templates."
};
const fallbackHeaderSubtitle: TextContent = {
  text: "Starters, templates and resources you can put to work straight away."
};
const fallbackGridItems: TemplateGridContent = {
  items: siteConfig.templates as any
};

export default async function TemplatesPage() {
  const headerTitle = await getSectionContent('template-header-title', fallbackHeaderTitle);
  const headerSubtitle = await getSectionContent('template-header-subtitle', fallbackHeaderSubtitle);
  const gridItems = await getSectionContent('template-grid-items', fallbackGridItems);

  return (
    <div>
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-16 text-center md:pt-20">
        <Eyebrow dot={false} className="justify-center">Blueprints</Eyebrow>
        <h1 className="mx-auto mt-4 max-w-3xl text-[clamp(2.5rem,5.5vw,3.25rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
          {headerTitle.text}
          <span className="text-saffron-ink">{headerTitle.highlight}</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-body md:text-xl">{headerSubtitle.text}</p>
      </section>

      <section className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-6 px-6 pb-20 md:grid-cols-2 lg:grid-cols-3 md:pb-24">
        {gridItems.items.map((item: any) => {
          const isFree = item.tier === 'free';
          return (
            <div key={item.id} className="vb-card vb-card-interactive vb-card-accent relative flex flex-col overflow-hidden p-8 pt-9">
              <div className="mb-6 flex items-start justify-between">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] ${
                    isFree
                      ? 'border-green-700/25 bg-green-700/10 text-green-ink'
                      : 'border-saffron-500/30 bg-saffron-500/10 text-saffron-ink'
                  }`}
                >
                  {item.category}
                </span>
                {item.tier === 'premium' && (
                  <span className="text-xl font-bold text-ink">{item.price}</span>
                )}
              </div>

              <div className="flex-1 space-y-2.5">
                <h3 className="text-2xl font-bold text-ink">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{item.description}</p>
              </div>

              <div className="mt-8 border-t border-hairline pt-6">
                <Link
                  href={item.link}
                  className={`flex w-full items-center justify-center rounded-card py-3 text-sm font-bold transition-all duration-200 ease-out ${
                    isFree
                      ? 'border border-hairline-strong bg-surface text-ink hover:-translate-y-0.5 hover:border-saffron-500/50'
                      : 'bg-saffron-500 text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] hover:-translate-y-0.5 hover:brightness-[1.04]'
                  }`}
                >
                  {isFree ? 'Get on GitHub' : 'Purchase Blueprint'}
                  {isFree && (
                    <svg className="ml-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
                  )}
                </Link>
              </div>
            </div>
          );
        })}
      </section>

      <CTASection />
    </div>
  );
}
