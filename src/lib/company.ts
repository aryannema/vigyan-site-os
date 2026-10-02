import { supabase } from '@/lib/supabase';

/**
 * The company's own identity (migration 040).
 *
 * One row, read everywhere: the footer, the legal pages, both invoices and the
 * schema.org block. It used to be repeated across twelve files, and the
 * copies drifted apart — two tax identities ended up printed one above the
 * other.
 *
 * Fails closed to the values the site shipped with. A legal page that renders
 * "undefined" as the company name is worse than one that is briefly out of
 * date, so a database hiccup degrades to the last-known-good identity rather
 * than to nothing.
 */

export interface CompanyProfile {
  legal_name: string;
  brand_name: string;
  entity_type: string;
  cin: string | null;
  gstin: string | null;
  pan: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  map_embed_url: string | null;
  map_link_url: string | null;
}

/** Shown until Admin > Settings > Company is filled in. Placeholder values. */
export const COMPANY_FALLBACK: CompanyProfile = {
  legal_name: 'Your Company Private Limited',
  brand_name: 'YourSite',
  entity_type: 'private_limited',
  cin: null,
  gstin: null,
  pan: null,
  address_line1: null,
  address_line2: null,
  city: 'Your City',
  state_code: null,
  postal_code: null,
  country: 'IN',
  email: 'hello@example.com',
  phone: '+919000000000',
  map_embed_url: null,
  map_link_url: null,
};

export async function getCompany(): Promise<CompanyProfile> {
  try {
    const { data, error } = await supabase
      .from('company_profile')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return COMPANY_FALLBACK;
    return { ...COMPANY_FALLBACK, ...(data as Partial<CompanyProfile>) };
  } catch {
    return COMPANY_FALLBACK;
  }
}

/**
 * One-line address for an invoice header or a footer.
 *
 * The country is ALWAYS appended, never used as a fallback. An earlier version
 * used `||`, so any address with a city returned early and the country was
 * silently dropped — an invoice reading only a city with no country, which on a
 * cross-border document is exactly the part that matters.
 */
export function formatAddress(c: CompanyProfile): string {
  const country = c.country === 'IN' ? 'India' : c.country;
  return [c.address_line1, c.address_line2, c.city, c.postal_code, country]
    .filter(Boolean)
    .join(', ');
}

/**
 * Validates the identity fields.
 *
 * Shared by the admin form and its server action, so a rule is written once.
 * Everything is optional except the two names: a company registering for GST
 * later should not be blocked from setting its address today.
 */
export function validateCompany(c: Partial<CompanyProfile>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!c.legal_name?.trim()) errors.legal_name = 'The registered name is required — invoices carry it.';
  if (!c.brand_name?.trim()) errors.brand_name = 'The trading name is required.';

  if (c.gstin?.trim()) {
    const g = c.gstin.trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g)) {
      errors.gstin = 'A GSTIN is 15 characters: 2 digits, 5 letters, 4 digits, a letter, a digit or letter, Z, then one more.';
    } else if (c.state_code && g.slice(0, 2) !== c.state_code) {
      // The GSTIN's first two digits ARE the state code. If they disagree with
      // the state below, one is wrong and there is no way to tell which — so
      // refuse rather than print a contradiction on every invoice.
      errors.gstin = `This GSTIN is registered in state ${g.slice(0, 2)}, but the state below is ${c.state_code}.`;
    }
  }

  // CIN is 21 characters and its 7th–11th describe the state and year. Only the
  // shape is checked here; the registry is the authority on the rest.
  if (c.cin?.trim() && !/^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/.test(c.cin.trim())) {
    errors.cin = 'A CIN is 21 characters, e.g. U00000KA2026PTC000000.';
  }

  if (c.pan?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(c.pan.trim().toUpperCase())) {
    errors.pan = 'A PAN is 10 characters, e.g. AAAAA0000A.';
  }

  if (c.postal_code?.trim() && c.country === 'IN' && !/^[1-9][0-9]{5}$/.test(c.postal_code.trim())) {
    errors.postal_code = 'An Indian PIN code is 6 digits and does not start with 0.';
  }

  if (c.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) {
    errors.email = 'That does not look like an email address.';
  }

  for (const [field, value] of [['map_embed_url', c.map_embed_url], ['map_link_url', c.map_link_url]] as const) {
    if (value?.trim() && !/^https?:\/\//i.test(value.trim())) {
      errors[field] = 'Must start with http:// or https://.';
    }
  }

  // An embed URL that is not actually an embed renders a broken frame rather
  // than a map, which looks like a site fault.
  if (c.map_embed_url?.trim() && !/google\.com\/maps\/embed/i.test(c.map_embed_url)) {
    errors.map_embed_url =
      'Use the src from Google Maps → Share → Embed a map. It contains google.com/maps/embed.';
  }

  return errors;
}
