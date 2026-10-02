import type { Rule } from '@/components/ui/vb-field';

/**
 * JSON-driven form definitions.
 *
 * The direction the operator has asked for repeatedly: forms should be DATA,
 * not hand-written JSX, so adding a field or changing a validation rule is an
 * edit to a definition rather than a code change spread across a component, a
 * server action and a route handler.
 *
 * This is the first step of that — the field list, the copy and the validation
 * rules for a form live in one array. `<SchemaForm>` renders it, and the same
 * `rules` array is re-run server-side through `runRules` (vb-field.ts), so a
 * rule is declared once and enforced on both sides. The eventual goal (a
 * drag-and-drop builder writing these definitions into the DB) plugs in here:
 * a FormSchema is already plain serialisable data.
 *
 * Deliberately NOT a general-purpose form engine. It covers the field types
 * this admin actually uses; anything genuinely bespoke still writes JSX.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'money'      // rendered in rupees, stored in paise
  | 'datetime'   // date + time picker, stored as an ISO timestamp
  | 'url'
  | 'slug';

export interface FieldDef {
  /** Form field name — must match the column/FormData key. */
  name: string;
  label: string;
  type: FieldType;
  /** Small helper line under the field. */
  hint?: string;
  placeholder?: string;
  /** Validation contract, run on blur, on submit, AND server-side. */
  rules?: Rule[];
  /** For `select`. */
  options?: { value: string; label: string }[];
  /** Derive this field from another when it is untouched (slug from title). */
  deriveFrom?: string;
  /** Full width in a two-column grid. */
  wide?: boolean;
  /**
   * Groups this field with its neighbours under a heading. Fields that only
   * make sense together — a discount and its deadline — should read as one
   * unit rather than as separate questions scattered down a form.
   */
  section?: string;
}

export interface SectionDef {
  id: string;
  title: string;
  description?: string;
  /** Renders the group as visibly optional. */
  optional?: boolean;
}

export interface FormSchema {
  id: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  sections?: SectionDef[];
}

/** Money is stored in paise so there is never a float in the DB. */
export const rupeesToPaise = (rupees: string): number =>
  Math.round(parseFloat(rupees || '0') * 100);

export const paiseToRupees = (paise: number): string =>
  (paise / 100).toFixed(2);

/**
 * Products — the catalogue the site sells through Razorpay.
 *
 * SCOPE RULE, enforced in copy here so whoever adds a product sees it: a
 * product may be our SaaS subscription or our own service/offering. It must
 * never be lead generation, a lead list, or anything priced per lead.
 */
