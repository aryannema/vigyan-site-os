import Link from 'next/link';

import { ROLES } from '@/types/schema';

import { Badge } from '../../../components/ui/badge';
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
 * Users are joined from `auth.users`, which is owned by GoTrue and does not exist
 * on every database this template can point at (000 creates a local stub only for
 * development). If the join fails, fall back to `user_roles` alone — a role row
 * without a resolvable email is still worth showing, and losing the whole page
 * because the auth schema is shaped differently would be worse.
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
  const [{ rows, authAvailable }, roleCounts] = await Promise.all([
    loadUsers(),
    query<{ role: string; allowed: string; total: string }>(
      `SELECT role,
              count(*) FILTER (WHERE allowed) AS allowed,
              count(*)                        AS total
         FROM public.role_capabilities
        GROUP BY role`,
    ),
  ]);

  const byRole = new Map(roleCounts.map((r) => [r.role, r]));

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
                <code>auth.users</code> is empty. Users appear here once an authentication
                backend is wired up and someone signs in — this page is already querying the
                real tables, so nothing needs to change when that happens.
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
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.user_id}
                  </TableCell>
                  <TableCell>
                    <RoleSelect userId={row.user_id} role={row.role} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {counts ? `${counts.allowed} of ${counts.total} granted` : 'no grants'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
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
        <h2 className="mb-3 text-sm font-semibold">Roles</h2>
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
                  <TableCell className="text-xs text-muted-foreground">
                    {counts ? `${counts.allowed} of ${counts.total}` : '0'}
                  </TableCell>
                  <TableCell>
                    {users === 0 ? (
                      <Badge variant="muted">none</Badge>
                    ) : (
                      <Badge variant="outline">{users}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Edit what each role may do on the{' '}
          <Link className="underline" href="/admin/users/capabilities">
            Capabilities
          </Link>{' '}
          page.
        </p>
      </section>
    </>
  );
}
