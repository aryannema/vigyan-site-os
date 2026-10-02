import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import JobForm, { JobFormValues } from '../../JobForm';
import { JobOpening } from '@/lib/careers-schema';


export const dynamic = 'force-dynamic';
async function getJob(id: string): Promise<JobOpening | null> {
  const { data, error } = await supabaseAdmin.from('job_openings').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as JobOpening;
}

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const defaultValues: Partial<JobFormValues> = {
    title: job.title,
    slug: job.slug,
    department: job.department ?? '',
    location: job.location ?? '',
    employment_type: job.employment_type,
    workplace_type: job.workplace_type ?? 'on-site',
    salary_min: job.salary_min != null ? String(job.salary_min) : '',
    salary_max: job.salary_max != null ? String(job.salary_max) : '',
    salary_currency: job.salary_currency ?? 'INR',
    salary_period: job.salary_period ?? 'YEAR',
    description: job.description,
    responsibilities: (job.responsibilities ?? []).join('\n'),
    requirements: (job.requirements ?? []).join('\n'),
    apply_url: job.apply_url ?? '',
    apply_email: job.apply_email ?? '',
    valid_through: job.valid_through ?? '',
    status: job.status,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between border-b border-hairline pb-6">
        <div>
          <Link href="/admin/careers" className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink">
            ← All openings
          </Link>
          <h1 className="text-2xl font-bold text-ink">Edit Opening</h1>
          <p className="mt-1 font-mono text-sm text-faint">/{job.slug}</p>
        </div>
        <Link
          href={`/careers/${job.slug}`}
          target="_blank"
          className="rounded-md border border-hairline bg-sand px-4 py-2 text-xs font-bold text-ink transition hover:border-saffron-500/50"
        >
          View Live ↗
        </Link>
      </div>

      <JobForm mode="edit" jobId={id} defaultValues={defaultValues} />
    </div>
  );
}
