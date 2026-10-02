/**
 * How a purchased product reaches its buyer.
 *
 * The answers are varied and will keep growing — a PDF blueprint, a prompt
 * library, a GitHub release, a desktop build, a redirect to Google Play or the
 * App Store, a private page, a booked call, a physical print. So a product
 * carries a KIND and a jsonb CONFIG whose shape the kind decides, rather than a
 * column per case that is null for every other product.
 *
 * Adding a way to deliver something is a new kind and a handler here. It is not
 * a schema migration.
 */

export const FULFILMENT_KINDS = [
  'none',
  'hosted_file',
  'r2_file',
  'external_url',
  'github_release',
  'private_page',
  'notion_page',
  'short_link',
  'physical',
  'service',
] as const;

export type FulfilmentKind = (typeof FULFILMENT_KINDS)[number];

export interface FulfilmentMeta {
  label: string;
  /** What the admin is choosing, in their words. */
  description: string;
  /** Config keys this kind requires, enforced by a CHECK in migration 035. */
  requires: string[];
  /** Whether the buyer gets something automatically, or we follow up by hand. */
  automatic: boolean;
}

export const FULFILMENT: Record<FulfilmentKind, FulfilmentMeta> = {
  none: {
    label: 'Manual follow-up',
    description: 'We contact the buyer ourselves. Nothing is delivered automatically.',
    requires: [],
    automatic: false,
  },
  hosted_file: {
    label: 'File we host',
    description:
      'A PDF, guide or prompt library stored with us and downloaded after purchase. Up to 25 MB per file — point at a GitHub release or a URL for anything larger.',
    requires: [],
    automatic: true,
  },
  r2_file: {
    label: 'File in our storage (R2)',
    description:
      'A download hosted in Cloudflare R2. Suits app builds and anything large. Buyers get a link that expires in minutes, so a forwarded one is dead before it is useful.',
    requires: ['key'],
    automatic: true,
  },
  external_url: {
    label: 'Link to somewhere else',
    description:
      'Google Play, the App Store, a Drive folder, a Notion page — anywhere the buyer should be sent.',
    requires: ['url'],
    automatic: true,
  },
  github_release: {
    label: 'GitHub release',
    description: 'A release asset. Suits an actual build, and keeps versioning where the code is.',
    requires: ['repo', 'tag'],
    automatic: true,
  },
  private_page: {
    label: 'Private page on this site',
    description: 'A page here that only buyers can open. Suits a guide or a living prompt library.',
    requires: ['path'],
    automatic: true,
  },
  notion_page: {
    label: 'Notion page, rendered here',
    description:
      'Written in Notion, pulled through the integration and rendered on this site behind the buyer\'s entitlement. The Notion page itself is never shared, so it never has to be public.',
    requires: ['notion_page_id'],
    automatic: true,
  },
  short_link: {
    label: 'Tracked short link',
    description:
      'Delivered through our own link shortener at /go/<slug>, so opens are counted against a campaign. NOT a gate — /go is public and unauthenticated by design, so use this only for material that may be shared.',
    requires: ['slug'],
    automatic: true,
  },
  physical: {
    label: 'Physical item',
    description: 'Shipped. The invoice is the record; fulfilment happens offline.',
    requires: [],
    automatic: false,
  },
  service: {
    label: 'Service or booking',
    description: 'An engagement or a call. There is nothing to download.',
    requires: [],
    automatic: false,
  },
};

export interface FulfilmentConfig {
  url?: string;
  repo?: string;
  tag?: string;
  asset?: string;
  path?: string;
  notion_page_id?: string;
  slug?: string;
  /** R2 object key, e.g. "sample-app/v1.2.0/setup.exe". */
  key?: string;
}

/**
 * Validates a config against its kind.
 *
 * Mirrors the CHECK constraint, so the admin gets a message against the field
 * rather than a database error. A buyer paying and then finding nothing to
 * download is the failure this prevents.
 */
export function validateFulfilment(
  kind: FulfilmentKind,
  config: FulfilmentConfig,
): string | null {
  const missing = FULFILMENT[kind].requires.filter((k) => {
    const v = config[k as keyof FulfilmentConfig];
    return !v || !String(v).trim();
  });
  if (missing.length) {
    return `${FULFILMENT[kind].label} needs ${missing.join(' and ')}.`;
  }
  if (kind === 'external_url' && config.url && !/^https?:\/\//i.test(config.url)) {
    return 'The link must start with http:// or https://.';
  }
  if (kind === 'private_page' && config.path && !config.path.startsWith('/')) {
    return 'The page path must start with a slash.';
  }
  return null;
}

/**
 * Kinds that do NOT restrict who can open the delivered thing.
 *
 * /go/<slug> is a public redirect (src/app/go/[slug]/route.ts, unauthenticated
 * by design) and an external URL is whatever the destination decides. Neither
 * knows who is opening it, so neither is a gate. Paid material that must not
 * circulate belongs behind hosted_file, private_page or notion_page, all of
 * which check the buyer's entitlement before serving anything.
 */
export const UNGATED_KINDS: readonly FulfilmentKind[] = ['short_link', 'external_url'];

export const isGated = (kind: FulfilmentKind): boolean => !UNGATED_KINDS.includes(kind);

/** Where to send a buyer who has paid. Null means there is nothing automatic. */
export function deliveryTarget(
  kind: FulfilmentKind,
  config: FulfilmentConfig,
  orderId: string,
): string | null {
  switch (kind) {
    case 'external_url':
      return config.url ?? null;
    case 'private_page':
      return config.path ?? null;
    case 'short_link':
      // The redirect route is /go/<slug>, not /l/.
      return config.slug ? `/go/${config.slug}` : null;
    case 'notion_page':
    case 'hosted_file':
    case 'r2_file':
    case 'github_release':
      // Resolved by a route that checks entitlement first, so a paid asset is
      // never a guessable URL.
      return `/account/orders/${orderId}/download`;
    default:
      return null;
  }
}
