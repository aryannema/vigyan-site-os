// Placeholder legal text for a template — have it reviewed for your business and jurisdiction.
import ConfirmPlaceholder from '@/components/site/ConfirmPlaceholder';
import { siteConfig } from '@/config/site';
import { getCompany, formatAddress } from '@/lib/company';

// Legal text. Changes about once a year.
export const revalidate = 86400;

export const metadata = {
  title: 'Refund Policy',
  description:
    'Refund and cancellation terms for YourSite subscriptions and fixed-price engagements.',
  alternates: { canonical: '/refund-policy' },
};

/**
 * STUB. Created because /sample-product links to a refund policy and Razorpay
 * expects one to exist for a subscription product — a checkout that points at
 * a 404 is worse than no checkout.
 *
 * The commercial terms are NOT invented here: refund windows, proration and
 * cancellation behaviour are business decisions, and every one of them is a
 * marked placeholder. This page must be completed before any Razorpay
 * subscription goes live.
 */
export default async function RefundPolicyPage() {
  const company = await getCompany();
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 prose prose-slate dark:prose-invert">
      <h1>Refund &amp; Cancellation Policy</h1>
      <p>Last updated: 16 September 2026</p>

      <p>
        This policy covers subscriptions to YourSite products and
        fixed-price service engagements sold by {company.legal_name}.
      </p>

      <h2>1. Subscriptions</h2>
      <p>
        <ConfirmPlaceholder>
          the refund window and whether part-months are refunded or prorated
        </ConfirmPlaceholder>
      </p>

      <h2>2. Cancelling</h2>
      <p>
        You can cancel at any time from your account. Cancelling stops the next renewal; access
        continues to the end of the period already paid for.{' '}
        <ConfirmPlaceholder>confirm this matches the billing implementation</ConfirmPlaceholder>
      </p>

      <h2>3. Fixed-price engagements</h2>
      <p>
        <ConfirmPlaceholder>
          refund terms for fixed-price services — typically tied to delivery milestones
        </ConfirmPlaceholder>
      </p>

      <h2>4. How refunds are paid</h2>
      <p>
        Approved refunds are returned to the original payment method through Razorpay.{' '}
        <ConfirmPlaceholder>processing time to state</ConfirmPlaceholder>
      </p>

      <h2>5. Payments we do not take</h2>
      <p>
        Our checkout is used only for our own products and services. We do not take payment on
        behalf of our customers&apos; businesses: a customer keeps their own payment
        methods, and money from their customers never passes through us.
      </p>

      <h2>6. Contact</h2>
      <p>
        {company.legal_name}, {formatAddress(company)}
        <br />
        Email:{' '}
        <a href={`mailto:${siteConfig.links.contact.email}`}>{siteConfig.links.contact.email}</a>
      </p>
    </main>
  );
}
