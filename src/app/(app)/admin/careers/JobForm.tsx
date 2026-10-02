'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  JOB_EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  WORKPLACE_TYPES,
  JOB_STATUSES,
  SALARY_PERIODS,
} from '@/lib/careers-schema';
import { createJob, updateJob } from './actions';

export interface JobFormValues {
  title: string;
  slug: string;
  department: string;
  location: string;
  employment_type: string;
  workplace_type: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_period: string;
  description: string;
  responsibilities: string;
  requirements: string;
  apply_url: string;
  apply_email: string;
  valid_through: string;
  status: string;
}

interface JobFormProps {
  mode: 'create' | 'edit';
  jobId?: string;
  defaultValues?: Partial<JobFormValues>;
}

function slugify(text: string) {
  return text.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

const fieldCls =
  'w-full bg-sand border border-hairline rounded-lg text-xs p-2.5 focus:border-brand-primary outline-none text-ink';

export default function JobForm({ mode, jobId, defaultValues }: JobFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [title, setTitle] = useState(defaultValues?.title ?? '');
  const [slug, setSlug] = useState(defaultValues?.slug ?? '');

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (mode === 'create') setSlug(slugify(val));
  };

  const submit = (status: string) => {
    setError('');
    setSuccess('');
    startTransition(async () => {
      try {
        const form = document.getElementById('job-form') as HTMLFormElement;
        const data = new FormData(form);
        data.set('status', status);
        if (mode === 'create') {
          await createJob(data);
          setSuccess('Opening created!');
          router.push('/admin/careers');
        } else if (jobId) {
          await updateJob(jobId, data);
          setSuccess('Opening updated!');
          router.refresh();
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  };

  return (
    <form id="job-form" onSubmit={(e) => e.preventDefault()} className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
      {/* Main */}
      <div className="space-y-5">
        <input
          type="text"
          name="title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Role title — e.g. AI Architect Intern"
          required
          className="w-full border-none bg-transparent p-0 text-3xl font-extrabold text-ink outline-none placeholder:text-faint focus:ring-0"
        />

        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase text-muted">Job description (JD)</span>
          <textarea
            name="description"
            defaultValue={defaultValues?.description ?? ''}
            placeholder="Describe the role, the team, what they'll build…"
            required
            className="min-h-[260px] w-full resize-none rounded-2xl border border-hairline bg-surface p-5 text-sm leading-relaxed text-body outline-none focus:border-brand-primary"
          />
        </label>

        <div className="grid gap-5 md:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Responsibilities (one per line)</span>
            <textarea
              name="responsibilities"
              defaultValue={defaultValues?.responsibilities ?? ''}
              rows={5}
              className="w-full resize-none rounded-xl border border-hairline bg-surface p-3 text-xs leading-relaxed text-body outline-none focus:border-brand-primary"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Requirements (one per line)</span>
            <textarea
              name="requirements"
              defaultValue={defaultValues?.requirements ?? ''}
              rows={5}
              className="w-full resize-none rounded-xl border border-hairline bg-surface p-3 text-xs leading-relaxed text-body outline-none focus:border-brand-primary"
            />
          </label>
        </div>

        {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-600">{error}</div>}
        {success && <div className="rounded-lg border border-green-700/20 bg-green-700/10 p-3 text-xs font-bold text-green-ink">{success}</div>}
      </div>

      {/* Sidebar */}
      <div className="space-y-5">
        <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-ink">Posting</h3>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">URL Slug</span>
            <input type="text" name="slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} required className={`${fieldCls} font-mono`} />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Employment type</span>
            <select name="employment_type" defaultValue={defaultValues?.employment_type ?? 'FULL_TIME'} className={fieldCls}>
              {JOB_EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Workplace</span>
            <select name="workplace_type" defaultValue={defaultValues?.workplace_type ?? 'on-site'} className={fieldCls}>
              {WORKPLACE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Department</span>
            <input type="text" name="department" defaultValue={defaultValues?.department ?? ''} placeholder="Engineering" className={fieldCls} />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Location</span>
            <input type="text" name="location" defaultValue={defaultValues?.location ?? ''} placeholder="Bangalore, India" className={fieldCls} />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Status</span>
            <select name="status" defaultValue={defaultValues?.status ?? 'open'} className={fieldCls}>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-ink">Compensation</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-muted">Pay min</span>
              <input type="number" name="salary_min" defaultValue={defaultValues?.salary_min ?? ''} min={0} className={fieldCls} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-muted">Pay max</span>
              <input type="number" name="salary_max" defaultValue={defaultValues?.salary_max ?? ''} min={0} className={fieldCls} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-muted">Currency</span>
              <input type="text" name="salary_currency" defaultValue={defaultValues?.salary_currency ?? 'INR'} maxLength={8} className={fieldCls} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-muted">Period</span>
              <select name="salary_period" defaultValue={defaultValues?.salary_period ?? 'YEAR'} className={fieldCls}>
                {SALARY_PERIODS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-hairline bg-surface p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-ink">How to apply</h3>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Apply URL</span>
            <input type="url" name="apply_url" defaultValue={defaultValues?.apply_url ?? ''} placeholder="https://…" className={fieldCls} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Apply email</span>
            <input type="email" name="apply_email" defaultValue={defaultValues?.apply_email ?? ''} placeholder="hello@example.com" className={fieldCls} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase text-muted">Valid through</span>
            <input type="date" name="valid_through" defaultValue={defaultValues?.valid_through ?? ''} className={fieldCls} />
          </label>
        </section>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => submit('draft')}
            disabled={isPending}
            className="flex-1 rounded-xl border border-hairline bg-sand py-2.5 text-sm font-bold text-body transition hover:bg-well disabled:opacity-50"
          >
            {isPending ? '…' : 'Save Draft'}
          </button>
          <button
            type="button"
            onClick={() => submit('open')}
            disabled={isPending}
            className="flex-1 rounded-xl bg-brand-primary py-2.5 text-sm font-bold text-[#1c1814] shadow-lg shadow-brand-primary/20 transition hover:brightness-110 disabled:opacity-50"
          >
            {isPending ? '…' : 'Publish'}
          </button>
        </div>
      </div>
    </form>
  );
}
