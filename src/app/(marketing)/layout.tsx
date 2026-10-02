import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import SiteHeaderClient from '@/components/site/SiteHeaderClient';
import WhatsAppFab from '@/components/site/WhatsAppFab';
import ProfileGate from '@/components/site/ProfileGate';
import { siteConfig } from '@/config/site';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { getNav } from '@/lib/nav';
import { getSocialLinks, type SocialLink } from '@/lib/social-links';
import { getWhatsAppNumber } from '@/lib/whatsapp-number';
import BrandLogo from '@/components/brand/BrandLogo';
import { BRAND_TAGLINE } from '@/lib/brand';
import { getCompany, formatAddress, type CompanyProfile } from '@/lib/company';

type SiteLayoutProps = {
  children: ReactNode;
};

// Icon SVGs stay a static per-platform map -- only URL/enabled state is
// DB-driven (public.social_links, migration 025). Keys match the seeded
// `platform` values exactly.
const SOCIAL_ICON_MAP: Record<string, { label: string; path: string }> = {
  linkedin: {
    label: 'LinkedIn',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  youtube: {
    label: 'YouTube',
    path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
  x: {
    label: 'X',
    path: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  },
  instagram: {
    label: 'Instagram',
    path: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
  },
  facebook: {
    label: 'Facebook',
    path: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  },
  telegram: {
    label: 'Telegram',
    path: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  },
};

// WAS `dynamic = 'force-dynamic'`, to make the admin whatsapp_live flag
// (public.feature_flags, /admin/settings) take effect the instant it is
// toggled "with no separate on-demand-revalidation step to reason about or get
// wrong".
//
// It worked, and the price was the entire site's crawlability. force-dynamic
// makes Next emit `cache-control: private, no-cache, no-store` on every page
// under this layout, which forbids Cloudflare from caching any of them --
// `cf-cache-status: DYNAMIC` on all 16 public URLs. So every request, Googlebot
// included, ran a full database-backed render against the origin at 600-900ms.
// Search Console's verdict for nine of those URLs was "Discovered - currently
// not indexed", last crawled N/A, with Google's own explanation: it wanted to
// crawl but "this was expected to overload the site".
//
// Five minutes is short enough that nobody notices stale marketing copy and
// long enough that a crawler sweeping 22 URLs hits cache for all but the first.
// The instant-toggle property is kept, not traded away: the flag write calls
// revalidateFor({ kind: 'feature_flag' }), which invalidates this whole subtree
// on demand. Immediate where it has to be, cached the other 99.99% of the time.
// This is a CEILING, not a default. Next takes the LOWEST revalidate across
// the matched segments, so a page can never be cached for longer than its
// layout allows -- setting 300 here silently capped /privacy at 5 minutes when
// it asked for a day. Every page below declares its own, faster, value.
export const revalidate = 86400;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  // Icons are NOT declared here. src/app/ holds favicon.ico, icon.svg,
  // apple-icon.png and opengraph-image.png, which the App Router picks up by
  // file convention and fingerprints for cache-busting. Declaring them again
  // in metadata would emit a second, unfingerprinted set of tags pointing at
  // the deleted brand-kit paths.
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
  },
};

