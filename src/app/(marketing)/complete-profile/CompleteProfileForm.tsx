'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';
import { isValidPhone } from '@/lib/phone';
import { INDIAN_STATES } from '@/lib/gst';
import { Steps } from '@/components/ui/steps';

type Props = {
  initialFirstName: string;
  initialLastName: string;
  initialWhatsappNumber: string;
  initialWhatsappVerified: boolean;
  initialWhatsappOptIn: boolean;
  initialBillingCountry: string;
  initialBillingStateCode: string | null;
  initialTaxId: string | null;
  next: string;
  /** When set (the blocking gate), called on success instead of navigating. */
  onComplete?: () => void;
  /** Live WABA number, resolved server-side from public.app_config (migration
   * 028) and passed down -- a client component can't read the DB itself. */
  businessWhatsappNumber: string;
};

// Exact text logged to whatsapp_consent_log at the moment a number is
// submitted for verification (DPDP-style audit trail — see migration 019).
// Must stay in sync with what's actually shown below the phone field.
// The opt-out has to be stated where consent is TAKEN, not only in the privacy
// policy -- a person who never opens the policy is exactly the person who will
// otherwise reach for Block, and blocks are what collapse a WABA's quality
// rating. The exact wording is stored verbatim in whatsapp_consent_log, so
// changing this string changes the record of what future users agreed to.
const VERIFICATION_CONSENT_TEXT =
  "By continuing, you agree that YourSite may send a verification code to this WhatsApp number. " +
  "You can reply STOP on WhatsApp at any time to opt out.";

