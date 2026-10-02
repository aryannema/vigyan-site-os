/**
 * Structured data (schema.org JSON-LD), keyed by content type.
 *
 * WHY A REGISTRY. Blog posts, products and job openings each grew their own
 * hand-written JSON-LD, and blog posts ended up with none at all -- the pages
 * most likely to answer a search query directly were the ones declaring
 * nothing. Written per page, a new content type means remembering to add it,
 * and "remembering" is why the gap existed.
 *
 * So a content type maps to a builder here, exactly as a product's delivery
 * method maps to a handler in lib/fulfilment.ts. Adding `blueprint` or
 * `service` or anything future is ONE ENTRY plus a type in the union -- not a
 * migration, and not an edit to the page that renders it.
 *
 * WHAT THIS IS FOR. JSON-LD is how a crawler learns what a page IS rather than
 * guessing from the markup. Without it Google infers that a URL is an article
 * and guesses the date; with it, the page is eligible for rich results and the
 * date shown is the one we stated.
 *
 * HONESTY RULE, and it is not optional. Every field here must be something the
 * database actually knows. Claiming a `dateModified` we do not track, or an
 * `aggregateRating` from no reviews, is structured-data spam -- Google
 * penalises it, and it is a lie told at scale. Where a value is unknown the
 * field is OMITTED, never invented.
 */

import { siteConfig } from '@/config/site';

/** Add a type here and the compiler forces you to add its builder below. */
export type StructuredKind =
  | 'blog_post'
  | 'product'
  | 'job'
  | 'service'
  | 'blueprint'
  | 'faq';

/** Strip undefined so the emitted JSON has no null-ish fields. A field we do
 *  not know must be absent, not present-and-empty. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

const abs = (path: string) => `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;

/** Reused by every type: who published this. */
const PUBLISHER = {
  '@type': 'Organization',
  name: siteConfig.name,
  url: siteConfig.url,
  logo: { '@type': 'ImageObject', url: `${siteConfig.url}/icon.svg` },
} as const;

/** What a page hands in. Deliberately loose: each builder reads what it needs,
 *  so a new content type does not force a shared shape on everything else. */
export type StructuredEntity = {
  path: string;
  title: string;
  description?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  category?: string | null;
  /** Products: amount in the smallest unit (paise), as the DB stores it. */
  priceMinor?: number | null;
  currency?: string | null;
  availability?: 'InStock' | 'PreOrder' | 'OutOfStock' | null;
  priceValidUntil?: string | null;
  /** Jobs */
  employmentType?: string | null;
  location?: string | null;
  validThrough?: string | null;
  /** FAQ: only real questions the page actually answers. */
  faq?: { q: string; a: string }[] | null;
};

const BUILDERS: Record<StructuredKind, (e: StructuredEntity) => Record<string, unknown>> = {
  blog_post: (e) =>
    compact({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: e.title,
      description: e.description ?? undefined,
      mainEntityOfPage: { '@type': 'WebPage', '@id': abs(e.path) },
      url: abs(e.path),
      datePublished: e.publishedAt ?? undefined,
      // Omitted unless the row genuinely carries one. posts has no updated_at,
      // so for now this is always absent -- which is the correct answer, not a
      // gap to paper over with the publish date.
      dateModified: e.updatedAt ?? undefined,
      articleSection: e.category ?? undefined,
      author: { '@type': 'Organization', name: siteConfig.name, url: siteConfig.url },
      publisher: PUBLISHER,
      inLanguage: 'en-IN',
    }),

  product: (e) =>
    compact({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: e.title,
      description: e.description ?? undefined,
      url: abs(e.path),
      category: e.category ?? undefined,
      brand: { '@type': 'Brand', name: siteConfig.name },
      offers:
        e.priceMinor === undefined || e.priceMinor === null
          ? undefined
          : compact({
              '@type': 'Offer',
              url: abs(e.path),
              // schema.org wants a major-unit decimal; the DB stores minor units.
              price: (e.priceMinor / 100).toFixed(2),
              priceCurrency: e.currency ?? 'INR',
              availability: `https://schema.org/${e.availability ?? 'InStock'}`,
              // Only when an offer genuinely ends. An invented date here makes
              // Google distrust the whole block once it passes.
              priceValidUntil: e.priceValidUntil ?? undefined,
              seller: { '@type': 'Organization', name: siteConfig.name },
            }),
    }),

  job: (e) =>
    compact({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: e.title,
      description: e.description ?? undefined,
      datePosted: e.publishedAt ?? undefined,
      validThrough: e.validThrough ?? undefined,
      employmentType: e.employmentType ?? undefined,
      hiringOrganization: PUBLISHER,
      jobLocation: e.location
        ? { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: e.location } }
        : undefined,
      url: abs(e.path),
    }),

  // A service is not a Product: it has no price, no stock and no offer. Marking
  // one up as a Product to chase rich results is exactly the misuse Google
  // penalises.
  service: (e) =>
    compact({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: e.title,
      description: e.description ?? undefined,
      serviceType: e.category ?? undefined,
      provider: PUBLISHER,
      areaServed: { '@type': 'Country', name: 'India' },
      url: abs(e.path),
    }),

  // A blueprint is a downloadable document, so CreativeWork rather than
  // Article: it is a thing you obtain, not a thing you read in place.
  blueprint: (e) =>
    compact({
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: e.title,
      description: e.description ?? undefined,
      datePublished: e.publishedAt ?? undefined,
      author: PUBLISHER,
      publisher: PUBLISHER,
      url: abs(e.path),
      inLanguage: 'en-IN',
    }),

  // ONLY for questions the page visibly answers. FAQ markup on questions a
  // reader cannot see on the page is a manual-action risk, not a shortcut.
  faq: (e) =>
    compact({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: (e.faq ?? []).map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    }),
};

/**
 * Build the JSON-LD object for a piece of content.
 *
 * Returns null when there is nothing honest to say — an FAQ block with no
 * questions, for instance. Emitting an empty shell is worse than emitting
 * nothing: it asserts a page type while providing no evidence for it.
 */
export function structuredData(
  kind: StructuredKind,
  entity: StructuredEntity,
): Record<string, unknown> | null {
  const built = BUILDERS[kind](entity);
  if (kind === 'faq' && (!entity.faq || entity.faq.length === 0)) return null;
  return built;
}

/**
 * The string to put in a <script type="application/ld+json">.
 *
 * `<` is escaped because a value containing `</script>` would otherwise close
 * the tag early and turn content into markup. JSON.stringify does not do this
 * for you, and the values here come from the database, which admins edit.
 */
export function structuredDataScript(
  kind: StructuredKind,
  entity: StructuredEntity,
): string | null {
  const data = structuredData(kind, entity);
  if (!data) return null;
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
