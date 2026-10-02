'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';

import { ACTIONS, ROLES, type Action, type CapabilityGrant, type Role } from '@/types/schema';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { setCapability } from './actions';

export interface ResourceInfo {
  key: string;
  /** False for a key that exists in the matrix but has no `resource:<key>` table yet. */
  hasTable: boolean;
}

interface CapabilityGridProps {
  resources: ResourceInfo[];
  grants: CapabilityGrant[];
}

/** 'allow' = allowed row, 'deny' = explicit allowed=false row, 'unset' = no row. */
type CellState = 'allow' | 'deny' | 'unset';

const cellKey = (role: string, resource: string, action: string) =>
  `${role}|${resource}|${action}`;

/** The one cell the server refuses to switch off — see `isMatrixLockout` in actions.ts. */
const isLocked = (role: string, resource: string, action: string) =>
  role === 'admin' && resource === 'users' && action === 'edit';

export function CapabilityGrid({ resources, grants }: CapabilityGridProps) {
  const base = useMemo(() => {
    const map = new Map<string, CellState>();
    for (const g of grants) {
      map.set(cellKey(g.role, g.resource_key, g.action), g.allowed ? 'allow' : 'deny');
    }
    return map;
  }, [grants]);

  const [cells, applyOptimistic] = useOptimistic(
    base,
    (state, patch: { key: string; next: CellState }) => {
      const copy = new Map(state);
      copy.set(patch.key, patch.next);
      return copy;
    },
  );

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(role: Role, resource: string, action: Action, allowed: boolean) {
    const key = cellKey(role, resource, action);
    startTransition(async () => {
      applyOptimistic({ key, next: allowed ? 'allow' : 'deny' });
      const result = await setCapability({ role, resourceKey: resource, action, allowed });
      // On failure the optimistic value is dropped when the transition ends and
      // the server-rendered value wins, so the checkbox snaps back on its own.
      setError(result.ok ? null : result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[1.25rem] items-center gap-3 text-xs"
      >
        {isPending ? <span className="text-muted">Saving…</span> : null}
        {error ? <span className="font-semibold text-red-600">{error}</span> : null}
      </div>

      {resources.map((resource) => (
        <Card key={resource.key}>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="font-mono">{resource.key}</CardTitle>
              <CardDescription>
                Which role may perform which action on <code>{resource.key}</code>.
              </CardDescription>
            </div>
            {resource.hasTable ? (
              <Badge variant="outline">tagged table</Badge>
            ) : (
              <Badge
                variant="secondary"
                title="No table carries a resource:<key> comment for this key yet. The grants are kept so the resource is governed the moment such a table exists."
              >
                no table yet
              </Badge>
            )}
          </CardHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">Role</TableHead>
                {ACTIONS.map((action) => (
                  <TableHead key={action} className="text-center">
                    {action}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLES.map((role) => (
                <TableRow key={role}>
                  <TableCell className="font-mono text-xs">{role}</TableCell>
                  {ACTIONS.map((action) => {
                    const key = cellKey(role, resource.key, action);
                    const state = cells.get(key) ?? 'unset';
                    const locked = isLocked(role, resource.key, action);
                    const label = `${role} may ${action} ${resource.key}`;
                    return (
                      <TableCell key={action} className="text-center">
                        <span
                          className={
                            state === 'deny'
                              ? 'inline-flex rounded-sm p-0.5 ring-1 ring-red-500/40'
                              : 'inline-flex p-0.5'
                          }
                          title={
                            locked
                              ? 'Locked: this is the capability that governs the capability matrix itself.'
                              : state === 'deny'
                                ? `${label} — explicit deny (allowed = false)`
                                : state === 'allow'
                                  ? `${label} — granted`
                                  : `${label} — no grant row`
                          }
                        >
                          <Checkbox
                            checked={state === 'allow'}
                            disabled={locked}
                            aria-label={label}
                            onChange={(event) =>
                              toggle(role, resource.key, action, event.currentTarget.checked)
                            }
                          />
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ))}
    </div>
  );
}
