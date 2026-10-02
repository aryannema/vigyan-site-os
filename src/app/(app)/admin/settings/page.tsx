import { query } from '../lib/db';
import { FeatureFlagToggle } from './FeatureFlagToggle';
import { AppConfigInput } from './AppConfigInput';
import { AppConfigTextInput } from './AppConfigTextInput';
import { AppConfigBoolInput } from './AppConfigBoolInput';
import { SocialLinkRow } from './SocialLinkRow';
import { PurgeCacheButton } from './PurgeCacheButton';
import { SubmitSearchButton } from './SubmitSearchButton';

export const dynamic = 'force-dynamic';

interface FeatureFlagRow {
  key: string;
  enabled: boolean;
}

interface AppConfigRow {
  key: string;
  value: number | string;
}

interface SocialLinkRowData {
  platform: string;
  url: string;
  enabled: boolean;
}

const SOCIAL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  telegram: 'Telegram',
};

const FLAG_LABELS: Record<string, { label: string; description: string }> = {
  sample_product_live: {
    label: 'Sample Product',
    description:
      'Shows the Sample Product nav item, the two footer links, the home hero and closing CTAs, and the product card. Off until the product actually ships \u2014 while off, /sample-product itself returns 404 rather than a page describing something nobody can buy. Turning this on does not build it.',
  },
  wa_menu_ask: {
    label: 'WhatsApp menu — "Something else"',
    description: 'Lets a customer ask a free-form question, answered from the knowledge base. Off if the AI assistant should not field open questions.',
  },
  wa_menu_verify: {
    label: 'WhatsApp menu — "Verify my number"',
    description: 'Only useful while number verification is part of the signup flow. A row for a disabled feature is a dead end the customer finds by tapping it.',
  },
  wa_menu_human: {
    label: 'WhatsApp menu — "Talk to a person"',
    description: 'Escalates the conversation to a human. Turn off when nobody is watching the inbox, rather than promising a reply that will not come.',
  },
  wa_menu_delete: {
    label: 'WhatsApp menu — "Delete my data"',
    description: 'Points to the account-deletion request flow. Under the DPDP Act the right to erasure has to be exercisable; leaving this on is the safer default.',
  },
  whatsapp_otp_template_live: {
    label: 'WhatsApp OTP via template',
    description:
      'On: we send the verification code automatically using the approved Authentication template (WhatsApp OTP template name in Operational config). Off: customers tap "Verify on WhatsApp" and send VERIFY, and we reply with the code — no template needed.',
  },
  profile_gate_customers: {
    label: 'Profile popup — customers',
    description:
      'Signed-in customers must confirm their email and complete name, verified WhatsApp and billing location before using the site or buying. Off lets them browse and buy without it.',
  },
  profile_gate_staff: {
    label: 'Profile popup — admins & editors',
    description:
      'Applies the same popup to staff accounts. Off by default while the WhatsApp Authentication template is pending with Meta.',
  },
  whatsapp_live: {
    label: 'WhatsApp chat',
    description:
      'Shows the floating chat button, home-page CTAs, contact-page WhatsApp row, lead-form opt-in checkbox, and footer icon site-wide. Off since the WABA ban on 2026-09-08 — see docs/OPS.md §12. Turning this on does not un-ban the number; only enable once the appeal actually resolves.',
  },
};

const CONFIG_LABELS: Record<string, { label: string; description: string }> = {
  pricing_gateway_fee_bp: { label: 'Gateway fee (basis points)', description: "Razorpay's cut, in basis points — 200 = 2%. Used to price backwards from the net you want to keep." },
  pricing_gateway_fee_gst_bp: { label: 'GST on gateway fee (basis points)', description: 'GST charged by the gateway on its own fee — 1800 = 18%.' },
  pricing_hosting_per_sale_paise: { label: 'Hosting cost per sale (paise)', description: 'Flat R2/bandwidth cost attributed to one sale, in paise. Subtracted before the margin floor is checked.' },
  pricing_min_net_bp: { label: 'Minimum net margin (basis points)', description: 'The smallest share of the price we must keep after GST, gateway fee and hosting — 6000 = 60%. Whichever of this and the paise floor is higher wins.' },
  pricing_min_net_paise: { label: 'Minimum net per sale (paise)', description: 'The smallest absolute amount we must keep on any sale, in paise. A price or discount that breaches it is refused in both the admin and MCP paths.' },
  whatsapp_otp_expiry_minutes: { label: 'WhatsApp VERIFY code expiry (min)', description: 'How long a WhatsApp number-verification code stays valid.' },
  whatsapp_otp_max_attempts: { label: 'WhatsApp VERIFY max attempts', description: 'Wrong-code attempts allowed before a code is rejected outright.' },
  whatsapp_otp_resend_cooldown_seconds: { label: 'WhatsApp VERIFY resend cooldown (sec)', description: 'Minimum wait between two verification codes to the same number.' },
  whatsapp_otp_daily_cap: { label: 'WhatsApp VERIFY daily cap', description: 'Max verification codes sent to one account per rolling 24h.' },
  deletion_email_token_expiry_minutes: { label: 'Deletion email link expiry (min)', description: 'How long an account-deletion email confirmation link stays valid.' },
  deletion_whatsapp_expiry_minutes: { label: 'Deletion WhatsApp code expiry (min)', description: 'How long an account-deletion WhatsApp code stays valid.' },
  deletion_whatsapp_max_attempts: { label: 'Deletion WhatsApp max attempts', description: 'Wrong-code attempts allowed before an account-deletion code is rejected outright.' },
  deletion_whatsapp_resend_cooldown_seconds: { label: 'Deletion WhatsApp resend cooldown (sec)', description: 'Minimum wait between two account-deletion codes to the same number.' },
  account_deletion_grace_period_days: { label: 'Account deletion grace period (days)', description: "How long a deleted account's encrypted PII snapshot stays admin-recoverable before a cron job purges it permanently." },
};

