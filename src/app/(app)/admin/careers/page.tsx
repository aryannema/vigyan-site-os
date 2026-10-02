import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { JobOpening, EMPLOYMENT_TYPE_LABEL, JobEmploymentType } from '@/lib/careers-schema';
import DeleteJobButton from './DeleteJobButton';


export const dynamic = 'force-dynamic';
async function getAllJobs(): Promise<JobOpening[]> {
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select('id, title, slug, department, location, employment_type, status, created_at')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as JobOpening[];
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30',
  draft: 'bg-brand-primary/20 text-saffron-ink border-brand-primary/30',
  closed: 'bg-ink/10 text-muted border-hairline-strong',
};

export default async function CareersManagementPage() {
  const jobs = await getAllJobs();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Careers</h1>
          <p className="mt-1 text-sm text-muted">{jobs.length} total openings</p>
        </div>
        <Link
          href="/admin/careers/new"
          className="rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-[#1c1814] shadow-lg shadow-brand-primary/20 transition hover:brightness-110"
        >
          + New Opening
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {jobs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted">No openings yet.</p>
            <Link href="/admin/careers/new" className="mt-4 inline-block text-sm font-bold text-saffron-ink hover:underline">
              Post your first opening →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="px-6 py-4 text-left">Role</th>
                  <th className="px-4 py-4 text-left">Type</th>
                  <th className="px-4 py-4 text-left">Location</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-faint">
                {jobs.map((job) => (
                  <tr key={job.id} className="group transition hover:bg-sand">
                    <td className="px-6 py-4">
                      <span className="font-medium text-ink transition line-clamp-1 group-hover:text-saffron-ink">{job.title}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted">/{job.slug}</span>
                    </td>
                    <td className="px-4 py-4 text-[11px] font-bold uppercase tracking-wider text-green-ink">
                      {EMPLOYMENT_TYPE_LABEL[job.employment_type as JobEmploymentType] ?? job.employment_type}
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">{job.location || '—'}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[job.status] || STATUS_BADGE.draft}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/careers/${job.slug}`} target="_blank" className="text-xs text-muted transition hover:text-ink">
                          Preview
                        </Link>
                        <Link href={`/admin/careers/${job.id}/edit`} className="text-xs font-bold text-saffron-ink hover:underline">
                          Edit
                        </Link>
                        <DeleteJobButton id={job.id} title={job.title} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
