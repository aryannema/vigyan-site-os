'use client';

import { useState } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';

type Props = {
  initialStatus: string | null;
  /** Live WABA number, resolved server-side from public.app_config (migration
   * 028) -- a client component can't read the DB itself. */
  businessWhatsappNumber: string;
};

export default function DeletionRequestForm({ initialStatus, businessWhatsappNumber }: Props) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [otpCode, setOtpCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeResult, setCodeResult] = useState<'idle' | 'confirmed' | 'completed'>('idle');

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !phone) return;
    setSubmitting(true);
    try {
      await fetch('/api/account-deletion/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone_number: phone }),
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async () => {
    if (!phone || otpCode.length < 4) return;
    setCodeError(null);
    setVerifyingCode(true);
    try {
      const res = await fetch('/api/account-deletion/verify-whatsapp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCodeError(data.error || 'Incorrect code.');
        return;
      }
      setCodeResult(data.completed ? 'completed' : 'confirmed');
    } finally {
      setVerifyingCode(false);
    }
  };

  return (
    <div className="vb-card space-y-5 p-8 shadow-warm-md">
      {initialStatus === 'completed' && (
        <div className="rounded-md border border-green-500/20 bg-green-500/10 p-3 text-center text-xs font-bold text-green-700">
          Your account has been deleted.
        </div>
      )}
      {initialStatus === 'email-confirmed' && (
        <div className="rounded-md border border-hairline-strong bg-surface p-3 text-center text-xs font-bold text-ink">
          Email confirmed. Now message our WhatsApp number &quot;DELETE&quot; and enter the code below to finish.
        </div>
      )}
      {(initialStatus === 'expired' || initialStatus === 'invalid' || initialStatus === 'error') && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-bold text-red-600">
          That confirmation link is invalid or has expired — please submit the request again below.
        </div>
      )}

      {codeResult === 'completed' ? (
        <div className="rounded-md border border-green-500/20 bg-green-500/10 p-3 text-center text-xs font-bold text-green-700">
          Your account has been deleted.
        </div>
      ) : !submitted ? (
        <form onSubmit={submitRequest} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Email on your account</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-saffron-500/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">WhatsApp number on your account</label>
            <PhoneInput
              international
              defaultCountry="IN"
              value={phone}
              onChange={setPhone}
              placeholder="Enter WhatsApp number"
              className="phone-input-complete-profile"
            />
          </div>
          <p className="text-[11px] leading-snug text-muted">
            Both must match one account. We&apos;ll only delete anything once you&apos;ve confirmed via a link we
            email you AND a code we send on WhatsApp.
          </p>
          <button
            type="submit"
            disabled={submitting || !email || !phone}
            className="w-full rounded-card bg-red-600 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Request account deletion'}
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
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            If that email and WhatsApp number match an account, we&apos;ve sent a confirmation link to that email.
          </p>

          <div className="space-y-3 border-t border-hairline pt-4">
            <p className="text-xs font-bold text-muted">Step 2: confirm on WhatsApp</p>
            <a
              href={`https://wa.me/${businessWhatsappNumber}?text=DELETE`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-card bg-red-600 px-4 py-2.5 text-xs font-bold text-white transition hover:brightness-110"
            >
              Tap to confirm on WhatsApp
            </a>
            {codeError && (
              <div role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-600">
                {codeError}
              </div>
            )}
            {codeResult === 'confirmed' ? (
              <p className="text-xs font-bold text-green-700">
                WhatsApp confirmed. Waiting on your email confirmation to complete deletion.
              </p>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full rounded-card border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-red-500/60"
                />
                <button
                  type="button"
                  onClick={submitCode}
                  disabled={verifyingCode || otpCode.length < 4}
                  className="rounded-card bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {verifyingCode ? 'Verifying…' : 'Confirm code'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