export const PRODUCT_FORM: FormSchema = {
  id: 'product',
  title: 'Product',
  description:
    'Sold through Razorpay checkout. Our SaaS and our own services only — never lead generation, lead lists, or anything priced per lead.',
  sections: [
    {
      id: 'delivery',
      title: 'What the buyer gets',
      description:
        'Where the thing being sold actually lives. Pick how it is delivered and fill in what that needs — the form asks only for the fields that kind uses.',
    },
    {
      id: 'bundle',
      title: 'Bundle contents',
      description:
        'Optional. List other products to include and this becomes a bundle — one price, one invoice line, and the buyer gets everything inside. No cart needed, because the seller assembles it rather than the buyer.',
      optional: true,
    },
    {
      id: 'offer',
      title: 'Limited-time offer',
      description:
        'Optional. A discount off the standard price, running until a deadline — after which the standard price applies again with nothing to switch off. Both fields are needed, or neither.',
      optional: true,
    },
  ],
  fields: [
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      placeholder: 'Sample App',
      rules: [{ kind: 'required' }, { kind: 'max', value: 120 }],
    },
    {
      name: 'slug',
      label: 'Slug',
      type: 'slug',
      deriveFrom: 'title',
      hint: 'URL path. Lowercase, hyphens only.',
      rules: [
        { kind: 'required' },
        { kind: 'pattern', value: '^[a-z0-9]+(?:-[a-z0-9]+)*$', message: 'Lowercase letters, numbers and single hyphens only.' },
      ],
    },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea',
      wide: true,
      hint: 'One or two plain sentences. Claim-first, no absolute guarantees.',
      rules: [{ kind: 'max', value: 600 }],
    },
    {
      name: 'category',
      label: 'Category',
      type: 'select',
      options: [
        { value: 'saas', label: 'SaaS subscription' },
        { value: 'one-off', label: 'One-off purchase' },
        { value: 'service', label: 'Service engagement' },
        { value: 'blueprint', label: 'Blueprint' },
      ],
    },
    {
      name: 'product_type',
      label: 'Product type',
      type: 'select',
      options: [
        { value: 'saas', label: 'SaaS — recurring subscription' },
        { value: 'one_off', label: 'One-off buy — pay once, own it' },
        { value: 'blueprint', label: 'Blueprint — a document, guide or template' },
        { value: 'service', label: 'Service — an engagement, priced per scope' },
        { value: 'lead_magnet', label: 'Lead magnet — free' },
      ],
      hint: 'The commercial model, which decides the default button text. Separate from how it is delivered.',
    },
    {
      name: 'cta_label',
      label: 'Button text',
      type: 'text',
      placeholder: 'Get the blueprint',
      hint: 'Overrides the button text. Left blank, it follows the product type — "Grab your offer" when free, "Buy now", "Start your subscription", "Book a call".',
    },
    {
      name: 'cta_subtext',
      label: 'Under the button',
      type: 'text',
      placeholder: 'Instant download · GST invoice included',
      hint: 'Small reassurance line beneath the button. Answers the hesitation a buyer has at the moment of clicking.',
    },
    {
      name: 'price_rupees',
      label: 'Price (₹)',
      type: 'money',
      hint: 'Stored in paise. Leave 0 for "Request a quote" — no Buy button is shown at 0.',
      rules: [{ kind: 'required' }],
    },
    {
      name: 'discount_percent',
      label: 'Discount %',
      type: 'text',
      section: 'offer',
      placeholder: '25',
      hint: 'Off the standard price above. Leave blank for no offer.',
      rules: [
        { kind: 'pattern', value: '^$|^(100|[0-9]{1,2})(\\.[0-9]{1,2})?$', message: 'A percentage between 0 and 100.' },
      ],
    },
    {
      name: 'offer_ends_at',
      label: 'Valid till',
      type: 'datetime',
      section: 'offer',
      hint: 'After this the standard price applies again automatically.',
    },
    {
      name: 'offer_label',
      label: 'Offer label',
      type: 'text',
      wide: true,
      section: 'offer',
      placeholder: 'Launch offer',
      hint: 'Optional. Shown beside the price on the product page.',
      rules: [{ kind: 'max', value: 40 }],
    },
    {
      name: 'fulfilment_kind',
      label: 'Delivered as',
      type: 'select',
      section: 'delivery',
      options: [
        { value: 'none', label: 'Manual follow-up — we contact the buyer' },
        { value: 'hosted_file', label: 'File we host (PDF, guide, prompt library)' },
        { value: 'external_url', label: 'Link elsewhere (Play Store, App Store, Drive)' },
        { value: 'github_release', label: 'GitHub release (an actual build)' },
        { value: 'private_page', label: 'Private page on this site' },
        { value: 'notion_page', label: 'Notion page, rendered here behind the paywall' },
        { value: 'short_link', label: 'Tracked short link — PUBLIC, not a gate' },
        { value: 'physical', label: 'Physical item — shipped' },
        { value: 'service', label: 'Service or booking' },
      ],
    },
    {
      name: 'fulfilment_url',
      label: 'Link',
      type: 'url',
      section: 'delivery',
      wide: true,
      placeholder: 'https://play.google.com/store/apps/details?id=…',
      hint: 'For “Link elsewhere”. Where the buyer is sent after paying.',
    },
    {
      name: 'fulfilment_repo',
      label: 'GitHub repo',
      type: 'text',
      section: 'delivery',
      placeholder: 'yoursite/sample-app',
      hint: 'For “GitHub release”. owner/repo.',
    },
    {
      name: 'fulfilment_tag',
      label: 'Release tag',
      type: 'text',
      section: 'delivery',
      placeholder: 'v1.2.0',
      hint: 'For “GitHub release”.',
    },
    {
      name: 'fulfilment_path',
      label: 'Page path',
      type: 'text',
      section: 'delivery',
      placeholder: '/library/prompts',
      hint: 'For “Private page”. Must start with a slash. Only buyers can open it.',
    },
    {
      name: 'fulfilment_notion_page_id',
      label: 'Notion page ID',
      type: 'text',
      section: 'delivery',
      wide: true,
      placeholder: '1a2b3c4d5e6f7890abcdef1234567890',
      hint: 'For “Notion page”. The 32-character id from the page URL. We pull the content and render it here, so the Notion page itself stays private.',
    },
    {
      name: 'fulfilment_slug',
      label: 'Short link slug',
      type: 'slug',
      section: 'delivery',
      placeholder: 'sample-app',
      hint: 'For “Tracked short link”. An existing slug, served at /go/<slug>. That route is public and unauthenticated — use it only for material that may be shared freely.',
    },
    {
      name: 'grants_entitlements',
      label: 'Grants access to',
      type: 'text',
      section: 'delivery',
      wide: true,
      placeholder: 'sample-app-desktop, prompt-library',
      hint: 'Comma-separated keys unlocked on payment. Several keys makes this product a bundle — no cart needed.',
    },
    {
      name: 'bundle_items',
      label: 'Products included',
      type: 'textarea',
      section: 'bundle',
      wide: true,
      placeholder: 'sample-app\nprompt-library\nblueprint-pack',
      hint: 'One product slug per line. Leave blank if this is not a bundle. Their entitlements are granted automatically alongside this product\'s own.',
    },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'draft', label: 'Draft — not visible' },
        { value: 'active', label: 'Active — on sale' },
        { value: 'archived', label: 'Archived' },
      ],
    },
    {
      name: 'external_link',
      label: 'External link',
      type: 'url',
      wide: true,
      hint: 'Optional. For an offering that lives elsewhere (a download, a scheduling page).',
    },
  ],
};