// String-valued config, rendered with a text input rather than a number field.
// These are the values that used to live only in Coolify env vars -- moved to
// the DB (migration 028) so they're editable here and not tied to one host.
/**
 * Config keys whose value is NOT a number.
 *
 * The page used to render every key it did not explicitly know as a number
 * input seeded with Number(row.value). That is wrong for three real keys and
 * one of them was destructive:
 *   - gst_seller_gstin is "29AAAAA0000A1Z5"; Number() is NaN, so the field
 *     rendered EMPTY and one stray Save would have wiped the GSTIN printed on
 *     every invoice.
 *   - gst_seller_state_code is a STRING. "09" (Uttar Pradesh) through a number
 *     input becomes 9, never matches a buyer's "09" again, and charges IGST
 *     where CGST+SGST is due.
 *   - gst_prices_include_tax / gst_export_lut_filed are booleans. Stored as
 *     1/0 they are ignored by cfgBool(), which returns its fallback -- the
 *     toggle appeared to save and changed nothing.
 */
const BOOL_CONFIG_LABELS: Record<string, { label: string; description: string }> = {
  gst_prices_include_tax: {
    label: 'Prices include GST',
    description:
      'On: the price on a product is what the buyer pays, and tax is extracted from within it. Off: tax is added on top at checkout. Changing this changes every quoted price.',
  },
  gst_export_lut_filed: {
    label: 'Export LUT filed',
    description:
      'On if a Letter of Undertaking is on file, so exports are zero-rated without paying IGST upfront. Off means export invoices carry IGST that must later be reclaimed.',
  },
};

const STRING_CONFIG_LABELS: Record<string, { label: string; description: string }> = {
  whatsapp_otp_template: {
    label: 'WhatsApp OTP template name',
    description:
      'Exact name of the approved AUTHENTICATION template in WhatsApp Manager. When set, the profile form sends the code automatically; when empty, customers verify by sending "VERIFY".',
  },
  whatsapp_otp_template_language: {
    label: 'WhatsApp OTP template language',
    description: 'Language code the template was approved in, exactly as WhatsApp Manager shows it (e.g. en or en_US).',
  },
  gst_seller_gstin: {
    label: 'Seller GSTIN',
    description:
      'Our own GSTIN, printed on every invoice and used to derive the seller state. 15 characters. Never edit this to a blank value.',
  },
  gst_seller_state_code: {
    label: 'Seller state code',
    description:
      'First two digits of the GSTIN, as TEXT — 29 is Karnataka, 09 is Uttar Pradesh. The leading zero matters: it decides CGST+SGST versus IGST on every order.',
  },
  whatsapp_display_number: {
    label: 'WhatsApp business number',
    description: 'Digits only, no +. Drives every wa.me link on the site (chat button, CTAs, contact row, footer, tap-to-verify, tap-to-confirm-deletion). Must match the number the webhook is subscribed to.',
  },
  whatsapp_self_notify_number: {
    label: 'Escalation notify number',
    description: "Where bot escalation alerts are sent -- your own number, not the business WABA number.",
  },
  whatsapp_api_version: {
    label: 'Meta Graph API version',
    description: 'Graph API version used for WhatsApp send calls, e.g. v25.0.',
  },
};

