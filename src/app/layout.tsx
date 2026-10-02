import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import {
  Newsreader,
  Public_Sans,
  JetBrains_Mono,
  Noto_Sans_Devanagari,
} from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { siteConfig } from '@/config/site';
import { getCompany } from '@/lib/company';
import GA4 from '@/components/analytics/GA4';
import { getSocialLinks } from '@/lib/social-links';
import { getWhatsAppNumber } from '@/lib/whatsapp-number';

/* Type stack (fonts referenced by docs/brand/tokens.css):
   Newsreader 600 display + italic 400 tagline · Public Sans 400 body / 700
   logotype · JetBrains Mono 500 labels · Noto Sans Devanagari 600.

   All four are variable fonts on Google Fonts, so `weight` is omitted on
   purpose: that ships the full axis rather than pinning single cuts, which
   keeps every weight the spec names available (and doesn't break existing
   markup using font-semibold / font-bold).

   The CSS variable names are deliberately family-specific
   (--font-public-sans, not --font-body). next/font sets its variables on the
   <html> element, and an element-level custom property beats a :root one for
   everything inside it — so reusing the token names from tokens.css here
   would make globals.css's `--font-body: var(--font-public-sans)` bridge
   resolve to itself. Keeping the names distinct avoids that cycle. */
const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-public-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  display: 'swap',
  variable: '--font-noto-deva',
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [siteConfig.name],
  authors: [{ name: siteConfig.content.founder.name }],
  creator: siteConfig.name,
  metadataBase: new URL(siteConfig.url),
};

type RootLayoutProps = {
  children: ReactNode;
};

/**
 * Organization structured data. Built per-request (not a module constant) so
 * the social profile URLs and the WhatsApp number come from the DB
 * (public.social_links / public.app_config) rather than being frozen at build
 * time -- otherwise an admin edit at /admin/settings would update the footer
 * but leave Google seeing the old value, which is exactly the drift that left
 * a stale WhatsApp number in this schema.
 *
 * Legal identity (name, tax ids, address) comes from company_profile
 * (Admin > Settings > Company); empty fields are omitted, never invented.
 */
async function buildOrganizationJsonLd() {
  const [socialLinks, whatsappNumber, company] = await Promise.all([
    getSocialLinks(),
    getWhatsAppNumber(),
    getCompany(),
  ]);

  const sameAs = socialLinks
    .filter((link) => link.enabled && link.url)
    .map((link) => link.url);

  // Two DISTINCT contact points, deliberately not merged: the voice line and
  // the WhatsApp line are different numbers reaching different channels.
  // Collapsing them into one telephone field would misrepresent both.
  const contactPoint: Record<string, unknown>[] = [
    {
      '@type': 'ContactPoint',
      email: siteConfig.links.contact.email,
      telephone: siteConfig.links.contact.phone,
      contactType: 'customer service',
      availableLanguage: ['en', 'hi'],
      areaServed: 'IN',
    },
  ];

  if (whatsappNumber) {
    contactPoint.push({
      '@type': 'ContactPoint',
      telephone: `+${whatsappNumber}`,
      contactType: 'customer support',
      url: `https://wa.me/${whatsappNumber}`,
      availableLanguage: ['en', 'hi'],
      areaServed: 'IN',
      description: 'WhatsApp Business — chat support',
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.brand_name || siteConfig.name,
    legalName: company.legal_name,
    url: siteConfig.url,
    logo: `${siteConfig.url}${siteConfig.branding.logo.square}`,
    description: siteConfig.description,
    sameAs: sameAs.length > 0 ? sameAs : Object.values(siteConfig.links.social).filter(Boolean),
    ...(company.gstin ? { taxID: company.gstin, vatID: company.gstin } : {}),
    ...(company.cin
      ? { identifier: { '@type': 'PropertyValue', propertyID: 'CIN', value: company.cin } }
      : {}),
    address: {
      '@type': 'PostalAddress',
      ...(company.address_line1
        ? { streetAddress: [company.address_line1, company.address_line2].filter(Boolean).join(', ') }
        : {}),
      ...(company.city ? { addressLocality: company.city } : {}),
      ...(company.postal_code ? { postalCode: company.postal_code } : {}),
      addressCountry: company.country,
    },
    contactPoint,
  };
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const organizationJsonLd = await buildOrganizationJsonLd();

  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${publicSans.variable} ${jetbrainsMono.variable} ${notoDevanagari.variable}`}
      suppressHydrationWarning
    >
      {/* Light ground + body font from the theme tokens. Deep is opt-in per section. */}
      <body className="font-sans antialiased bg-paper text-body">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <GA4 />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
