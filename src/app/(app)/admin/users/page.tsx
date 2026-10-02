import Link from 'next/link';

import { ROLES } from '@/types/schema';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { query } from '../lib/db';
import { RoleSelect } from './RoleSelect';

export const dynamic = 'force-dynamic';

interface UserRow {
  user_id: string;
  email: string | null;
  role: string | null;
  role_created_at: string | null;
  user_created_at: string | null;
}

/**
 * Users are joined from `auth.users`, which is owned by GoTrue. If the join
 * fails (a database whose auth schema is shaped differently, or a permissions
 * change), fall back to `user_roles` alone — a role row without a resolvable
 * email is still worth showing, and losing the whole page would be worse.
 */
async function loadUsers(): Promise<{ rows: UserRow[]; authAvailable: boolean }> {
  try {
    const rows = await query<UserRow>(
      `SELECT u.id           AS user_id,
              u.email        AS email,
              ur.role        AS role,
              ur.created_at  AS role_created_at,
              u.created_at   AS user_created_at
         FROM auth.users u
         LEFT JOIN public.user_roles ur ON ur.user_id = u.id
        ORDER BY u.created_at DESC, u.id`,
    );
    return { rows, authAvailable: true };
  } catch {
    const rows = await query<UserRow>(
      `SELECT ur.user_id,
              NULL::text  AS email,
              ur.role,
              ur.created_at AS role_created_at,
              NULL::timestamptz AS user_created_at
         FROM public.user_roles ur
        ORDER BY ur.created_at DESC`,
    );
    return { rows, authAvailable: false };
  }
}

export default async function UsersPage() {
  const [{ rows, authAvailable }, roleCounts, allowList] = await Promise.all([
    loadUsers(),
    query<{ role: string; allowed: string; total: string }>(
      `SELECT role,
              count(*) FILTER (WHERE allowed) AS allowed,
              count(*)                        AS total
         FROM public.role_capabilities
        GROUP BY role`,
    ),
    query<{ email: string; added_at: string }>(
      `SELECT email, added_at FROM public.admin_users ORDER BY added_at`,
    ),
  ]);

  const byRole = new Map(roleCounts.map((r) => [r.role, r]));
  const signedInEmails = new Set(
    rows.map((r) => r.email?.toLowerCase()).filter((e): e is string => Boolean(e)),
  );

  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Every user has at most one role; the role is what carries capabilities. Change a role here, change what a role can do on the Capabilities page."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No users yet"
          description={
            authAvailable ? (
              <>
                <code>auth.users</code> is empty. Users appear here once someone signs in
                through Google on <Link className="underline" href="/login">/login</Link>.
              </>
            ) : (
              <>
                The <code>auth</code> schema could not be read, so this list falls back to
                <code> user_roles</code> alone, which is also empty.
              </>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>User ID</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead>Role assigned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const counts = row.role ? byRole.get(row.role) : undefined;
              return (
                <TableRow key={row.user_id}>
                  <TableCell className="font-medium">{row.email ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted">{row.user_id}</TableCell>
                  <TableCell>
                    <RoleSelect userId={row.user_id} role={row.role} />
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {counts ? `${counts.allowed} of ${counts.total} granted` : 'no grants'}
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {row.role_created_at
                      ? new Date(row.role_created_at).toISOString().slice(0, 10)
                      : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Roles</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead>Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROLES.map((role) => {
              const counts = byRole.get(role);
              const users = rows.filter((r) => r.role === role).length;
              return (
                <TableRow key={role}>
                  <TableCell className="font-mono text-xs">{role}</TableCell>
                  <TableCell className="text-xs text-muted">
                    {counts ? `${counts.allowed} of ${counts.total}` : '0'}
                  </TableCell>
                  <TableCell>
                    {users === 0 ? (
                      <Badge variant="secondary">none</Badge>
                    ) : (
                      <Badge variant="outline">{users}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted">
          Edit what each role may do on the{' '}
          <Link className="underline" href="/admin/users/capabilities">
            Capabilities
          </Link>{' '}
          page.
        </p>
      </section>

      {/*
        The allow-list is a separate gate from the role: an address must be in
        admin_users to complete sign-in AT ALL (see src/app/auth/callback/route.ts),
        and only then does the role decide what it may do. Showing it here makes
        the "I signed in and got bounced" case diagnosable without psql.
      */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Sign-in allow-list</h2>
        <p className="mb-3 text-xs text-muted">
          <code>public.admin_users</code>. An address that is not here cannot complete
          sign-in, whatever role it has. Addresses listed in{' '}
          <code>BOOTSTRAP_ADMIN_EMAILS</code> are granted the <code>admin</code> role on
          first sign-in; everyone else lands on <code>/pending-approval</code> until an
          administrator assigns them one above.
        </p>
        {allowList.length === 0 ? (
          <EmptyState title="Allow-list is empty" description="Nobody can sign in." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Signed in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allowList.map((entry) => (
                <TableRow key={entry.email}>
                  <TableCell className="text-xs">{entry.email}</TableCell>
                  <TableCell className="text-xs text-muted">
                    {new Date(entry.added_at).toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    {signedInEmails.has(entry.email.toLowerCase()) ? (
                      <Badge variant="outline">yes</Badge>
                    ) : (
                      <Badge variant="secondary">never</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