function Footer({
  whatsappLive,
  sampleProductLive,
  socialLinks,
  whatsappNumber,
  company,
}: {
  company: CompanyProfile;
  whatsappLive: boolean;
  sampleProductLive: boolean;
  socialLinks: SocialLink[];
  whatsappNumber: string;
}) {
  const waHref = () => (whatsappNumber ? `https://wa.me/${whatsappNumber}` : '#');
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-top">
          <div>
            {/* Primary lockup on the deep footer ground. */}
            <BrandLogo
              lockup="primary"
              on="deep"
              className="h-auto w-[240px] max-w-full"
            />
            {/* The tagline as real text: selectable, searchable, screen-reader friendly. */}
            <p className="mt-3 font-display text-[17px] italic leading-snug text-[var(--vb-mist-300)]">
              {BRAND_TAGLINE}
            </p>
            <p className="blurb">
              {siteConfig.description}
            </p>
            <div className="kuta">{siteConfig.links.contact.locationLabel}</div>
          </div>

          <div className="fcol">
            <h4>Products</h4>
            <ul>
              {/* /templates is the product catalogue — keep it linked so it is crawled. */}
              <li><Link href="/templates">Templates &amp; tools</Link></li>
              {sampleProductLive && (
                <>
                  <li><Link href="/sample-product">Sample Product</Link></li>
                  <li><Link href="/sample-product#pricing">Pricing</Link></li>
                </>
              )}
            </ul>
          </div>

          <div className="fcol">
            <h4>Services</h4>
            <ul>
              <li><Link href="/services">All services</Link></li>
              <li><Link href="/services#blueprint">The blueprint</Link></li>
              <li><Link href="/services#consulting">Consulting</Link></li>
            </ul>
          </div>

          <div className="fcol">
            <h4>Company</h4>
            <ul>
              <li><Link href="/about">About</Link></li>
              <li><Link href="/blog">Blog</Link></li>
              <li><Link href="/careers">Careers</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>

          <div className="fcol">
            <h4>Connect</h4>
            <ul>
              {whatsappLive && (
                <li>
                  <a href={waHref()} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp (opens in a new tab)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.005zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" /></svg>
                    WhatsApp
                  </a>
                </li>
              )}
              <li>
                <Link href="/contact">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>
                  Support
                </Link>
              </li>
              {socialLinks
                .filter((link) => link.enabled)
                .map((link) => {
                  const meta = SOCIAL_ICON_MAP[link.platform];
                  if (!meta) return null;
                  return (
                    <li key={link.platform}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${meta.label} (opens in a new tab)`}>
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d={meta.path} /></svg>
                        {meta.label}
                      </a>
                    </li>
                  );
                })}
            </ul>
          </div>
        </div>

        {/* Contact block. Identity comes from company_profile (Admin > Settings > Company). */}
        <div className="foot-bot">
          <span>© {year} {siteConfig.name}</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {siteConfig.content.founder.name} · {siteConfig.content.founder.title}
          </span>
        </div>
        <div className="foot-bot" style={{ marginTop: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {/* tel: and mailto: rather than plain text -- on a phone these
                are the only tappable way to reach us from the footer. */}
            <a href={`tel:${siteConfig.links.contact.phone.replace(/[^\d+]/g, '')}`} className="hover:underline">
              {siteConfig.links.contact.phone}
            </a>
            {' · '}
            <a href={`mailto:${siteConfig.links.contact.email}`} className="hover:underline">
              {siteConfig.links.contact.email}
            </a>
            {` · ${new URL(siteConfig.url).hostname.replace(/^www\./, '')} · ${siteConfig.links.contact.locationLabel}`}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: '0.8rem', opacity: 0.85, flexWrap: 'wrap' }}>
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
          <Link href="/refund-policy" className="hover:underline">Refund Policy</Link>
          <Link href="/data-deletion" className="hover:underline">Data Deletion</Link>
        </div>

        <div className="foot-legal" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', opacity: 0.7 }}>
          <div>{company.legal_name}</div>
          {(company.gstin || company.cin) && (
            <div>
              {[company.gstin && `GSTIN: ${company.gstin}`, company.cin && `CIN: ${company.cin}`].filter(Boolean).join(' · ')}
            </div>
          )}
          <div>{formatAddress(company)}</div>
        </div>
      </div>
    </footer>
  );
}

export default async function SiteLayout({ children }: SiteLayoutProps) {
  const whatsappLive = await isFeatureEnabled('whatsapp_live');
  // The upcoming-product flag hides every entry point to its page until it is
  // ready, rather than selling something nobody can buy yet.
  const sampleProductLive = await isFeatureEnabled('sample_product_live');
  const socialLinks = await getSocialLinks();
  const whatsappNumber = await getWhatsAppNumber();
  const company = await getCompany();

  // Header menu from the database (/admin/nav). An item tied to a feature flag
  // is dropped while that flag is off.
  const allNav = await getNav();
  const flagKeys = Array.from(new Set(allNav.map((n) => n.flag).filter((f): f is string => Boolean(f))));
  const flagStates = new Map(await Promise.all(flagKeys.map(async (k) => [k, await isFeatureEnabled(k)] as const)));
  const nav = allNav.filter((n) => !n.flag || flagStates.get(n.flag));

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
      </div>

      <SiteHeaderClient nav={nav} />

      <main>{children}</main>

      <Footer company={company} whatsappLive={whatsappLive} sampleProductLive={sampleProductLive} socialLinks={socialLinks} whatsappNumber={whatsappNumber} />

      <div className="fabs">
        <WhatsAppFab />
        <ProfileGate />
      </div>
    </>
  );
}
