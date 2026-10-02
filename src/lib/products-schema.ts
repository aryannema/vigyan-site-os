// Paid items (blueprints, templates) -- admin CRUD-able, backs /templates and
// checkout. Migration 011_products_razorpay_public_accounts.sql.

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface Product {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category?: string | null;
  /** Discount in basis points off price_paise. 2500 = 25%. Null = no offer (migration 033). */
  discount_bp?: number | null;
  offer_ends_at?: string | null;
  offer_label?: string | null;
  /** How the buyer receives it, and the kind-specific settings (migration 035). */
  fulfilment_kind?: string | null;
  fulfilment_config?: {
    url?: string; repo?: string; tag?: string; path?: string;
    notion_page_id?: string; slug?: string;
  } | null;
  grants_entitlements?: string[] | null;
  price_paise: number;
  currency: string;
  status: ProductStatus;
  external_link?: string | null;
  created_at: string;
  updated_at: string;
}

export function formatPrice(price_paise: number, currency: string): string {
  if (price_paise === 0) return 'Free';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price_paise / 100);
}
