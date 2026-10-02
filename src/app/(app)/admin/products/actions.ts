'use server';

/**
 * Products write path for the ADMIN UI. (MCP also has product tools now --
 * list_products / upsert_product / set_product_price -- which write through
 * supabaseAdmin for automation callers; this path is the human one.)
 * Goes through mutate() (../lib/db),
 * same pattern as the blog editor: refuses when no actor can be resolved,
 * runs the write + perform_action() in one transaction, records real
 * before/after in action_audit_log. See migration
 * 011_products_razorpay_public_accounts.sql for the products table + RLS.
 */

import type { PoolClient } from 'pg';

import { revalidatePath } from 'next/cache';
import { onContentPublished } from '@/lib/search-ping';
import { redirect } from 'next/navigation';

import { mutate, toFormError } from '../lib/db';
import {
  FieldError,
  oneOf,
  optionalNumber,
  optionalString,
  requiredString,
  slug as slugField,
  toFormState,
  type FormState,
} from '../lib/form';
import {
  FULFILMENT,
  FULFILMENT_KINDS,
  validateFulfilment,
  type FulfilmentConfig,
  type FulfilmentKind,
} from '@/lib/fulfilment';
import { checkFloor, maxDiscountBp, type FloorPolicy } from '@/lib/margin';
import { isProductType } from '@/lib/product-types';
import { percentToBp } from '@/lib/pricing';
import { PRODUCT_STATUSES, type Product, type ProductStatus } from '@/lib/products-schema';

interface ProductFields {
  title: string;
  slug: string;
  description: string | null;
  category: string | null;
  price_paise: number;
  currency: string;
  status: ProductStatus;
  external_link: string | null;
  discount_bp: number | null;
  offer_ends_at: string | null;
  offer_label: string | null;
  product_type: string;
  cta_label: string | null;
  cta_subtext: string | null;
  fulfilment_kind: FulfilmentKind;
  fulfilment_config: FulfilmentConfig;
  grants_entitlements: string[];
  /** Slugs of products this bundle contains. Empty means it is not a bundle. */
  bundle_item_slugs: string[];
}

/**
 * Reads the pricing floor from app_config (migration 037).
 *
 * Config rather than constants: the gateway rate is Razorpay's to set, GST is
 * the government's, and the floor is a commercial decision that will change.
 */
async function floorPolicy(client: PoolClient): Promise<FloorPolicy> {
  const { rows } = await client.query<{ key: string; value: string }>(
    `SELECT key, value FROM public.app_config WHERE key LIKE 'pricing_%'`,
  );
  const cfg = new Map(rows.map((r) => [r.key, Number(r.value)]));
  return {
    minNetPaise: cfg.get('pricing_min_net_paise') ?? 0,
    minNetBp: cfg.get('pricing_min_net_bp') ?? 0,
    gstRateBp: 1800,
    gatewayFeeBp: cfg.get('pricing_gateway_fee_bp') ?? 200,
    gatewayFeeGstBp: cfg.get('pricing_gateway_fee_gst_bp') ?? 1800,
    hostingPerSalePaise: cfg.get('pricing_hosting_per_sale_paise') ?? 0,
  };
}

/**
 * Refuses a price, or a discount, that would leave less than the minimum cut.
 *
 * Checks the DISCOUNTED price, not the list price. A product priced
 * comfortably above the floor can be pushed under it by an offer, and checking
 * the list price would never reveal that.
 *
 * The error names the price that would work, so the answer arrives with the
 * refusal rather than being left as an exercise.
 */
function assertClearsFloor(fields: ProductFields, policy: FloorPolicy): void {
  if (fields.price_paise <= 0) return;   // 0 is "request a quote", not a sale

  const check = checkFloor(fields.price_paise, policy);
  if (!check.ok) {
    throw new FieldError(
      'price_rupees',
      `${check.reason} Price at ₹${(check.suggestedPricePaise / 100).toFixed(2)} or more.`,
    );
  }

  if (fields.discount_bp) {
    const discounted =
      fields.price_paise - Math.round((fields.price_paise * fields.discount_bp) / 10000);
    const afterOffer = checkFloor(discounted, policy);
    if (!afterOffer.ok) {
      const max = maxDiscountBp(fields.price_paise, policy);
      throw new FieldError(
        'discount_percent',
        `At ${fields.discount_bp / 100}% off you would keep only ₹${(afterOffer.netPaise / 100).toFixed(2)}. The most this price can carry is ${(max / 100).toFixed(1)}%.`,
      );
    }
  }
}

