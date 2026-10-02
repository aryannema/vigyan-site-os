'use client';

import { useState } from 'react';

interface Props {
  /** Which list. Must match the CHECK constraint in migration 077. */
  product: 'voice' | 'sample_product';
  /** Shown above the field. */
  label?: string;
  /** Optional free-text prompt. Omit it to keep the form to one field. */
  askNote?: string;
  /** Recorded for attribution — which page or campaign produced the signup. */
  source?: string;
}

/**
 * One-field waitlist capture, used on pre-launch product pages.
 *
 * Email only by default. Every extra field costs signups, and for a waitlist
 * the email is the only one that has to be there — a name you cannot email is
 * worth nothing, and you can ask for everything else once they reply to the
 * launch mail.
 *
 * `askNote` is opt-in per page because "what would you use it for" is the one
 * optional field that earns its place: it is what tells you whether the list is
 * the audience you assumed. On a page where you already know, leave it off.
 */
export default function WaitlistForm({ product, label, askNote, source }: Props) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('submitting');

    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          email: data.get('email'),
          fullName: data.get('fullName'),
          note: data.get('note'),
          source: source ?? product,
          // Honeypot — see the route. A real person never sees this field.
          website: data.get('website'),
        }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setStatus('success');
        setMessage(result.message ?? "You're on the list.");
      } else {
        setStatus('error');
        setMessage(result.error ?? 'Could not save that. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  if (status === 'success') {
    return (
      // role="status" so a screen reader announces the result without the user
      // having to go looking for it — the form they were focused on is gone.
      <div role="status" className="rounded-lg border border-[var(--vb-border)] p-5">
        <p className="font-medium">{message}</p>
        <p className="mt-1 text-sm opacity-75">
          One email when it ships. Nothing else, and nothing shared.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md">
      {label && (
        <label htmlFor={`wl-email-${product}`} className="mb-2 block text-sm font-medium">
          {label}
        </label>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={`wl-email-${product}`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          className="flex-1 rounded-md border border-[var(--vb-border)] px-3 py-2"
          disabled={status === 'submitting'}
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="rounded-md px-4 py-2 font-medium disabled:opacity-60"
          style={{ background: 'var(--vb-accent)', color: 'var(--vb-accent-ink)' }}
        >
          {status === 'submitting' ? 'Adding…' : 'Join the waitlist'}
        </button>
      </div>

      {/* Optional, and visibly so — an unlabelled optional field reads as
          required and costs completions. */}
      <input
        name="fullName"
        type="text"
        autoComplete="name"
        placeholder="Name (optional)"
        className="mt-3 w-full rounded-md border border-[var(--vb-border)] px-3 py-2"
        disabled={status === 'submitting'}
      />

      {askNote && (
        <textarea
          name="note"
          rows={2}
          placeholder={askNote}
          className="mt-3 w-full rounded-md border border-[var(--vb-border)] px-3 py-2"
          disabled={status === 'submitting'}
        />
      )}

      {/* Honeypot. Hidden from sight AND from assistive technology, and
          excluded from tab order — otherwise a keyboard or screen-reader user
          lands in it and gets silently discarded. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label htmlFor={`wl-website-${product}`}>Leave this empty</label>
        <input id={`wl-website-${product}`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p className="mt-3 text-sm opacity-75">
        One email when it ships. No newsletter, and we do not share your address.
      </p>

      {status === 'error' && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--vb-danger, #b3261e)' }}>
          {message}
        </p>
      )}
    </form>
  );
}