/**
 * Billing details — collected at FIRST CHECKOUT, not at signup.
 *
 * Deliberately not part of registration. Most people who sign up never buy, so
 * asking at signup collects tax data we do not need, for people who will never
 * transact, and then obliges us to protect and erase it under DPDP. It also
 * lengthens a signup flow that is already long. Asked once at the first
 * purchase and stored on site_accounts, it is prefilled on every later one.
 *
 * These fields exist because GST is decided by PLACE OF SUPPLY:
 *   country != IN  -> export of services, zero-rated
 *   state == ours  -> CGST + SGST
 *   other state    -> IGST
 * Without the state we must fall back to our own, which charges an intra-state
 * split to a buyer who should have been charged IGST.
 */
export const BILLING_FORM: FormSchema = {
  id: 'billing',
  title: 'Billing details',
  description:
    'Needed to work out the right tax. Stored on your account, so you are only asked once.',
  fields: [
    {
      name: 'billing_country',
      label: 'Country',
      type: 'select',
      options: [
        { value: 'IN', label: 'India' },
        { value: 'OTHER', label: 'Outside India' },
      ],
      hint: 'Outside India is treated as an export of services — no Indian GST.',
    },
    {
      name: 'billing_state_code',
      label: 'State',
      type: 'select',
      hint: 'Decides CGST + SGST versus IGST.',
      options: [{ value: '', label: 'Select a state…' }],
    },
    {
      name: 'gstin',
      label: 'GSTIN (optional)',
      type: 'text',
      wide: true,
      placeholder: '29ABCDE1234F1Z5',
      hint: 'For a business purchase. Printed on the invoice so you can claim input credit.',
      rules: [
        {
          kind: 'pattern',
          value: '^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
          message: 'That does not look like a valid 15-character GSTIN.',
        },
      ],
    },
  ],
};

export const FORM_SCHEMAS: Record<string, FormSchema> = {
  product: PRODUCT_FORM,
  billing: BILLING_FORM,
};
