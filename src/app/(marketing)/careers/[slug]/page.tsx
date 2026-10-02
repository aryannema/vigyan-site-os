import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { siteConfig } from '@/config/site';
import { JobOpening, EMPLOYMENT_TYPE_LABEL, JobEmploymentType } from '@/lib/careers-schema';

// Cacheable: revalidated by slug on job create/update/delete, via
// revalidateFor({ kind: 'job' }). See lib/content-revalidation.ts.
export const revalidate = 300;

/**
 * Prerender every open role.
 *
 * Without this Next cannot know the slugs, treats the route as fully dynamic,
 * and emits `no-store` however short `revalidate` is -- the same trap that
 * left the blog posts uncrawled. A job page that cannot be cached cannot be
 * crawled, and JobPosting structured data is worth nothing unindexed.
 *
 * dynamicParams stays default, so a role opened after the build still renders
 * on first request and caches from then on.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('job_openings')
      .select('slug')
      .eq('status', 'open');
    if (error) {
      console.error('[careers/[slug]] generateStaticParams failed:', error.message);
      return [];
    }
    return (data ?? []).map((j: { slug: string }) => ({ slug: j.slug }));
  } catch (err) {
    console.error('[careers/[slug]] generateStaticParams threw:', err);
    return [];
  }
}

async function getJob(slug: string): Promise<JobOpening | null> {
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'open')
    .single();
  if (error || !data) return null;
  return data as JobOpening;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJob(slug);
  if (!job) return { title: 'Role not found' };
  const text = (job.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { title: job.title, description: text.slice(0, 160) };
}

function formatSalary(job: JobOpening): string | null {
  if (job.salary_min == null && job.salary_max == null) return null;
  const cur = job.salary_currency || 'INR';
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${cur} ${n.toLocaleString('en-IN')}`;
    }
  };
  const period = (job.salary_period || 'YEAR').toLowerCase();
  const range =
    job.salary_min != null && job.salary_max != null
      ? `${fmt(job.salary_min)} – ${fmt(job.salary_max)}`
      : fmt((job.salary_min ?? job.salary_max) as number);
  return `${range} / ${period}`;
}

export default async function JobDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await getJob(slug);
  if (!job) notFound();

  const salary = formatSalary(job);
  const applyHref = job.apply_url
    ? job.apply_url
    : job.apply_email
    ? `mailto:${job.apply_email}?subject=${encodeURIComponent(`Application — ${job.title}`)}`
    : '/contact';
  const applyExternal = Boolean(job.apply_url);

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description,
    datePosted: job.posted_at || job.created_at,
    ...(job.valid_through ? { validThrough: job.valid_through } : {}),
    employmentType: job.employment_type,
    hiringOrganization: {
      '@type': 'Organization',
      name: siteConfig.name,
      sameAs: siteConfig.url,
      logo: `${siteConfig.url}${siteConfig.branding.logo.square}`,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: job.location || siteConfig.links.contact.locationLabel,
        addressCountry: 'IN',
      },
    },
    ...(job.workplace_type === 'remote' ? { jobLocationType: 'TELECOMMUTE' } : {}),
    ...(salary && (job.salary_min != null || job.salary_max != null)
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: job.salary_currency || 'INR',
            value: {
              '@type': 'QuantitativeValue',
              ...(job.salary_min != null ? { minValue: job.salary_min } : {}),
              ...(job.salary_max != null ? { maxValue: job.salary_max } : {}),
              unitText: job.salary_period || 'YEAR',
            },
          },
        }
      : {}),
  };

  const metaBits = [
    EMPLOYMENT_TYPE_LABEL[job.employment_type as JobEmploymentType] ?? job.employment_type,
    job.workplace_type,
    job.location,
    job.department,
  ].filter(Boolean);

  return (
    <section className="sec" style={{ paddingTop: 168 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className="wrap" style={{ maxWidth: 760 }}>
        <Link href="/careers" className="text-saffron-ink" style={{ fontSize: 14, fontWeight: 700 }}>← All openings</Link>

        <div style={{ marginTop: 18 }}>
          <span className="font-mono" style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--vb-green-700)' }}>
            {metaBits.join(' · ')}
          </span>
          <h1 style={{ fontSize: 'clamp(30px,4.6vw,48px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.06, margin: '12px 0 0', color: 'var(--vb-ink-900)' }}>
            {job.title}
          </h1>
          {salary && (
            <p className="text-saffron-ink" style={{ fontFamily: 'var(--font-mono)', fontSize: 14, marginTop: 12 }}>{salary}</p>
          )}
        </div>

        <div style={{ marginTop: 28, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <a
            className="btn btn-primary btn-lg"
            href={applyHref}
            {...(applyExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            Apply now
          </a>
          <Link className="btn btn-ghost btn-lg" href="/contact">Ask a question</Link>
        </div>

        <div
          className="text-body"
          style={{ marginTop: 40, fontSize: 16, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}
          dangerouslySetInnerHTML={{ __html: job.description }}
        />

        {job.responsibilities && job.responsibilities.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <h2 className="text-ink" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}>What you&apos;ll do</h2>
            <ul style={{ marginTop: 14, paddingLeft: 18, display: 'grid', gap: 8 }}>
              {job.responsibilities.map((r, i) => (
                <li key={i} className="text-body" style={{ fontSize: 15, lineHeight: 1.6 }}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {job.requirements && job.requirements.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 className="text-ink" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}>What we look for</h2>
            <ul style={{ marginTop: 14, paddingLeft: 18, display: 'grid', gap: 8 }}>
              {job.requirements.map((r, i) => (
                <li key={i} className="text-body" style={{ fontSize: 15, lineHeight: 1.6 }}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="vb-card" style={{ marginTop: 44, padding: 28, textAlign: 'center' }}>
          <p className="text-ink" style={{ fontWeight: 700, fontSize: 18 }}>Interested in this role?</p>
          <p className="text-muted" style={{ fontSize: 14, marginTop: 6 }}>We reply within one business day.</p>
          <div style={{ marginTop: 18, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              className="btn btn-primary"
              href={applyHref}
              {...(applyExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              Apply now
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
