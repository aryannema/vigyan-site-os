import { getWhatsAppNumber } from '@/lib/whatsapp-number';
import DeletionRequestForm from './DeletionRequestForm';

export const metadata = {
  title: 'Request Account Deletion',
  alternates: { canonical: '/data-deletion/request' },
};

export const dynamic = 'force-dynamic';

/**
 * Unauthenticated account-deletion request — for someone who wants their
 * YourSite account gone but isn't (or can't be) signed in. Requires
 * confirming BOTH the registered email (via a clicked link) and WhatsApp
 * number (via a customer-initiated "DELETE" message + code) before anything
 * is deleted. Signed-in users should use the "Delete my account" button on
 * /account instead — this page is specifically for the unauthenticated case.
 * See migration 021 / src/lib/account-deletion.ts for the full design.
 */
export default async function DataDeletionRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const businessWhatsappNumber = await getWhatsAppNumber();

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center overflow-hidden bg-paper p-4 pt-24">
      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-ink">Request account deletion</h1>
          <p className="text-sm text-muted">
            For accounts you can&apos;t or don&apos;t want to sign into. Confirmation is required on both
            email and WhatsApp before anything is deleted.
          </p>
        </div>

        <DeletionRequestForm initialStatus={status ?? null} businessWhatsappNumber={businessWhatsappNumber} />
      </div>
    </div>
  );
}
