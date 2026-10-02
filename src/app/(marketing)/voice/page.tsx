import WaitlistForm from '@/components/forms/WaitlistForm';
import { pageMetadata } from '@/lib/page-seo';
import type { Metadata } from 'next';
import Link from 'next/link';

// Pre-launch waitlist stub. Kept out of the index until it is real.
export const revalidate = 3600;

// Title and description come from site_content['page_seo'] when set; the
// values below are the fallback.
export async function generateMetadata(): Promise<Metadata> {
  const base = await pageMetadata('/voice', {
    title: 'Coming soon',
    description: 'A new feature is on its way. Join the waitlist to hear when it is live.',
  });
  return { ...base, robots: { index: false, follow: true } };
}

export default function VoicePage() {
  return (
    <section className="sec" style={{ paddingTop: 168 }}>
      <div className="wrap" style={{ maxWidth: 760, textAlign: 'center' }}>
        <span className="eyebrow" style={{ color: 'var(--primary-ink)', justifyContent: 'center' }}>
          Coming soon
        </span>
        <h1 style={{ fontSize: 'clamp(34px,5vw,56px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.04, margin: '28px 0 0', color: 'var(--text-strong)' }}>
          Something new is on its way
        </h1>
        <p style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--text-body)', margin: '18px auto 0', maxWidth: 560 }}>
          Replace this line with what the feature does. Until then, the waitlist below is the
          one useful thing this page can offer.
        </p>
        <div style={{ marginTop: 34, display: 'flex', justifyContent: 'center' }}>
          <WaitlistForm
            product="voice"
            label="Tell me when it's live"
            askNote="What would you use it for? (optional)"
            source="/voice"
          />
        </div>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginTop: 34 }}>
          <Link className="btn btn-primary btn-lg" href="/contact">Get in touch instead</Link>
          <Link className="btn btn-ghost btn-lg" href="/services">See our services</Link>
        </div>
      </div>
    </section>
  );
}
