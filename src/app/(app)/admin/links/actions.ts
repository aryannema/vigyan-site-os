'use server';

/**
 * UTM link builder write path -- same pattern as products/actions.ts: goes
 * straight through mutate() (../lib/db), refuses when no actor can be
 * resolved, runs the write + perform_action() in one transaction, records
 * real before/after in action_audit_log. See migration
 * 017_utm_link_shortener.sql for the link_shortener/link_clicks tables + RLS.
 *
 * This is a SEPARATE write path from the MCP route's create_short_link tool
 * (src/app/api/mcp/route.ts), which writes the same table via supabaseAdmin
 * with no actor -- deliberately, since MCP callers are agents, not
 * auth.users identities. Both land in the same table; see docs/
 * LINK_BUILDER_AND_CAMPAIGNS.md for the full picture.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { siteConfig } from '@/config/site';
import { campaignLinkSlug, platformByKey } from '@/lib/campaign-platforms';
import { mutate, toFormError } from '../lib/db';
import {
  oneOf,
  optionalString,
  requiredString,
  requiredUrl,
  slug as slugField,
  slugify,
  toFormState,
  type FormState,
} from '../lib/form';
import {
  LINK_OFFER_TYPES,
  LINK_STATUSES,
  type LinkOfferType,
  type LinkStatus,
  shortLinkUrl,
  type ShortLink,
} from '@/lib/links-schema';

interface LinkFields {
  slug: string;
  target_url: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  platform: string | null;
  offer_type: LinkOfferType;
  status: LinkStatus;
}

function readLinkFields(formData: FormData): LinkFields {
  return {
    slug: slugField(formData, 'slug', 'Slug'),
    target_url: requiredUrl(formData, 'target_url', 'Target URL'),
    utm_source: optionalString(formData, 'utm_source'),
    utm_medium: optionalString(formData, 'utm_medium'),
    utm_campaign: optionalString(formData, 'utm_campaign'),
    utm_term: optionalString(formData, 'utm_term'),
    utm_content: optionalString(formData, 'utm_content'),
    platform: optionalString(formData, 'platform'),
    offer_type: oneOf(formData, 'offer_type', 'Offer type', LINK_OFFER_TYPES) as LinkOfferType,
    status: oneOf(formData, 'status', 'Status', LINK_STATUSES) as LinkStatus,
  };
}

export async function createLink(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const fields = readLinkFields(formData);
    await mutate(async (client) => {
      const inserted = await client.query<ShortLink>(
        `INSERT INTO public.link_shortener
           (slug, target_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, platform, offer_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          fields.slug,
          fields.target_url,
          fields.utm_source,
          fields.utm_medium,
          fields.utm_campaign,
          fields.utm_term,
          fields.utm_content,
          fields.platform,
          fields.offer_type,
          fields.status,
        ],
      );
      const row = inserted.rows[0]!;
      return {
        result: row.id,
        audit: { resourceKey: 'links', action: 'create' as const, targetId: row.id, after: row },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  revalidatePath('/admin/links');
  redirect('/admin/links');
}

export async function updateLink(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const fields = readLinkFields(formData);
    await mutate(async (client) => {
      const before = await client.query<ShortLink>(
        `SELECT * FROM public.link_shortener WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (before.rows.length === 0) throw new Error('That link no longer exists.');

      const updated = await client.query<ShortLink>(
        `UPDATE public.link_shortener
            SET slug = $2, target_url = $3, utm_source = $4, utm_medium = $5,
                utm_campaign = $6, utm_term = $7, utm_content = $8, platform = $9,
                offer_type = $10, status = $11, updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          id,
          fields.slug,
          fields.target_url,
          fields.utm_source,
          fields.utm_medium,
          fields.utm_campaign,
          fields.utm_term,
          fields.utm_content,
          fields.platform,
          fields.offer_type,
          fields.status,
        ],
      );

      return {
        result: undefined,
        audit: {
          resourceKey: 'links',
          action: 'edit' as const,
          targetId: id,
          before: before.rows[0],
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  revalidatePath('/admin/links');
  revalidatePath(`/admin/links/${id}/edit`);
  return { success: 'Saved.' };
}

export async function deleteLink(id: string): Promise<void> {
  await mutate(async (client) => {
    const deleted = await client.query<ShortLink>(
      `DELETE FROM public.link_shortener WHERE id = $1 RETURNING *`,
      [id],
    );
    if (deleted.rows.length === 0) throw new Error('That link no longer exists.');
    return {
      result: undefined,
      audit: { resourceKey: 'links', action: 'delete' as const, targetId: id, before: deleted.rows[0] },
    };
  });

  revalidatePath('/admin/links');
}

export interface CampaignLinksInput {
  campaign: string;
  productId: string | null;
  landingSlug?: string | null;
  customUrl: string | null;
  offerType: string;
  platforms: string[];
}

export type CampaignLinksResult =
  | { ok: true; links: { platform: string; slug: string; url: string }[] }
  | { ok: false; error: string };

/**
 * One transaction: every platform's link is created or none is, so a slug
 * collision on the fourth platform cannot leave three orphans behind.
 */
