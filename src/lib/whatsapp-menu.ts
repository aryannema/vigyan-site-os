import { PRODUCT_TYPE_LABELS, type ProductType } from '@/lib/product-types';
import { formatPrice, cheapest, annualSavingBp, type PriceRow, type Currency } from '@/lib/price-display';

/**
 * Menu construction, as pure functions over data.
 *
 * Meta's list caps are hard limits -- a payload that breaches one is REJECTED,
 * so the whole menu fails to send rather than degrading. Truncation therefore
 * happens here rather than being left to whoever writes a product title.
 */

export const MENU_LIMITS = {
  /** Rows across ALL sections, not per section. */
  maxRows: 10,
  titleChars: 24,
  descriptionChars: 72,
  sectionTitleChars: 24,
  bodyChars: 1024,
} as const;

export interface MenuRow { id: string; title: string; description?: string }
export interface MenuSection { title: string; rows: MenuRow[] }

/** Cuts to the limit on a word boundary where it can, with an ellipsis. */
export function truncate(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

export interface MenuProduct {
  slug: string;
  title: string;
  product_type: string | null;
  /** Rows joined from product_prices. Empty is legitimate: a quote-only product. */
  prices: PriceRow[];
}

/**
 * Turn live product rows into menu rows.
 *
 * Built from the products TABLE rather than hardcoded copy, so adding a product
 * in the admin puts it in the WhatsApp menu with no deploy and no second list to
 * keep in step. Ids are prefixed `P:` so a tap can be resolved back to a slug
 * without colliding with a command word.
 */
export function productRows(products: MenuProduct[], limit: number, currency: Currency = 'INR'): MenuRow[] {
  return products.slice(0, Math.max(0, limit)).map((p) => {
    const type = PRODUCT_TYPE_LABELS[p.product_type as ProductType]?.split('—')[0].trim();

    // Cheapest row in the buyer's currency, so a product with bands reads
    // "From ₹999/mo" rather than picking an arbitrary band. No priced row at
    // all means quote-only, which is a real state, not a missing price.
    const low = cheapest(p.prices, currency);
    const many = p.prices.filter((x) => x.currency === currency && x.amount_minor !== null).length > 1;
    const price = low ? `${many && low.price_model !== 'from' ? 'From ' : ''}${formatPrice(low)}` : 'Talk to us';

    // Derived from the month/year pair, never stored -- a saved percentage
    // drifts the moment either price is replaced.
    const saving = annualSavingBp(p.prices, currency);
    const annual = saving ? `save ${Math.round(saving / 100)}% yearly` : null;

    return {
      id: `P:${p.slug}`,
      title: truncate(p.title, MENU_LIMITS.titleChars),
      description: truncate([price, annual ?? type].filter(Boolean).join(' · '), MENU_LIMITS.descriptionChars),
    };
  });
}

/** The rows that are always present, whatever is in the catalogue. */
/** Which optional rows the operator has enabled, from feature_flags. */
export interface MenuToggles {
  ask?: boolean;
  verify?: boolean;
  human?: boolean;
  delete?: boolean;
}

/**
 * The rows that do not come from the catalogue.
 *
 * Every one is gated on a flag EXCEPT the opt-out. A row offering something
 * that is switched off is a dead end the customer finds by tapping it.
 *
 * STOP is deliberately not gated. An opt-out an operator can disable is not an
 * opt-out: Meta expects it, DPDP expects it, and an ignored STOP becomes a
 * block or a report, which is what actually collapses a number's quality
 * rating. It is unconditional here by design, not by omission.
 */
export function accountRows(toggles: MenuToggles = {}): MenuRow[] {
  const rows: MenuRow[] = [];

  // First, because it is the answer to most things. Without a row saying so, a
  // short list reads as the only things we can help with.
  if (toggles.ask) {
    rows.push({ id: 'ASK', title: 'Something else', description: 'Ask us anything — we answer from our knowledge base' });
  }
  if (toggles.verify) {
    rows.push({ id: 'VERIFY', title: 'Verify my number', description: 'Finish verifying this WhatsApp number' });
  }
  if (toggles.human) {
    rows.push({ id: 'HUMAN', title: 'Talk to a person', description: 'Hand this conversation to a human' });
  }

  // Always present. See above.
  rows.push({ id: 'STOP', title: 'Stop messages', description: 'Opt out of WhatsApp messages from us' });

  // Discoverable on purpose: under the DPDP Act the right to erasure has to be
  // exercisable, and burying it on a web page while running a chat channel is
  // not that.
  if (toggles.delete) {
    rows.push({ id: 'DELETE', title: 'Delete my data', description: 'Start a request to erase your account and data' });
  }
  return rows;
}

/**
 * Assemble the sections, enforcing Meta's TOTAL row cap across all of them.
 * Account rows are added first and never dropped -- losing "Stop messages"
 * because the catalogue grew would be the worst possible thing to truncate.
 */
export function buildSections(
  products: MenuProduct[],
  toggles: MenuToggles = {},
  currency: Currency = 'INR',
): MenuSection[] {
  const account = accountRows(toggles);
  const budget = MENU_LIMITS.maxRows - account.length;
  const catalogue = productRows(products, budget, currency);

  const sections: MenuSection[] = [];
  if (catalogue.length > 0) {
    sections.push({ title: truncate('What we sell', MENU_LIMITS.sectionTitleChars), rows: catalogue });
  }
  sections.push({ title: truncate('Your account', MENU_LIMITS.sectionTitleChars), rows: account });
  return sections;
}

/** A tapped product row id back to its slug; null for anything else. */
export function slugFromRowId(id: string): string | null {
  return typeof id === 'string' && id.startsWith('P:') ? id.slice(2) || null : null;
}
