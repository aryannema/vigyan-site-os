import type { Metadata } from 'next';
import CTASection from '@/components/site/CTASection';
import Eyebrow from '@/components/site/Eyebrow';
import { siteConfig } from '@/config/site';
import { getSectionContent } from '@/lib/getContent';
import {
  HeadingContent,
  TextContent,
  ListContent,
  DomainsContent,
  MethodsContent,
} from '@/lib/content-schema';

// Marketing copy. Edited occasionally, never urgently.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About Us',
  description: `${siteConfig.name} — who we are, how we work, and the people behind it.`,
  alternates: { canonical: '/about' },
};

// --- Default (Fallback) Content ---
// Shown until the about-* page sections are filled in admin or via the site MCP.
const fallbackHeaderHeading: HeadingContent = {
  text: "A headline about who you are, ending in ",
  highlight: "a highlighted phrase."
};
const fallbackHeaderDescription: TextContent = {
  text: `${siteConfig.name} is a placeholder company. Replace this paragraph with two or three sentences about the business.`
};
const fallbackHeaderFounder: any = {
  initials: "FN",
  name: siteConfig.content.founder.name,
  role: siteConfig.content.founder.title,
  link: siteConfig.links.social.linkedin
};

const fallbackPedigreeTitle: TextContent = {
  text: "A sentence on the experience behind the business."
};
const fallbackPedigreeDescription: TextContent = {
  text: "A short paragraph on the background of the team, written as fact rather than claim."
};
const fallbackPedigreeCompaniesLabel: TextContent = {
  text: "Previously at:"
};
const fallbackPedigreeCompanies: ListContent = {
  items: ["Company A", "Company B", "Company C"]
};
const fallbackPedigreeDomainsLabel: TextContent = {
  text: "Industries we have worked in:"
};
const fallbackPedigreeDomains: DomainsContent = {
  items: [
    { category: "Industry one", clients: "Example detail" },
    { category: "Industry two", clients: "Example detail" },
    { category: "Industry three", clients: "Example detail" },
    { category: "Industry four", clients: "Example detail" }
  ]
};

const fallbackMethodologies: MethodsContent = {
  items: [
    {
      title: "How we work",
      description: "A paragraph on your method — what a client can expect at each step.",
      iconType: "governance"
    },
    {
      title: "What we build on",
      description: "A paragraph on the platform, tools or standards behind your work.",
      iconType: "vvc"
    }
  ]
};

export default async function AboutPage() {
  const headerHeading = await getSectionContent('about-header-heading', fallbackHeaderHeading);
  const headerDescription = await getSectionContent('about-header-description', fallbackHeaderDescription);
  const headerFounder = await getSectionContent('about-header-founder', fallbackHeaderFounder);

  const pedigreeTitle = await getSectionContent('about-pedigree-title', fallbackPedigreeTitle);
  const pedigreeDescription = await getSectionContent('about-pedigree-description', fallbackPedigreeDescription);
  const pedigreeCompaniesLabel = await getSectionContent('about-pedigree-companies-label', fallbackPedigreeCompaniesLabel);
  const pedigreeCompanies = await getSectionContent('about-pedigree-companies', fallbackPedigreeCompanies);
  const pedigreeDomainsLabel = await getSectionContent('about-pedigree-domains-label', fallbackPedigreeDomainsLabel);
  const pedigreeDomains = await getSectionContent('about-pedigree-domains', fallbackPedigreeDomains);

  const methodologies = await getSectionContent('about-methodologies-items', fallbackMethodologies);

  return (
    <div>
      {/* 1. Studio header */}
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-16 md:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow dot={false} className="justify-center">About us</Eyebrow>
          <h1 className="mt-4 text-[clamp(2.5rem,5.5vw,3.25rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink">
            {headerHeading.text}
            <span className="text-saffron-ink">{headerHeading.highlight}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-body md:text-[19px]">
            {headerDescription.text}
          </p>
          <div className="mt-8 flex justify-center">
            <a
              href={headerFounder.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${headerFounder.name}, ${headerFounder.role} (opens in a new tab)`}
              className="inline-flex items-center gap-3 rounded-full border border-hairline bg-surface py-2.5 pl-3 pr-5 shadow-warm-sm transition-colors hover:border-saffron-500/50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron-500/18 text-xs font-extrabold text-saffron-ink">
                {headerFounder.initials}
              </span>
              <span className="text-left">
                <span className="block text-sm font-bold leading-none text-ink">{headerFounder.name}</span>
                <span className="mt-0.5 block text-[11px] uppercase tracking-[0.08em] text-muted">{headerFounder.role}</span>
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* 2. Pedigree */}
      <section className="mx-auto w-full max-w-[1200px] px-6 pb-12">
        <div className="vb-card p-8 md:p-12">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <h2 className="text-2xl font-bold leading-snug text-ink md:text-[28px]">{pedigreeTitle.text}</h2>
              <p className="mt-4 text-base leading-relaxed text-muted">{pedigreeDescription.text}</p>
              <p className="mt-6 border-t border-hairline pt-5 text-[11px] font-bold uppercase tracking-wider text-faint">{pedigreeCompaniesLabel.text}</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-wider text-saffron-ink">
                {pedigreeCompanies.items.map((company: string, index: number) => (
                  <span key={index}>{company}</span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 rounded-card bg-sand p-7 sm:grid-cols-2">
              <p className="col-span-full text-[11px] font-medium leading-relaxed text-faint">{pedigreeDomainsLabel.text}</p>
              {pedigreeDomains.items.map((domain: any, index: number) => (
                <div key={index}>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-green-ink">{domain.category}</p>
                  <p className="mt-1 text-[13px] text-muted">{domain.clients}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Methodologies */}
      <section className="mx-auto grid w-full max-w-[1200px] gap-6 px-6 pb-20 md:grid-cols-2 md:pb-24">
        {methodologies.items.map((method: any, index: number) => {
          const isGovernance = method.iconType === 'governance';
          return (
            <div
              key={index}
              className={`vb-card p-9 md:p-10 ${isGovernance ? 'shadow-glow-saffron' : 'shadow-glow-green'}`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-md ${
                  isGovernance ? 'bg-saffron-500/15 text-saffron-ink' : 'bg-green-700/12 text-green-ink'
                }`}
                aria-hidden="true"
              >
                {isGovernance ? (
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                )}
              </span>
              <h3 className="mt-5 text-xl font-bold text-ink md:text-2xl">{method.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted md:text-base">{method.description}</p>
            </div>
          );
        })}
      </section>

      <CTASection />
    </div>
  );
}
