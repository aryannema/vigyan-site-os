/**
 * Product vocabulary, in ONE place.
 *
 * These arrays must match the CHECK constraints in the database
 * (products_product_type_check, and the status check in the base schema).
 * They are `as const` so the unions are derived from them rather than
 * hand-written twice and allowed to drift.
 *
 * This file exists because of a real bug: `status === 'published'` was written
 * throughout a new page. The real values are draft/active/archived. TypeScript
 * caught it only in a file with typed rows -- the page read untyped Supabase
 * results, so the comparison compiled fine and would have silently 404'd every
 * product forever. Anything reading products.status or products.product_type
 * should import from here so that class of mistake cannot compile.
 */

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_TYPES = ['saas', 'one_off', 'blueprint', 'service', 'lead_magnet'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  saas: 'SaaS — recurring subscription',
  one_off: 'One-off buy — pay once, own it',
  blueprint: 'Blueprint — a document, guide or template',
  service: 'Service — an engagement, priced per scope',
  lead_magnet: 'Lead magnet — free',
};

/** Narrowing guards, for values arriving untyped from the database or a form. */
export function isProductStatus(v: unknown): v is ProductStatus {
  return typeof v === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(v);
}
export function isProductType(v: unknown): v is ProductType {
  return typeof v === 'string' && (PRODUCT_TYPES as readonly string[]).includes(v);
}

/** Only an 'active' product is visible to the public. */
export function isPubliclyVisible(status: unknown): boolean {
  return status === 'active';
}

/**
 * Default button text when the admin has not set one.
 *
 * A free thing and a paid thing need different words: "Buy now" on something
 * free reads as a mistake, and "Grab your offer" on a ₹40,000 engagement reads
 * as a gimmick. The admin can override any of this with cta_label -- these are
 * only the fallbacks.
 */
export function defaultCtaLabel(type: ProductType, isFree: boolean): string {
  if (isFree || type === 'lead_magnet') return 'Grab your offer';
  switch (type) {
    case 'saas':      return 'Start your subscription';
    case 'service':   return 'Book a call';
    case 'blueprint': return 'Buy the blueprint';
    case 'one_off':   return 'Buy now';
  }
}
