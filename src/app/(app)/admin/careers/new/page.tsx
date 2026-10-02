import Link from 'next/link';
import JobForm from '../JobForm';


export const dynamic = 'force-dynamic';
export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-hairline pb-6">
        <Link href="/admin/careers" className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink">
          ← All openings
        </Link>
        <h1 className="text-2xl font-bold text-ink">New Opening</h1>
        <p className="mt-1 text-sm text-faint">Post a new role — JD, type, pay and how to apply.</p>
      </div>

      <JobForm mode="create" />
    </div>
  );
}
