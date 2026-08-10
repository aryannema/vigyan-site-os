import Link from 'next/link';

import type { JobOpening } from '@/types/schema';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { query } from '../lib/db';
import { deleteJobOpeningAction, setJobStatusAction } from './actions';

export const dynamic = 'force-dynamic';

function statusVariant(status: JobOpening['status']) {
  if (status === 'open') return 'default' as const;
  if (status === 'closed') return 'muted' as const;
  return 'outline' as const;
}

export default async function CareersListPage() {
  const jobs = await query<JobOpening>(
    `SELECT * FROM public.job_openings
      ORDER BY COALESCE(posted_at, created_at) DESC, title`,
  );

  return (
    <>
      <PageHeader
        title="Job openings"
        description="Roles from the job_openings table. Only 'open' roles are readable by anonymous visitors."
        action={{ label: 'New opening', href: '/admin/careers/new' }}
      />

      {jobs.length === 0 ? (
        <EmptyState
          title="No job openings yet"
          description="Create the first one to see it here — the list reads the job_openings table directly."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>
                  <Link href={`/admin/careers/${job.id}`} className="font-medium hover:underline">
                    {job.title}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">/{job.slug}</div>
                </TableCell>
                <TableCell className="text-xs">{job.department ?? '—'}</TableCell>
                <TableCell className="text-xs">{job.location ?? '—'}</TableCell>
                <TableCell className="text-xs">
                  {job.employment_type}
                  {job.workplace_type ? ` · ${job.workplace_type}` : ''}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <form action={setJobStatusAction}>
                      <input type="hidden" name="id" value={job.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={job.status === 'open' ? 'closed' : 'open'}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        {job.status === 'open' ? 'Close' : 'Open'}
                      </Button>
                    </form>
                    <Link
                      href={`/admin/careers/${job.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
                    >
                      Edit
                    </Link>
                    <form action={deleteJobOpeningAction}>
                      <input type="hidden" name="id" value={job.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                        Delete
                      </Button>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