function readProductFields(formData: FormData): ProductFields {
  const priceRupees = optionalNumber(formData, 'price_rupees', 'Price');
  if (priceRupees !== null && priceRupees < 0) {
    throw new FieldError('price_rupees', 'Price cannot be negative.');
  }

  // Offer. Validated here as well as by the CHECK constraint in migration 033,
  // so the admin gets a message against the field rather than a database error
  // they cannot act on.
  //
  // The standard price is mandatory and always applies. The discount and its
  // deadline are one optional pair: a discount with no end date is a price
  // change, and a deadline with no discount does nothing.
  const discountRaw = optionalString(formData, 'discount_percent');
  const offerEndsRaw = optionalString(formData, 'offer_ends_at');
  const hasDiscount = Boolean(discountRaw && discountRaw.trim());

  if (hasDiscount) {
    const pct = Number(discountRaw);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new FieldError('discount_percent', 'Enter a discount between 0 and 100 percent.');
    }
    if (!offerEndsRaw) {
      throw new FieldError(
        'offer_ends_at',
        'A discount needs an end date and time. One that never ends is just a lower price.',
      );
    }
    if (new Date(offerEndsRaw) <= new Date()) {
      throw new FieldError('offer_ends_at', 'That is in the past — the discount would never apply.');
    }
  } else if (offerEndsRaw) {
    throw new FieldError('discount_percent', 'Add a discount, or clear the end date.');
  }

  // Delivery. The config shape follows from the kind, so only the fields that
  // kind uses are read -- a leftover value from a different kind must not be
  // saved and then silently honoured later.
  const fulfilment_kind = oneOf(
    formData, 'fulfilment_kind', 'Delivered as', FULFILMENT_KINDS,
  ) as FulfilmentKind;

  const fulfilment_config: FulfilmentConfig = {};
  if (fulfilment_kind === 'external_url') {
    fulfilment_config.url = optionalString(formData, 'fulfilment_url') ?? undefined;
  } else if (fulfilment_kind === 'github_release') {
    fulfilment_config.repo = optionalString(formData, 'fulfilment_repo') ?? undefined;
    fulfilment_config.tag = optionalString(formData, 'fulfilment_tag') ?? undefined;
  } else if (fulfilment_kind === 'private_page') {
    fulfilment_config.path = optionalString(formData, 'fulfilment_path') ?? undefined;
  } else if (fulfilment_kind === 'notion_page') {
    // Notion page ids appear with and without hyphens depending on where they
    // were copied from; the API accepts either, so normalise rather than reject.
    fulfilment_config.notion_page_id =
      optionalString(formData, 'fulfilment_notion_page_id')?.replace(/-/g, '') ?? undefined;
  } else if (fulfilment_kind === 'short_link') {
    fulfilment_config.slug = optionalString(formData, 'fulfilment_slug') ?? undefined;
  }

  // Mirrors the CHECK in migration 035, so the admin sees the problem on the
  // field rather than a database error. A buyer paying and finding nothing to
  // download is the failure this prevents.
  const fulfilmentError = validateFulfilment(fulfilment_kind, fulfilment_config);
  if (fulfilmentError) {
    const field = FULFILMENT[fulfilment_kind].requires[0] ?? 'fulfilment_kind';
    throw new FieldError(`fulfilment_${field}`, fulfilmentError);
  }

  return {
    title: requiredString(formData, 'title', 'Title'),
    slug: slugField(formData, 'slug', 'Slug'),
    description: optionalString(formData, 'description'),
    category: optionalString(formData, 'category'),
    price_paise: Math.round((priceRupees ?? 0) * 100),
    currency: optionalString(formData, 'currency') || 'INR',
    status: oneOf(formData, 'status', 'Status', PRODUCT_STATUSES) as ProductStatus,
    external_link: optionalString(formData, 'external_link'),
    // Basis points, like gst_rate_bp, so no rate anywhere is a float.
    discount_bp: hasDiscount ? percentToBp(discountRaw!) : null,
    // Clearing the discount clears the whole offer rather than leaving an
    // orphan deadline behind.
    offer_ends_at: hasDiscount ? new Date(offerEndsRaw!).toISOString() : null,
    offer_label: hasDiscount ? optionalString(formData, 'offer_label') : null,
    // Narrowed, never trusted: a form value reaching the DB unchecked fails on
    // the CHECK constraint at runtime instead of being caught here.
    product_type: isProductType(formData.get('product_type')) ? String(formData.get('product_type')) : 'one_off',
    cta_label: optionalString(formData, 'cta_label'),
    cta_subtext: optionalString(formData, 'cta_subtext'),
    fulfilment_kind,
    fulfilment_config,
    grants_entitlements: (optionalString(formData, 'grants_entitlements') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
    bundle_item_slugs: (optionalString(formData, 'bundle_items') ?? '')
      .split(/[\n,]/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

/**
 * Replaces a bundle's contents.
 *
 * Every slug must resolve, and a bundle cannot contain itself -- the database
 * refuses self-reference, but catching it here names the product rather than
 * surfacing a constraint violation. Replace rather than merge, so removing a
 * line from the form actually removes the item.
 */
async function saveBundleItems(
  client: PoolClient,
  bundleId: string,
  slugs: string[],
): Promise<void> {
  await client.query('DELETE FROM public.product_bundle_items WHERE bundle_product_id = $1', [
    bundleId,
  ]);
  if (!slugs.length) return;

  const { rows } = await client.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM public.products WHERE slug = ANY($1)',
    [slugs],
  );
  const found = new Map(rows.map((r) => [r.slug, r.id]));

  const missing = slugs.filter((sl) => !found.has(sl));
  if (missing.length) {
    throw new FieldError(
      'bundle_items',
      `No product with slug ${missing.map((m) => `"${m}"`).join(', ')}. Check the spelling.`,
    );
  }
  if (found.has(slugs.find((sl) => found.get(sl) === bundleId) ?? '')) {
    throw new FieldError('bundle_items', 'A bundle cannot contain itself.');
  }

  for (const [i, sl] of slugs.entries()) {
    await client.query(
      `INSERT INTO public.product_bundle_items (bundle_product_id, item_product_id, position)
            VALUES ($1, $2, $3)`,
      [bundleId, found.get(sl), i],
    );
  }
}

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const fields = readProductFields(formData);
    await mutate(async (client) => {
      assertClearsFloor(fields, await floorPolicy(client));

      const inserted = await client.query<Product>(
        `INSERT INTO public.products
           (title, slug, description, category, price_paise, currency, status, external_link,
            discount_bp, offer_ends_at, offer_label,
            fulfilment_kind, fulfilment_config, grants_entitlements,
            cta_label, cta_subtext, product_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          fields.title,
          fields.slug,
          fields.description,
          fields.category,
          fields.price_paise,
          fields.currency,
          fields.status,
          fields.external_link,
          fields.discount_bp,
          fields.offer_ends_at,
          fields.offer_label,
          fields.fulfilment_kind,
          JSON.stringify(fields.fulfilment_config),
          fields.grants_entitlements,
          fields.cta_label,
          fields.cta_subtext,
          fields.product_type,
        ],
      );
      const row = inserted.rows[0]!;
      await saveBundleItems(client, row.id, fields.bundle_item_slugs);
      return {
        result: row.id,
        audit: { resourceKey: 'products', action: 'create' as const, targetId: row.id, after: row },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  revalidatePath('/admin/products');
  redirect('/admin/products');
}

export async function updateProduct(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const fields = readProductFields(formData);
    await mutate(async (client) => {
      const before = await client.query<Product>(
        `SELECT * FROM public.products WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (before.rows.length === 0) throw new Error('That product no longer exists.');

      assertClearsFloor(fields, await floorPolicy(client));

      const updated = await client.query<Product>(
        `UPDATE public.products
            SET title = $2, slug = $3, description = $4, category = $5,
                price_paise = $6, currency = $7, status = $8, external_link = $9,
                discount_bp = $10, offer_ends_at = $11, offer_label = $12,
                fulfilment_kind = $13, fulfilment_config = $14,
                grants_entitlements = $15,
                cta_label = $16, cta_subtext = $17, product_type = $18,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          id,
          fields.title,
          fields.slug,
          fields.description,
          fields.category,
          fields.price_paise,
          fields.currency,
          fields.status,
          fields.external_link,
          fields.discount_bp,
          fields.offer_ends_at,
          fields.offer_label,
          fields.fulfilment_kind,
          JSON.stringify(fields.fulfilment_config),
          fields.grants_entitlements,
          fields.cta_label,
          fields.cta_subtext,
          fields.product_type,
        ],
      );

      await saveBundleItems(client, id, fields.bundle_item_slugs);

      return {
        result: undefined,
        audit: {
          resourceKey: 'products',
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

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${id}/edit`);
  revalidatePath('/templates');

  // The sitemap queries the database and revalidates hourly, so a newly
  // published item would otherwise wait up to an hour to be listed. Refreshing it
  // here makes discovery immediate: the page and the sitemap entry appear
  // together. No rebuild and no deploy — revalidatePath re-runs the route on the
  // server that is already running.
  revalidatePath('/sitemap.xml');
  // Tell the engines. Fire-and-forget: a slow search API must never
  // block the publish that triggered it.
  void onContentPublished({ paths: ['/sitemap.xml', '/templates'] });
  return { success: 'Saved.' };
}

export async function deleteProduct(id: string): Promise<void> {
  await mutate(async (client) => {
    const deleted = await client.query<Product>(
      `DELETE FROM public.products WHERE id = $1 RETURNING *`,
      [id],
    );
    if (deleted.rows.length === 0) throw new Error('That product no longer exists.');
    return {
      result: undefined,
      audit: { resourceKey: 'products', action: 'delete' as const, targetId: id, before: deleted.rows[0] },
    };
  });

  revalidatePath('/admin/products');
  revalidatePath('/templates');
  // Keep the sitemap in step with this change (see above).
  revalidatePath('/sitemap.xml');
}
