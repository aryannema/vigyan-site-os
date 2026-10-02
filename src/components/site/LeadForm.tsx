'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PhoneInput, { getCountryCallingCode } from 'react-phone-number-input';
import { isValidPhone } from '@/lib/phone';
import 'react-phone-number-input/style.css';
import { IconLoader2, IconCircleCheck, IconAlertCircle } from '@tabler/icons-react';
import { siteConfig } from '@/config/site';

// Local definition of CountryCode if import fails
type CountryCode = string; 

export type LeadFormVariant = 'inquiry' | 'checkout';

const identityFields = {
  firstName: z.string().min(1, { message: 'First name is required.' }),
  lastName: z.string().min(1, { message: 'Last name is required.' }),
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  phone: z
    .string()
    .refine((v) => !v || isValidPhone(v), {
      message: 'Please enter a valid phone number, including the country code.',
    }),
  whatsappOptIn: z.boolean(),
};

// Opting in to WhatsApp needs a number that can actually receive one. The old
// rule was `phone.length >= 5`, which accepted numbers that cannot exist and
// turned the opt-in into a promise we could never keep.
const whatsappNeedsPhone = (data: { whatsappOptIn: boolean; phone: string }) =>
  !data.whatsappOptIn || isValidPhone(data.phone);

const whatsappNeedsPhoneError = {
  message: 'A valid WhatsApp number, with country code, is required to opt in.',
  path: ['phone'],
};

const inquirySchema = z
  .object({
    ...identityFields,
    message: z.string().min(10, { message: 'Please tell us a bit more (at least 10 characters).' }),
  })
  .refine(whatsappNeedsPhone, whatsappNeedsPhoneError);

const checkoutSchema = z
  .object({
    ...identityFields,
    message: z.string().optional(),
  })
  .refine(whatsappNeedsPhone, whatsappNeedsPhoneError);

type FormData = z.infer<typeof checkoutSchema>;

interface CountryOption {
  label: string;
  value: CountryCode;
}

interface CustomCountrySelectProps {
  value?: CountryCode;
  onChange: (value: CountryCode) => void;
  options: CountryOption[];
  disabled?: boolean;
}

