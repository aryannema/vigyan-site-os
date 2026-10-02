import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import { siteConfig } from '@/config/site';
import { blockArraySchema, isSafeUrl, safeParseBlocks, type Block } from '@/lib/content/blocks';

export const LANDING_STATUSES = ['draft', 'published', 'archived'] as const;
export type LandingStatus = (typeof LANDING_STATUSES)[number];

export const landingPagePath = (slug: string) => `/services/${slug}`;
export const landingPageUrl = (slug: string) => `${siteConfig.url}${landingPagePath(slug)}`;

/** Slugs the /services/[slug] route must never shadow. */
export const RESERVED_SLUGS = ['new', 'preview', 'api', 'admin'];

export type LandingProduct = {
  id: string;
  slug: string;
  title: string;
  price_paise: number;
  status: string;
  discount_bp: number | null;
  offer_ends_at: string | null;
  offer_label: string | null;
  cta_label: string | null;
  cta_subtext: string | null;
  is_lead_magnet: boolean | null;
  product_type: string | null;
};

export type LandingPage = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  body_blocks: Block[];
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  product_id: string | null;
  cta_label: string | null;
  cta_url: string | null;
  status: LandingStatus;
  published_at: string | null;
  updated_at: string;
  product: LandingProduct | null;
};

const PAGE_COLUMNS =
  'id, slug, title, subtitle, body_blocks, seo_title, seo_description, og_image_url, product_id, ' +
  'cta_label, cta_url, status, published_at, updated_at';
const PRODUCT_COLUMNS =
  'id, slug, title, price_paise, status, discount_bp, offer_ends_at, offer_label, cta_label, cta_subtext, ' +
  'is_lead_magnet, product_type';

/** Public read: a page is visible only while published; preview also shows drafts. */
export async function getLandingPage(slug: string, preview = false): Promise<LandingPage | null> {
  const q = supabaseAdmin.from('landing_pages').select(PAGE_COLUMNS).eq('slug', slug);
  const { data } = await (preview ? q : q.eq('status', 'published')).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Omit<LandingPage, 'body_blocks' | 'product'> & { body_blocks: unknown };

  const parsed = safeParseBlocks(row.body_blocks);
  let product: LandingProduct | null = null;
  if (row.product_id) {
    const { data: p } = await supabaseAdmin
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('id', row.product_id)
      .eq('status', 'active')
      .maybeSingle();
    product = (p as LandingProduct | null) ?? null;
  }
  return { ...row, body_blocks: parsed.ok ? parsed.blocks : [], product };
}

export async function listPublishedLandingSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('landing_pages')
    .select('slug, updated_at')
    .eq('status', 'published');
  if (error) {
    console.error('[landing-pages] list failed:', error.message);
    return [];
  }
  return (data ?? []) as { slug: string; updated_at: string }[];
}

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

export const landingPageInputSchema = z.object({
  title: z.string().trim().min(3, 'Give the page a headline of at least 3 characters.').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.')
    .max(80)
    .refine((s) => !RESERVED_SLUGS.includes(s), 'That URL is reserved.'),
  subtitle: optionalText(240),
  body_blocks: blockArraySchema,
  seo_title: optionalText(70),
  seo_description: optionalText(170),
  og_image_url: optionalText(500).refine((v) => v === null || isSafeUrl(v), 'Use an https:// image address.'),
  product_id: z.string().uuid().nullable(),
  cta_label: optionalText(60),
  cta_url: optionalText(500).refine((v) => v === null || isSafeUrl(v), 'Use a full https:// address or a path starting with /.'),
  status: z.enum(LANDING_STATUSES),
});
export type LandingPageInput = z.infer<typeof landingPageInputSchema>;
