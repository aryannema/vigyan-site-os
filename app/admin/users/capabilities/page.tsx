import { RESOURCE_KEYS, type CapabilityGrant } from '@/types/schema';

import { PageHeader } from '../../components/PageHeader';
import { query } from '../../lib/db';
import { CapabilityGrid, type ResourceInfo } from './CapabilityGrid';

// The matrix is edited on this page; never serve it from a cache.
export const dynamic = 'force-dynamic';

/**
 * Resources shown, in a deliberate order:
 *   1. the keys listed in RESOURCE_KEYS (the compile-time contract), in its order
 *   2. then any other key present in the live data — either a table tagged with a
 *      `resource:<key>` comment that the contract has not caught up with, or a
 *      matrix key with no table yet (`payments` is seeded that way by 003 §6).
 *
 * The live `resources` view is authoritative about what exists; RESOURCE_KEYS is
 * only used for ordering and to keep the familiar keys at the top.
 */
async function loadResources(): Promise<ResourceInfo[]> {
  const [tagged, granted] = await Promise.all([
    query<{ resource_key: string }>(
      `SELECT resource_key FROM public.resources WHERE resource_key IS NOT NULL`,
    ),
    query<{ resource_key: string }>(
      `SELECT DISTINCT resource_key FROM public.role_capabilities`,
    ),
  ]);

  const withTable = new Set(tagged.map((r) => r.resource_key));
  const all = new Set([...withTable, ...granted.map((r) => r.resource_key)]);

  const ordered = [
    ...RESOURCE_KEYS.filter((key) => all.has(key)),
    ...[...all].filter((key) => !(RESOURCE_KEYS as readonly string[]).includes(key)).sort(),
  ];

  return ordered.map((key) => ({ key, hasTable: withTable.has(key) }));
}

export default async function CapabilitiesPage() {
  const [resources, grants] = await Promise.all([
    loadResources(),
    query<CapabilityGrant>(
      `SELECT role, resource_key, action, allowed
         FROM public.role_capabilities
        ORDER BY role, resource_key, action`,
    ),
  ]);

  const allowed = grants.filter((g) => g.allowed).length;

  return (
    <>
      <PageHeader
        title="Capabilities"
        description="The role × resource × action grant matrix. Every checkbox is a row in role_capabilities; toggling one writes to the database immediately."
      />

      <dl className="mb-6 flex flex-wrap gap-6 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Resources</dt>
          <dd className="font-medium">{resources.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Grant rows</dt>
          <dd className="font-medium">{grants.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Allowed</dt>
          <dd className="font-medium">{allowed}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Explicit denies</dt>
          <dd className="font-medium">{grants.length - allowed}</dd>
        </div>
      </dl>

      <CapabilityGrid resources={resources} grants={grants} />

      <section className="mt-8 rounded-lg border border-border p-4 text-xs leading-relaxed text-muted-foreground">
        <h2 className="mb-2 text-xs font-semibold text-foreground">How to read this</h2>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>
            Permission is deny-by-default. A checked box is an explicit
            <code> allowed = true</code> grant; nothing else grants anything.
          </li>
          <li>
            Unchecking writes <code>allowed = false</code> rather than deleting the row. Both
            deny, but an explicit deny records that someone decided it — a red outline marks
            those cells. This screen never deletes grant rows.
          </li>
          <li>
            <code>publish</code> is enforced by the application layer, not by RLS: row-level
            security cannot express &ldquo;may edit this row but not that column&rdquo;, so the
            surface that flips a status must check it.
          </li>
          <li>
            <code>admin · users · edit</code> is locked, because it is the capability that will
            gate this page once authentication is in place.
          </li>
          <li>
            Changes take effect on the next permission check — <code>user_has_capability()</code>{' '}
            reads this table directly, so there is no cache to clear.
          </li>
        </ul>
      </section>
    </>
  );
}