const CustomCountrySelect = ({ value, onChange, options, disabled }: CustomCountrySelectProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);
  const filteredOptions = options.filter((opt) => 
    opt.label.toLowerCase().includes(search.toLowerCase()) || 
    (opt.value && opt.value.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-w-[80px] items-center gap-2 rounded-md border border-hairline-strong bg-sand px-3 py-3 text-sm transition-colors hover:border-saffron-500 disabled:opacity-50"
      >
        {selectedOption ? (
          <span className="font-bold text-ink">{selectedOption.value}</span>
        ) : (
          <span className="text-muted">...</span>
        )}
        <svg className={`h-4 w-4 text-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-card border border-hairline bg-surface p-2 shadow-warm-lg">
          <div className="mb-2 p-1">
            <input
              autoFocus
              type="text"
              placeholder="Search country..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md bg-sand px-3 py-2 text-sm text-ink outline-none focus:ring-1 focus:ring-saffron-500"
            />
          </div>
          <div className="max-h-[250px] overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value || 'ZZ'}
                  type="button"
                  onClick={() => {
                    if (opt.value) {
                      onChange(opt.value);
                    }
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-sand ${opt.value === value ? 'bg-saffron-500/10 font-bold text-saffron-ink' : 'text-body'}`}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.value && (
                    <span className="font-mono text-xs text-faint">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      + {getCountryCallingCode(opt.value as any)}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-sm text-muted">No results found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface LeadFormProps {
  config?: {
    title: string;
    description: string;
  };
  submitConfig?: {
    label: string;
    successTitle: string;
    successMessage: string;
  };
  variant?: LeadFormVariant;
  /** Admin-controlled (public.feature_flags 'whatsapp_live') -- passed down
   * from the Server Component parent since this is a client component and
   * can't read the DB flag itself. Defaults to false (fail closed). */
  whatsappLive?: boolean;
  /** Live WABA number (formatted for display), resolved server-side from
   * public.app_config (migration 028) -- a client component can't read the DB. */
  senderNumber?: string;
}

export default function LeadForm({ config, submitConfig, variant = 'inquiry', whatsappLive = false, senderNumber = '' }: LeadFormProps) {
  const isCheckout = variant === 'checkout';
  const [status, setStatus] = React.useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [apiMessage, setApiMessage] = React.useState('');

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(isCheckout ? checkoutSchema : inquirySchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      whatsappOptIn: false,
      message: '',
    },
  });

  const whatsappOptIn = watch('whatsappOptIn');

  const onSubmit = async (data: FormData) => {
    setStatus('submitting');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        setStatus('success');
        setApiMessage(result.message || submitConfig?.successMessage || 'Thank you! Your message has been received.');
      } else {
        setStatus('error');
        setApiMessage(result.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setApiMessage('Failed to connect to the server.');
    }
  };

  if (status === 'success') {
    return (
      <div className="vb-card border-green-700/20 p-10 text-center shadow-glow-green">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-700/12 text-green-ink">
          <IconCircleCheck size={64} stroke={2} />
        </div>
        <h3 className="text-2xl font-bold text-ink">{submitConfig?.successTitle || 'Message Sent!'}</h3>
        <p className="mx-auto mt-4 max-w-sm text-muted">{apiMessage}</p>
        <button
          onClick={() => {
            reset();
            setStatus('idle');
          }}
          className="mt-8 rounded-card bg-saffron-500 px-8 py-3 font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition hover:brightness-[1.04]"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="vb-card grid gap-6 p-6 shadow-warm-md md:p-8">
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-ink">{config?.title || 'Start your project'}</h3>
        <p className="text-sm text-muted">{config?.description || 'Share your requirements and we’ll respond with a roadmap.'}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">First Name</label>
          <input
            {...register('firstName')}
            disabled={status === 'submitting'}
            placeholder="First"
            className="w-full rounded-md border border-hairline-strong bg-sand px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-saffron-500 disabled:opacity-50"
          />
          {errors.firstName && <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase flex items-center gap-1"><IconAlertCircle size={12} /> {errors.firstName.message}</p>}
        </div>
        <div className="grid gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">Last Name</label>
          <input
            {...register('lastName')}
            disabled={status === 'submitting'}
            placeholder="Last"
            className="w-full rounded-md border border-hairline-strong bg-sand px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-saffron-500 disabled:opacity-50"
          />
          {errors.lastName && <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase flex items-center gap-1"><IconAlertCircle size={12} /> {errors.lastName.message}</p>}
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">Email Address</label>
        <input
          {...register('email')}
          disabled={status === 'submitting'}
          placeholder="you@example.com"
          className="w-full rounded-md border border-hairline-strong bg-sand px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-saffron-500 disabled:opacity-50"
        />
        {errors.email && <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase flex items-center gap-1"><IconAlertCircle size={12} /> {errors.email.message}</p>}
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">Phone Number</label>
        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <PhoneInput
              {...field}
              disabled={status === 'submitting'}
              placeholder="Enter phone number"
              defaultCountry="IN"
              className="phone-input-custom"
              countrySelectComponent={CustomCountrySelect}
            />
          )}
        />
        {errors.phone && <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase flex items-center gap-1"><IconAlertCircle size={12} /> {errors.phone.message}</p>}
      </div>

      {whatsappLive && (
        <label className="flex items-start gap-3 rounded-md border border-hairline-strong bg-sand px-4 py-3 text-sm text-body">
          <input
            {...register('whatsappOptIn')}
            type="checkbox"
            disabled={status === 'submitting'}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline-strong accent-saffron-500"
          />
          <span>
            Message me updates on WhatsApp at the number above ({senderNumber} will be the sender).
            {whatsappOptIn && <span className="mt-1 block text-xs text-muted">We&apos;ll only use this for replies to this inquiry.</span>}
          </span>
        </label>
      )}

      {!isCheckout && (
        <div className="grid gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">Message</label>
          <textarea
            {...register('message')}
            rows={4}
            disabled={status === 'submitting'}
            placeholder="Tell us about your AI architecture needs..."
            className="w-full resize-none rounded-md border border-hairline-strong bg-sand px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-saffron-500 disabled:opacity-50"
          />
          {errors.message && <p className="text-[10px] text-red-500 dark:text-red-400 font-bold uppercase flex items-center gap-1"><IconAlertCircle size={12} /> {errors.message.message}</p>}
        </div>
      )}

      {status === 'error' && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold flex items-center gap-2">
          <IconAlertCircle size={16} />
          <span>{apiMessage}</span>
        </div>
      )}

      <button 
        type="submit" 
        disabled={status === 'submitting'}
        className="mt-2 inline-flex h-[56px] w-full items-center justify-center gap-2 rounded-card bg-saffron-500 px-6 py-4 text-sm font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === 'submitting' ? (
          <>
            <IconLoader2 className="animate-spin" size={20} />
            <span>{isCheckout ? 'Processing...' : 'Processing Inquiry...'}</span>
          </>
        ) : (
          submitConfig?.label || (isCheckout ? 'Continue' : 'Submit Inquiry')
        )}
      </button>

      <style dangerouslySetInnerHTML={{ __html: `
        .phone-input-custom { display: flex; align-items: center; gap: 8px; }
        .phone-input-custom .PhoneInputInput { flex: 1; background: var(--bg-alt); border: 1px solid var(--border-strong); border-radius: 8px; padding: 12px 16px; font-size: 14px; color: var(--text-strong); outline: none; transition: all 0.2s; }
        .phone-input-custom .PhoneInputInput::placeholder { color: var(--text-faint); }
        .phone-input-custom .PhoneInputInput:focus { border-color: #f59e0b; }
      ` }} />
    </form>
  );
}
