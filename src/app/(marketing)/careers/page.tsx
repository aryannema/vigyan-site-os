import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { JobOpening, EMPLOYMENT_TYPE_LABEL, JobEmploymentType } from '@/lib/careers-schema';

// Cacheable: revalidated whenever a role opens or closes, via
// revalidateFor({ kind: 'job' }). See lib/content-revalidation.ts.
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Careers',
  description: 'Work with YourSite. Open roles, internships, and how to apply.',
  alternates: { canonical: '/careers' },
};

async function getOpenJobs(): Promise<JobOpening[]> {
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select('id, title, slug, department, location, employment_type, workplace_type, description, status, posted_at, created_at')
    .eq('status', 'open')
    .order('posted_at', { ascending: false });
  if (error || !data) return [];
  return data as JobOpening[];
}

function preview(html: string, max = 160) {
  const text = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export default async function CareersPage() {
  const jobs = await getOpenJobs();

  return (
    <section className="sec" style={{ paddingTop: 168 }}>
      <div className="wrap" style={{ maxWidth: 980 }}>
        <div style={{ maxWidth: 620 }}>
          <span className="eyebrow" style={{ color: 'var(--vb-saffron-700)' }}>Careers · Tech कुटुम्बकम्</span>
          <h1 style={{ fontSize: 'clamp(34px,5vw,56px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.05, margin: '14px 0 0', color: 'var(--vb-ink-900)' }}>
            Build something great with us
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--vb-ink-700)', marginTop: 16 }}>
            A small team that cares about craft. See what's open below.
            Join a small team that ships real systems, not pilots.
          </p>
        </div>

        <div style={{ marginTop: 48, display: 'grid', gap: 16 }}>
          {jobs.length === 0 ? (
            <div className="vb-card" style={{ padding: 40, textAlign: 'center' }}>
              <p className="text-muted">No open roles right now. Check back soon — or introduce yourself via the Support link.</p>
            </div>
          ) : (
            jobs.map((job) => (
              <Link
                key={job.id}
                href={`/careers/${job.slug}`}
                className="vb-card vb-card-interactive vb-card-accent"
                style={{ position: 'relative', display: 'block', padding: '26px 28px 26px', overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <span className="font-mono" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vb-green-700)' }}>
                    {EMPLOYMENT_TYPE_LABEL[job.employment_type as JobEmploymentType] ?? job.employment_type}
                  </span>
                  {job.location && <span className="text-muted" style={{ fontSize: 13 }}>· {job.location}</span>}
                  {job.workplace_type && <span className="text-muted" style={{ fontSize: 13 }}>· {job.workplace_type}</span>}
                  {job.department && <span className="text-muted" style={{ fontSize: 13 }}>· {job.department}</span>}
                </div>
                <h2 className="text-ink" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', margin: 0 }}>{job.title}</h2>
                <p className="text-muted" style={{ fontSize: 14, lineHeight: 1.55, marginTop: 8 }}>{preview(job.description)}</p>
                <span className="text-saffron-ink" style={{ fontSize: 14, fontWeight: 700, marginTop: 14, display: 'inline-block' }}>View role →</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
