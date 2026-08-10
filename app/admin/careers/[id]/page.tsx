import { notFound } from 'next/navigation';

import type { ActionAuditLog, JobOpening } from '@/types/schema';

import { Button } from '../../../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';
import { query } from '../../lib/db';
import { deleteJobOpeningAction, updateJobOpening } from '../actions';
import { JobForm } from '../JobForm';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditJobOpeningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [jobs, audit] = await Promise.all([
    query<JobOpening>(`SELECT * FROM public.job_openings WHERE id = $1`, [id]),
    query<ActionAuditLog>(
      `SELECT id, actor, resource_key, action, target_id, before_data, after_data, created_at
         FROM public.action_audit_log
        WHERE target_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [id],
    ),
  ]);

  const job = jobs[0];
  if (!job) notFound();

  return (
    <>
      <PageHeader
        title="Edit job opening"
        description={`Last updated ${new Date(job.updated_at).toISOString().slice(0, 10)}.`}
      />

      <JobForm job={job} action={updateJobOpening.bind(null, id)} submitLabel="Save changes" />

      <section className="mt-10 max-w-3xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold">Activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          From <code>action_audit_log</code>, written in the same transaction as each change.
        </p>
        {audit.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No recorded activity.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5 text-xs">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-2 text-muted-foreground">
                <span className="font-mono">{new Date(entry.created_at).toISOString()}</span>
                <span className="font-medium text-foreground">
                  {entry.resource_key}:{entry.action}
                </span>
                <span>by {entry.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 max-w-3xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Deleting removes the row permanently. The deleted values are kept in the audit log.
        </p>
        <form action={deleteJobOpeningAction} className="mt-3">
          <input type="hidden" name="id" value={job.id} />
          <Button type="submit" variant="destructive" size="sm">
            Delete opening
          </Button>
        </form>
      </section>
    </>
  );
}
