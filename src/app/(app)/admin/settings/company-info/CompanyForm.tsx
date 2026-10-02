'use client';

import { useActionState, useState } from 'react';

import { INDIAN_STATES } from '@/lib/gst';
import { validateCompany, type CompanyProfile } from '@/lib/company';

import { SubmitButton } from '../../components/SubmitButton';
import type { FormState } from '../../lib/form';

/**
 * Company identity form.
 *
 * Validates through the SAME validateCompany() the server action runs, so a
 * rule is written once. The client copy is for immediate feedback; the server
 * copy is the one that actually decides.
 */

function Field({
  name, label, value, onChange, error, hint, placeholder, mono, wide,
}: {
  name: string; label: string; value: string;
  onChange: (v: string) => void;
  error?: string; hint?: string; placeholder?: string; mono?: boolean; wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={name} className="text-[13px] font-semibold text-ink">{label}</label>
      <input
        id={name}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`${name}-hint`}
        className={`rounded-ui-md border bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary ${
          error ? 'border-red-500' : 'border-input'
        } ${mono ? 'font-mono' : ''}`}
      />
      <span id={`${name}-hint`} className={`min-h-4 text-xs ${error ? 'text-red-600' : 'text-muted'}`}>
        {error || hint || ''}
      </span>
    </div>
  );
}

export function CompanyForm({
  company,
  action,
}: {
  company: CompanyProfile;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(company).map(([k, val]) => [k, val == null ? '' : String(val)])),
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = (k: string) => (val: string) => {
    setV((p) => ({ ...p, [k]: val }));
    setTouched((t) => ({ ...t, [k]: true }));
  };

  const errors = validateCompany(v as Partial<CompanyProfile>);
  const show = (k: string) => (touched[k] ? errors[k] : undefined) ?? state.fieldErrors?.[k];

  return (
    <form action={formAction} className="space-y-8">
      {state.error && (
        <p role="alert" className="rounded-ui-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-ui-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm font-semibold text-green-700">
          {state.success}
        </p>
      )}

      <fieldset className="rounded-ui-lg border border-input p-5">
        <legend className="px-2 text-[13px] font-semibold text-ink">Identity</legend>
        <p className="mb-4 text-xs text-muted">
          The registered name appears on every invoice and legal page. The trading name is
          what visitors see.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="legal_name" label="Registered name" value={v.legal_name} onChange={set('legal_name')} error={show('legal_name')} wide
                 placeholder="YourSite Solutions Private Limited" />
          <Field name="brand_name" label="Trading name" value={v.brand_name} onChange={set('brand_name')} error={show('brand_name')}
                 hint="What the site calls itself." />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="entity_type" className="text-[13px] font-semibold text-ink">Entity type</label>
            <select id="entity_type" name="entity_type" value={v.entity_type} onChange={(e) => set('entity_type')(e.target.value)}
                    className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary">
              <option value="private_limited">Private Limited</option>
              <option value="llp">LLP</option>
              <option value="proprietorship">Proprietorship</option>
              <option value="partnership">Partnership</option>
            </select>
            <span className="min-h-4 text-xs text-muted">Decides which identifiers are required.</span>
          </div>
          <Field name="gstin" label="GSTIN" value={v.gstin} onChange={set('gstin')} error={show('gstin')} mono
                 placeholder="29AAAAA0000A1Z5" hint="Printed on every invoice. Its first two digits must match the state below." />
          <Field name="cin" label="CIN" value={v.cin} onChange={set('cin')} error={show('cin')} mono
                 placeholder="U00000KA2026PTC000000" hint="Required on a private limited company's documents." />
          <Field name="pan" label="PAN" value={v.pan} onChange={set('pan')} error={show('pan')} mono
                 placeholder="AAMCV3593N" hint="Optional. Not printed publicly." />
        </div>
      </fieldset>

      <fieldset className="rounded-ui-lg border border-input p-5">
        <legend className="px-2 text-[13px] font-semibold text-ink">Registered address</legend>
        <p className="mb-4 text-xs text-muted">
          The state decides GST: a buyer in this state pays CGST + SGST, anyone else in India
          pays IGST. Getting it wrong makes every invoice wrong.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="address_line1" label="Address line 1" value={v.address_line1} onChange={set('address_line1')} wide />
          <Field name="address_line2" label="Address line 2" value={v.address_line2} onChange={set('address_line2')} wide />
          <Field name="city" label="City" value={v.city} onChange={set('city')} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="state_code" className="text-[13px] font-semibold text-ink">State</label>
            <select id="state_code" name="state_code" value={v.state_code} onChange={(e) => set('state_code')(e.target.value)}
                    className="rounded-ui-md border border-input bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary">
              <option value="">Select…</option>
              {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
            </select>
            <span className="min-h-4 text-xs text-muted">Our place of supply.</span>
          </div>
          <Field name="postal_code" label="PIN code" value={v.postal_code} onChange={set('postal_code')} error={show('postal_code')} placeholder="560001" />
          <Field name="country" label="Country" value={v.country} onChange={set('country')} hint="ISO code. IN for India." />
        </div>
      </fieldset>

      <fieldset className="rounded-ui-lg border border-input p-5">
        <legend className="px-2 text-[13px] font-semibold text-ink">Contact and map</legend>
        <p className="mb-4 text-xs text-muted">
          The phone number here is the <strong>voice line</strong>. The WhatsApp number is separate
          and lives in WhatsApp settings — they are deliberately different numbers.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="email" label="Email" value={v.email} onChange={set('email')} error={show('email')} />
          <Field name="phone" label="Voice phone" value={v.phone} onChange={set('phone')} placeholder="+919000000000" mono />
          <Field name="map_link_url" label="Google Maps link" value={v.map_link_url} onChange={set('map_link_url')} error={show('map_link_url')} wide
                 hint="A plain share link. Needs no API key and costs nothing." />
          <Field name="map_embed_url" label="Google Maps embed URL" value={v.map_embed_url} onChange={set('map_embed_url')} error={show('map_embed_url')} wide
                 hint="Optional. Maps → Share → Embed a map → copy the src. The Embed API is free and unlimited; no billing account needed." />
        </div>

        {v.map_embed_url && !errors.map_embed_url && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-muted">Preview</p>
            <iframe
              src={v.map_embed_url}
              title="Registered address"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-56 w-full rounded-ui-md border border-hairline"
            />
          </div>
        )}
      </fieldset>

      <SubmitButton disabled={Object.keys(errors).length > 0}>Save company details</SubmitButton>
    </form>
  );
}