export default async function AdminSettingsPage() {
  const [flags, config, socialLinks] = await Promise.all([
    query<FeatureFlagRow>(`SELECT key, enabled FROM public.feature_flags ORDER BY key`),
    query<AppConfigRow>(`SELECT key, value FROM public.app_config ORDER BY key`),
    query<SocialLinkRowData>(`SELECT platform, url, enabled FROM public.social_links ORDER BY platform`),
  ]);

  // Flags with a safe default are listed even before their seed row exists;
  // the first toggle creates the row (see CREATABLE_FLAGS in actions.ts).
  const FLAG_DEFAULTS: Record<string, boolean> = {
    profile_gate_customers: true,
    profile_gate_staff: false,
    whatsapp_otp_template_live: false,
  };
  for (const [key, enabled] of Object.entries(FLAG_DEFAULTS)) {
    if (!flags.some((f) => f.key === key)) flags.push({ key, enabled } as FeatureFlagRow);
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-ink">Settings</h1>
        <p className="text-faint mt-2">Manage your administrative access and VVC console security.</p>
      </div>

      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-8">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <svg className="h-5 w-5 text-saffron-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          Feature flags
        </h3>
        <p className="text-xs text-muted">
          Site-wide switches, controllable here without a code deploy. Changes take effect immediately.
        </p>
        <div className="space-y-3">
          {flags.map((flag) => {
            const meta = FLAG_LABELS[flag.key] ?? { label: flag.key, description: '' };
            return (
              <FeatureFlagToggle
                key={flag.key}
                flagKey={flag.key}
                label={meta.label}
                description={meta.description}
                initialEnabled={flag.enabled}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-8">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <svg className="h-5 w-5 text-saffron-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
          Operational config
        </h3>
        <p className="text-xs text-muted">
          OTP timings, rate limits, grace-period length — editable here without a code deploy (public.app_config,
          migration 023).
        </p>
        <div className="space-y-3">
          {config
            .filter((row) => !(row.key in STRING_CONFIG_LABELS))
            .map((row) => {
              // Booleans get a toggle. Anything else whose stored value is not
              // a number is rendered as text rather than forced through
              // Number(), which used to blank non-numeric values entirely.
              if (row.key in BOOL_CONFIG_LABELS || typeof row.value === 'boolean') {
                const meta = BOOL_CONFIG_LABELS[row.key] ?? { label: row.key, description: '' };
                return (
                  <AppConfigBoolInput
                    key={row.key}
                    configKey={row.key}
                    label={meta.label}
                    description={meta.description}
                    initialValue={Boolean(row.value)}
                  />
                );
              }
              const meta = CONFIG_LABELS[row.key] ?? { label: row.key, description: '' };
              if (typeof row.value !== 'number') {
                return (
                  <AppConfigTextInput
                    key={row.key}
                    configKey={row.key}
                    label={meta.label}
                    description={meta.description}
                    initialValue={String(row.value ?? '')}
                  />
                );
              }
              return (
                <AppConfigInput
                  key={row.key}
                  configKey={row.key}
                  label={meta.label}
                  description={meta.description}
                  initialValue={row.value}
                />
              );
            })}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-8">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <svg className="h-5 w-5 text-saffron-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
          WhatsApp numbers &amp; API
        </h3>
        <p className="text-xs text-muted">
          Previously hardcoded in <code className="font-mono">src/config/site.ts</code> and Coolify env vars —
          now editable here (public.app_config, migration 028), so changing the WABA number needs no code deploy
          and isn&apos;t tied to one host. Secrets (access token, webhook verify token) are managed at <a href="/admin/settings/secrets" className="font-semibold text-saffron-ink underline-offset-2 hover:underline">Settings → Secrets</a> — they cannot live in this table, because it is publicly readable.
        </p>
        <div className="space-y-3">
          {config
            .filter((row) => row.key in STRING_CONFIG_LABELS)
            .map((row) => {
              const meta = STRING_CONFIG_LABELS[row.key];
              return (
                <AppConfigTextInput
                  key={row.key}
                  configKey={row.key}
                  label={meta.label}
                  description={meta.description}
                  initialValue={String(row.value ?? '')}
                />
              );
            })}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-8">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <svg className="h-5 w-5 text-saffron-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342a4.001 4.001 0 000-2.684m0 2.684a4.001 4.001 0 010-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
          Social links
        </h3>
        <p className="text-xs text-muted">
          Footer icon URLs and per-platform visibility — editable here without a code deploy (public.social_links,
          migration 025).
        </p>
        <div className="space-y-2">
          {socialLinks.map((row) => (
            <SocialLinkRow
              key={row.platform}
              platform={row.platform}
              label={SOCIAL_LABELS[row.platform] ?? row.platform}
              initialUrl={row.url}
              initialEnabled={row.enabled}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-8">
        <h3 className="text-lg font-bold text-ink">Cache &amp; search engines</h3>
        <PurgeCacheButton />
        <SubmitSearchButton />
      </section>

      <section className="p-8 rounded-2xl bg-brand-bytes/5 border border-brand-bytes/10 space-y-4">
        <h3 className="text-lg font-bold text-ink uppercase tracking-wider">System Info</h3>
        <div className="grid grid-cols-2 text-sm">
           <span className="text-muted">Architecture</span>
           <span className="text-body">Self-hosted / MCP-first</span>
           <span className="text-muted">Core Version</span>
           <span className="font-mono text-green-ink">1.0.0-STABLE</span>
        </div>
      </section>
    </div>
  );
}
