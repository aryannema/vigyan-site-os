'use client';

import { useState } from 'react';
import { siteConfig } from '@/config/site';

interface Props {
  blueprintId: string;
  title: string;
  /** Live WABA number for display, resolved server-side from public.app_config
   * (migration 028). Falls back to siteConfig when not supplied. */
  senderNumber?: string;
}

export default function BlueprintRequestForm({ blueprintId, title, senderNumber = '' }: Props) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('submitting');

    const formData = new FormData(e.currentTarget);
    const payload = {
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      email: formData.get('email'),
      phone: formData.get('whatsapp'),
      whatsappOptIn: formData.get('whatsappOptIn') === 'on',
      message: `Blueprint request: ${title} (${blueprintId})`,
    };

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (response.ok) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(result.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Failed to connect to the server.');
    }
  };

  if (status === 'success') {
    return (
      <div className="p-8 bg-brand-bytes/10 border border-brand-bytes/20 rounded-2xl text-center">
        <h3 className="text-xl font-bold text-white">Blueprint Requested</h3>
        <p className="text-slate-300 mt-2">We&apos;ll follow up by email — and on WhatsApp too, if you opted in.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 p-8 bg-white/5 border border-white/10 rounded-3xl backdrop-blur">
      <h3 className="text-lg font-bold text-white">Get {title}</h3>
      <div className="grid grid-cols-2 gap-4">
        <input name="firstName" required placeholder="First Name" className="w-full bg-slate-900 rounded-lg p-3 border border-white/10" />
        <input name="lastName" required placeholder="Last Name" className="w-full bg-slate-900 rounded-lg p-3 border border-white/10" />
      </div>
      <input name="email" required type="email" placeholder="Work Email" className="w-full bg-slate-900 rounded-lg p-3 border border-white/10" />
      <input name="whatsapp" required type="tel" placeholder="WhatsApp Number" className="w-full bg-slate-900 rounded-lg p-3 border border-white/10" />
      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input name="whatsappOptIn" type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 shrink-0 accent-brand-primary" />
        <span>Send the blueprint link to my WhatsApp above ({senderNumber || siteConfig.links.contact.whatsapp} will be the sender).</span>
      </label>
      {status === 'error' && <p className="text-sm text-red-400">{errorMessage}</p>}
      <button
        disabled={status === 'submitting'}
        className="w-full py-3 bg-brand-primary rounded-xl font-bold text-slate-950 hover:brightness-110 transition disabled:opacity-60"
      >
        {status === 'submitting' ? 'Processing...' : 'Request Blueprint'}
      </button>
    </form>
  );
}