export default function CompleteProfileForm({
  initialFirstName,
  initialLastName,
  initialWhatsappNumber,
  initialWhatsappVerified,
  initialWhatsappOptIn,
  initialBillingCountry,
  initialBillingStateCode,
  initialTaxId,
  next,
  onComplete,
  businessWhatsappNumber,
}: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  // initialWhatsappNumber arrives digits-only (site_accounts' storage format,
  // matching Meta's webhook shape) — PhoneInput needs E.164 ("+91...") to
  // parse/display an initial value correctly.
  const [phone, setPhone] = useState<string | undefined>(
    initialWhatsappNumber ? `+${initialWhatsappNumber}` : undefined,
  );
  const [optIn, setOptIn] = useState(initialWhatsappOptIn);

  // Collected here rather than at checkout. GST is decided by place of supply,
  // so a purchase cannot be priced without it -- and asking at the payment step
  // is friction at the one moment it costs most. This form is already mandatory
  // and already asks for a verified WhatsApp number, which is considerably more
  // sensitive than which state someone is in, so two more fields here are
  // cheaper than an extra step later. GSTIN is NOT asked here: only business
  // buyers have one, and it would read as noise to everyone else.
  const [country, setCountry] = useState(initialBillingCountry || 'IN');
  const [stateCode, setStateCode] = useState(initialBillingStateCode ?? '');
  // Asked here rather than at checkout, but NOT required: an individual buying
  // Sample App has no GSTIN, and blocking registration on a field most people
  // cannot fill would stop ordinary customers signing up at all. Validated when
  // given, ignored when not.
  const [taxId, setTaxId] = useState(initialTaxId ?? '');

  // A GSTIN carries its own state in its first two digits. When it disagrees
  // with the state chosen above, one of them is wrong and we cannot know which,
  // so say so rather than silently picking one and printing it on an invoice.
  const taxIdError =
    country === 'IN' && taxId.trim()
      ? !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(taxId.trim().toUpperCase())
        ? 'That does not look like a valid 15-character GSTIN.'
        : stateCode && taxId.trim().slice(0, 2) !== stateCode
          ? `This GSTIN belongs to state ${taxId.trim().slice(0, 2)}, not the state selected above.`
          : ''
      : '';

  // Re-verification is only required if the number changed from the
  // already-verified one on file — editing name only, or leaving the same
  // verified number untouched, doesn't force a fresh verification round trip.
  // Compared in normalized (digits-only) form since `phone` carries a '+'
  // from PhoneInput while `initialWhatsappNumber` does not.
  const numberUnchanged =
    initialWhatsappVerified && Boolean(phone) && normalizeWhatsAppNumber(phone!) === initialWhatsappNumber;
  const [verifiedThisSession, setVerifiedThisSession] = useState(numberUnchanged);

  // 'entering': phone field + Continue button.
  // 'pending': number submitted (written to site_accounts + consent logged)
  //   — showing the tap-to-verify wa.me link and the code-entry field.
  const [stage, setStage] = useState<'entering' | 'pending'>('entering');
  const [otpCode, setOtpCode] = useState('');
  const [submittingNumber, setSubmittingNumber] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  // 'template': we sent the code (approved Authentication template).
  // 'verify-message': no template yet, the customer sends "VERIFY" first.
  const [delivery, setDelivery] = useState<'template' | 'verify-message'>('verify-message');
  const [resendIn, setResendIn] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const requestCode = async (number: string) => {
    setSendingCode(true);
    try {
      const res = await fetch('/api/profile/whatsapp/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: number }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.mode === 'verify-message') {
        setDelivery('verify-message');
        return;
      }
      setDelivery('template');
      if (!res.ok) {
        setError(data.error || 'Could not send the code — please try again.');
        if (data.retryAfter) setResendIn(data.retryAfter);
        return;
      }
      setError(null);
      setResendIn(data.resendAfterSeconds ?? 60);
    } finally {
      setSendingCode(false);
    }
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVerified = numberUnchanged || verifiedThisSession;

  const handlePhoneChange = (value: string | undefined) => {
    setPhone(value);
    setVerifiedThisSession(false);
    setStage('entering');
    setOtpCode('');
  };

  // Writes the pending (unverified) number onto site_accounts and records
  // the DPDP consent entry, then reveals the tap-to-verify link + code
  // field. No code is sent from here — the code only exists once the
  // customer's own "VERIFY" WhatsApp message reaches the webhook (see
  // api/webhook/whatsapp/route.ts's handleWhatsAppVerification()).
  const submitNumberForVerification = async () => {
    // Real per-country validation, not a length check. `phone.length < 8`
    // passed numbers that cannot exist -- e.g. +91974079662, nine digits after
    // the country code where an Indian mobile has ten. That wrote a pending
    // site_accounts row no inbound message could ever match, so the customer
    // tapped through, sent VERIFY from their actual number, hit the lookup
    // miss, and got the AI bot instead of a code with nothing explaining why.
    if (!phone || !isValidPhone(phone)) {
      setError('That does not look like a valid WhatsApp number — check the country and the digits.');
      return;
    }
    setError(null);
    setSubmittingNumber(true);
    try {
      const { createBrowserSupabaseClient } = await import('@/lib/supabase-browser');
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/account/register');
        return;
      }
      const normalized = normalizeWhatsAppNumber(phone);
      const { error: updateError } = await supabase
        .from('site_accounts')
        .update({ whatsapp_number: normalized, whatsapp_verified_at: null })
        .eq('user_id', user.id);
      if (updateError) {
        setError('Could not save your number — please try again.');
        return;
      }
      await supabase.from('whatsapp_consent_log').insert({
        user_id: user.id,
        phone_number: normalized,
        consent_text: VERIFICATION_CONSENT_TEXT,
      });
      setStage('pending');
      await requestCode(normalized);
    } finally {
      setSubmittingNumber(false);
    }
  };

  const verifyCode = async () => {
    if (!otpCode || otpCode.length < 4) {
      setError('Enter the code you received on WhatsApp.');
      return;
    }
    setError(null);
    setVerifyingOtp(true);
    try {
      const res = await fetch('/api/profile/whatsapp/verify-otp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Incorrect code.');
        return;
      }
      setVerifiedThisSession(true);
    } finally {
      setVerifyingOtp(false);
    }
  };

  // An Indian user without a state cannot be priced correctly, so it is
  // required here rather than chased at checkout.
  const locationComplete = country !== 'IN' || Boolean(stateCode);

  // Derived from what is actually filled in, not tracked separately -- a
  // progress bar that can disagree with the form is worse than none. The
  // current step is the first incomplete one; when all are done it settles on
  // the last rather than running off the end.
  const nameComplete = Boolean(firstName.trim() && lastName.trim());
  const currentStep = !nameComplete ? 0 : !isVerified ? 1 : 2;
  const canSubmit =
    Boolean(firstName.trim() && lastName.trim() && isVerified) &&
    locationComplete &&
    !taxIdError &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const { createBrowserSupabaseClient } = await import('@/lib/supabase-browser');
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/account/register');
        return;
      }
      const { error: updateError } = await supabase
        .from('site_accounts')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          whatsapp_opt_in: optIn,
        })
        .eq('user_id', user.id);
      if (updateError) {
        setError('Could not save — please try again.');
        return;
      }
      if (onComplete) onComplete();
      else router.push(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="vb-card space-y-5 p-8 shadow-warm-md">
      <Steps
        className="mb-2 border-b border-hairline pb-6"
        current={currentStep}
        steps={[
          { id: 'name', label: 'Your name', hint: 'How we address you' },
          { id: 'whatsapp', label: 'Verify WhatsApp', hint: 'A code, once' },
          { id: 'location', label: 'Billing location', hint: 'For correct tax' },
        ]}
      />
      {error && (
        <div role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-bold text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">First name</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Last name</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-muted">WhatsApp number</label>
        <PhoneInput
          international
          defaultCountry="IN"
          value={phone}
          onChange={handlePhoneChange}
          placeholder="Enter WhatsApp number"
          className="phone-input-complete-profile"
        />

        {isVerified ? (
          <p className="mt-2 text-xs font-bold text-green-600">✓ Verified</p>
        ) : stage === 'entering' ? (
          <>
            <p className="mt-2 text-[11px] leading-snug text-muted">{VERIFICATION_CONSENT_TEXT}</p>
            <button
              type="button"
              onClick={submitNumberForVerification}
              disabled={submittingNumber || !phone}
              className="mt-2 text-xs font-bold text-saffron-ink hover:underline disabled:opacity-50"
            >
              {submittingNumber ? 'Saving…' : 'Continue'}
            </button>
          </>
        ) : (
          <div className="mt-3 space-y-3">
            {delivery === 'template' ? (
              <p className="text-[11px] leading-snug text-muted">
                {sendingCode
                  ? 'Sending a code to your WhatsApp…'
                  : 'We sent a 6-digit code to this number on WhatsApp. Enter it below — it expires in 10 minutes.'}
              </p>
            ) : (
            <>
            <a
              href={`https://wa.me/${businessWhatsappNumber}?text=VERIFY`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-card bg-saffron-500 px-4 py-2.5 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04]"
            >
              Tap to verify on WhatsApp
            </a>
            <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-muted">
              <li>Tap the button — WhatsApp opens with &quot;VERIFY&quot; already typed.</li>
              <li>Press send. Use the WhatsApp account of the number above.</li>
              <li>We reply within seconds with a 6-digit code — enter it below.</li>
            </ol>
            <p className="text-[11px] leading-snug text-faint">
              No reply after a minute? Check you sent it from {phone ?? 'this number'}, then send VERIFY again.
            </p>
            </>
            )}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
            />
            <button
              type="button"
              onClick={verifyCode}
              disabled={verifyingOtp || otpCode.length < 4}
              className="rounded-card bg-saffron-500 px-4 py-2 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:opacity-60"
            >
              {verifyingOtp ? 'Verifying…' : 'Verify'}
            </button>
            {delivery === 'template' && (
              <button
                type="button"
                onClick={() => phone && requestCode(normalizeWhatsAppNumber(phone))}
                disabled={sendingCode || resendIn > 0}
                className="ml-3 text-xs font-bold text-saffron-ink hover:underline disabled:text-faint disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            )}
          </div>
        )}
      </div>

      <label className="flex items-start gap-2 text-xs text-body">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
          className="mt-0.5"
        />
        Send me updates on WhatsApp (offers, blog posts, product news)
      </label>

      <p className="text-center text-[11px] leading-snug text-muted">
        By continuing, you agree to our{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-bold text-saffron-ink hover:underline">
          Privacy Policy
        </a>
        .
      </p>

      {/* Billing location — required, because GST is decided by place of supply:
          outside India is a zero-rated export, our own state is CGST+SGST, any
          other Indian state is IGST. Asked once, here, so checkout never has to. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="billing-country" className="text-sm font-semibold text-ink">
            Country
          </label>
          <select
            id="billing-country"
            value={country}
            onChange={(e) => { setCountry(e.target.value); setStateCode(''); }}
            className="rounded-ui-md border border-input bg-card px-3.5 py-3 text-sm text-ink outline-none focus:border-primary"
          >
            <option value="IN">India</option>
            <option value="OTHER">Outside India</option>
          </select>
        </div>

        {country === 'IN' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="billing-state" className="text-sm font-semibold text-ink">
              State
            </label>
            <select
              id="billing-state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="rounded-ui-md border border-input bg-card px-3.5 py-3 text-sm text-ink outline-none focus:border-primary"
            >
              <option value="">Select your state…</option>
              {INDIAN_STATES.map((st) => (
                <option key={st.code} value={st.code}>{st.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="-mt-1 text-xs text-muted">
        Used to apply the correct tax on anything you buy. Nothing else.
      </p>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-card bg-saffron-500 py-3.5 text-sm font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save & continue'}
      </button>

      <style dangerouslySetInnerHTML={{ __html: `
        .phone-input-complete-profile { display: flex; align-items: center; gap: 8px; }
        .phone-input-complete-profile .PhoneInputInput {
          flex: 1; background: var(--bg-alt, transparent); border: 1px solid var(--border-strong, #d6d3d1);
          border-radius: 8px; padding: 10px 14px; font-size: 14px; outline: none;
        }
        .phone-input-complete-profile .PhoneInputInput:focus { border-color: #f59e0b; }
      `}} />
    </form>
  );
}