export async function createCampaignLinks(input: CampaignLinksInput): Promise<CampaignLinksResult> {
  const campaign = slugify(input.campaign ?? '');
  if (!campaign) return { ok: false, error: 'Give the campaign a name.' };
  if (!(LINK_OFFER_TYPES as readonly string[]).includes(input.offerType)) {
    return { ok: false, error: 'Pick an offer type.' };
  }
  const platforms = [...new Set(input.platforms ?? [])]
    .map((key) => platformByKey(key))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (platforms.length === 0) return { ok: false, error: 'Pick at least one platform.' };

  try {
    const links = await mutate(async (client) => {
      let targetUrl: string;
      let productId: string | null = null;
      if (input.landingSlug) {
        const lp = await client.query<{ slug: string; product_id: string | null }>(
          `SELECT slug, product_id FROM public.landing_pages WHERE slug = $1 AND status = 'published'`,
          [input.landingSlug],
        );
        const row = lp.rows[0];
        if (!row) throw new Error('That landing page is not published.');
        productId = row.product_id;
        targetUrl = `${siteConfig.url}/services/${row.slug}`;
      } else if (input.productId) {
        const product = await client.query<{ id: string; slug: string }>(
          `SELECT id, slug FROM public.products WHERE id = $1`,
          [input.productId],
        );
        const row = product.rows[0];
        if (!row) throw new Error('That product no longer exists.');
        productId = row.id;
        targetUrl = `${siteConfig.url}/products/${row.slug}`;
      } else {
        try {
          const parsed = new URL(input.customUrl ?? '');
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
          targetUrl = parsed.toString();
        } catch {
          throw new Error('Enter a full URL starting with https://, or choose a product.');
        }
      }

      const slugs = platforms.map((p) => campaignLinkSlug(campaign, p.key));
      const clash = await client.query<{ slug: string }>(
        `SELECT slug FROM public.link_shortener WHERE slug = ANY($1::text[])`,
        [slugs],
      );
      if (clash.rows.length > 0) {
        throw new Error(
          `Already taken: ${clash.rows.map((r) => `/go/${r.slug}`).join(', ')}. Change the campaign name or delete the old link.`,
        );
      }

      const created: { platform: string; slug: string; url: string }[] = [];
      const rows: ShortLink[] = [];
      for (const [i, platform] of platforms.entries()) {
        const inserted = await client.query<ShortLink>(
          `INSERT INTO public.link_shortener
             (slug, target_url, utm_source, utm_medium, utm_campaign, platform, offer_type, status, product_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
           RETURNING *`,
          [slugs[i], targetUrl, platform.key, platform.medium, campaign, platform.key, input.offerType, productId],
        );
        rows.push(inserted.rows[0]!);
        created.push({ platform: platform.key, slug: slugs[i]!, url: shortLinkUrl(slugs[i]!) });
      }

      return {
        result: created,
        audit: {
          resourceKey: 'links',
          action: 'create' as const,
          targetId: rows[0]!.id,
          after: { campaign, count: rows.length, links: rows },
        },
      };
    });
    revalidatePath('/admin/links');
    return { ok: true, links };
  } catch (error) {
    return { ok: false, error: toFormError(error) };
  }
}
