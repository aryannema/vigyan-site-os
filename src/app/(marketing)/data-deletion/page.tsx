// Placeholder legal text for a template — have it reviewed for your business and jurisdiction.
import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/page-seo';
import { siteConfig } from '@/config/site';
import { getCompany, formatAddress } from '@/lib/company';

// Legal text. Changes about once a year.
export const revalidate = 86400;

// Title and description come from site_content['page_seo'] when set, so SEO
// copy can be tuned against Search Console data without a deploy. The values
// below are the fallback, and the database only ever overrides them.
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/data-deletion', {
    title: 'Data Deletion',
    description:
      'How to request deletion of your data held by Your Company Private Limited.',
  });
}


export default async function DataDeletionPage() {
  const company = await getCompany();
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 prose prose-slate dark:prose-invert">
      <h1>Data Deletion</h1>
      <p>Last updated: 9 September 2026</p>

      <p>
        {company.legal_name} (&quot;YourSite&quot;, &quot;we&quot;, &quot;us&quot;)
        gives you full control over the data we hold about you, including data collected through our
        WhatsApp Business number, website contact forms, and your YourSite account. This page explains
        how to request deletion, in line with your rights under India&apos;s Digital Personal Data
        Protection Act, 2023.
      </p>

      <h2>1. What can be deleted</h2>
      <ul>
        <li>WhatsApp conversation history tied to your phone number.</li>
        <li>Contact form submissions, including name, email, phone number, and message content.</li>
        <li>Your YourSite account: name, email, WhatsApp number and verification record, and order
          history.</li>
        <li>Any other personal data we hold in connection with an inquiry or engagement with us.</li>
      </ul>

      <h2>2. How to request deletion</h2>
      <p>
        If you have a YourSite account, sign in and use &quot;Delete my account&quot; on{' '}
        <a href="/account">My Account</a> — this deletes it immediately, no waiting.
      </p>
      <p>
        If you can&apos;t or don&apos;t want to sign in, use our{' '}
        <a href="/data-deletion/request">automated deletion request</a> — it requires confirming both your
        registered email (via a link we send) and your WhatsApp number (via a code we send) before anything
        is deleted, so nobody else can delete your data on your behalf.
      </p>
      <p>
        For anything else (WhatsApp bot conversations, contact-form submissions not tied to an account),
        email{' '}
        <a href={`mailto:${siteConfig.links.contact.email}`}>{siteConfig.links.contact.email}</a> with the
        subject line &quot;Data Deletion Request&quot;, including the phone number and/or email address
        associated with your data. Alternatively, message our WhatsApp Business number directly and ask to
        have your data deleted — this will be escalated to a person on our team.
      </p>

      <h2>3. What happens next</h2>
      <p>
        We will confirm your request and delete or fully anonymize the associated records within 30 days
        (well inside the 90-day window the DPDP Act allows for grievance redressal), except where we are
        required to retain certain records for legal, tax, or accounting purposes (e.g. invoices for a
        paid engagement), in which case we will let you know what is retained and why. If you&apos;re not
        satisfied with how we&apos;ve handled your request, you may complain to the Data Protection Board
        of India.
      </p>

      <h2>4. WhatsApp Business Platform</h2>
      <p>
        Our WhatsApp number is operated via Meta&apos;s WhatsApp Business Platform. Deleting your data from
        our own systems does not delete messages stored on your own device or within WhatsApp itself —
        for that, see{' '}
        <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer">
          Meta&apos;s WhatsApp Business Messaging Policy
        </a>.
      </p>

      <h2>5. Contact</h2>
      <p>
        {company.legal_name}, {formatAddress(company)}
        <br />
        {[company.gstin && `GSTIN ${company.gstin}`, company.cin && `CIN ${company.cin}`].filter(Boolean).join(' · ')}
        {(company.gstin || company.cin) && <br />}
        Email: <a href={`mailto:${siteConfig.links.contact.email}`}>{siteConfig.links.contact.email}</a>
      </p>
    </main>
  );
}
