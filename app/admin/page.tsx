import Link from 'next/link';

import type { ActionAuditLog } from '@/types/schema';

import { Card, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { PageHeader } from './components/PageHeader';
import { query } from './lib/db';

export const dynamic = 'force-dynamic';

interface Counts {
  posts: string;
  published_posts: string;
  jobs: string;
  open_jobs: string;
  inquiries: string;
  sections: string;
  users: string;
  grants: string;
}

const TILES: { label: string; href: string; value: (c: Counts) => string; detail: (c: Counts) => string }[] = [
  {
    label: 'Site content',
    href: '/admin/cms',
    value: (c) => c.sections,
    detail: () => 'sections',
  },
  {
    label: 'Posts',
    href: '/admin/blog',
    value: (c) => c.posts,
    detail: (c) => `${c.published_posts} published`,
  },
  {
    label: 'Job openings',
    href: '/admin/careers',
    value: (c) => c.jobs,
    detail: (c) => `${c.open_jobs} open`,
  },
  {
    label: 'Contact inquiries',
    href: '/admin/crm',
    value: (c) => c.inquiries,
    detail: () => 'total received',
  },
  {
    label: 'Users',
    href: '/admin/users',
    value: (c) => c.users,
    detail: () => 'with a role assigned',
  },
  {
    label: 'Capability grants',
    href: '/admin/users/capabilities',
    value: (c) => c.grants,
    detail: () => 'allowed',
  },
];

export default async function AdminDashboardPage() {
  const [countsRows, audit] = await Promise.all([
    query<Counts>(
      `SELECT (SELECT count(*) FROM public.posts)::text                          AS posts,
              (SELECT count(*) FROM public.posts WHERE status='published')::text AS published_posts,
              (SELECT count(*) FROM public.job_openings)::text                   AS jobs,
              (SELECT count(*) FROM public.job_openings WHERE status='open')::text AS open_jobs,
              (SELECT count(*) FROM public.contact_inquiries)::text              AS inquiries,
              (SELECT count(*) FROM public.site_content)::text                   AS sections,
              (SELECT count(*) FROM public.user_roles)::text                     AS users,
              (SELECT count(*) FROM public.role_capabilities WHERE allowed)::text AS grants`,
    ),
    query<ActionAuditLog>(
      `SELECT id, actor, resource_key, action, target_id, before_data, after_data, created_at
         FROM public.action_audit_log
        ORDER BY created_at DESC
        LIMIT 15`,
    ),
  ]);

  const counts = countsRows[0]!;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Everything on these pages reads and writes the live database — there is no seeded or mocked data."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <Link key={tile.href} href={tile.href} className="block">
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {tile.label}
                </CardTitle>
                <div className="text-2xl font-semibold tabular-nums">{tile.value(counts)}</div>
                <CardDescription>{tile.detail(counts)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The last 15 rows of <code>action_audit_log</code>. Every admin write records one, in the
          same transaction as the write itself.
        </p>
        {audit.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5 text-xs">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-muted-foreground">
                  {new Date(entry.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                </span>
                <span className="font-medium">
                  {entry.resource_key}:{entry.action}
                </span>
                <span className="text-muted-foreground">by {entry.actor}</span>
                {entry.target_id ? (
                  <span className="font-mono text-muted-foreground">{entry.target_id}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
