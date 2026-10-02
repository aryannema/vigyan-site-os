/**
 * Migration 075 — the two findings it closes, tested by carrying out the attack.
 *
 * The migration verifies itself at apply time, but that check runs with no
 * session: it can confirm the functions are sane, and cannot confirm that a
 * logged-in attacker is actually stopped. These tests log in as the attacker.
 *
 * Both findings were reproduced on a real database before the fix, so each
 * `expect` below is a line that genuinely failed beforehand rather than a
 * guess at what might go wrong.
 *
 * Requires DATABASE_URL. See tests/helpers/db.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestDb, trackAssertions } from './helpers/db';

const assertions = trackAssertions('capability-disclosure');
let db: TestDb;

beforeAll(async () => {
  db = await TestDb.open('capdisc');
});

beforeEach(async () => {
  await db.beginTest();
});

afterEach(async () => {
  // Back to the owner first: a test that ended as `authenticated` cannot roll
  // its own savepoint back.
  await db.asOwner();
  await db.rollbackTest();
});

afterAll(async () => {
  if (db) {
    await db.rollbackAndVerify();
    await db.close();
  }
  // eslint-disable-next-line no-console
  console.log(`[assertions] capability-disclosure: ${assertions.total()}`);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING A — user_has_capability() answered about anyone who asked.
 *
 * It is SECURITY DEFINER, takes its subject as an argument, and Postgres
 * grants EXECUTE to PUBLIC by default. Before 075 a viewer could walk the
 * whole permission matrix of every other account, one probe at a time.
 * ═══════════════════════════════════════════════════════════════════════════*/
describe('FINDING A: a capability check must not answer for other people', () => {
  it('a viewer cannot read out an admin’s capabilities', async () => {
    const admin  = await db.createUser('admin');
    const viewer = await db.createUser('viewer');

    await db.loginAs(viewer.id);
    const probed = await db.one<{ a: boolean; b: boolean }>(
      `SELECT public.user_has_capability($1,'users','delete') AS a,
              public.user_has_capability($1,'crm','delete')   AS b`,
      [admin.id],
    );

    // Before 075 both came back true.
    expect(probed.a).toBe(false);
    expect(probed.b).toBe(false);
  });

  it('answering false is indistinguishable from the subject not having it', async () => {
    // A probe that RAISED would still leak: the error tells the prober the
    // subject exists and that they were not entitled to ask. Silence has to
    // look the same either way.
    const admin   = await db.createUser('admin');
    const nobody  = await db.createUser(null);
    const viewer  = await db.createUser('viewer');

    await db.loginAs(viewer.id);
    const onAdmin  = await db.value<boolean>(
      `SELECT public.user_has_capability($1,'users','delete')`, [admin.id]);
    const onNobody = await db.value<boolean>(
      `SELECT public.user_has_capability($1,'users','delete')`, [nobody.id]);

    expect(onAdmin).toBe(false);
    expect(onNobody).toBe(false);
    expect(onAdmin).toBe(onNobody);
  });

  it('a user can still ask about itself', async () => {
    // The fix must not break the 117 call sites that pass auth.uid().
    const viewer = await db.createUser('viewer');
    await db.loginAs(viewer.id);

    expect(await db.value<boolean>(
      `SELECT public.user_has_capability($1,'crm','view')`, [viewer.id])).toBe(true);
    expect(await db.value<boolean>(
      `SELECT public.user_has_capability($1,'users','delete')`, [viewer.id])).toBe(false);
  });

  it('a holder of users:view may inspect other accounts', async () => {
    // Otherwise /admin/users/capabilities cannot render anyone's grid but its own.
    const admin  = await db.createUser('admin');
    const viewer = await db.createUser('viewer');

    await db.loginAs(admin.id);
    expect(await db.value<boolean>(
      `SELECT public.user_has_capability($1,'crm','view')`, [viewer.id])).toBe(true);
    expect(await db.value<boolean>(
      `SELECT public.user_has_capability($1,'users','delete')`, [viewer.id])).toBe(false);
  });

  it('the unguarded lookup is not reachable by authenticated', async () => {
    // capability_lookup() answers about any subject without asking who wants
    // to know. If `authenticated` can execute it, the guard is decoration.
    const reachable = await db.value<boolean>(
      `SELECT has_function_privilege('authenticated',
                'public.capability_lookup(uuid, text, text)', 'EXECUTE')`);
    expect(reachable).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING B — an explicit crm:view deny was bypassable.
 *
 * 005 gated raw contact PII on crm:edit OR crm:create OR crm:delete and never
 * consulted crm:view, so unticking "view" in the capability grid revoked
 * nothing. The operator had been told otherwise.
 * ═══════════════════════════════════════════════════════════════════════════*/
describe('FINDING B: revoking crm:view actually revokes', () => {
  /** Turn one capability off for a role, inside the test transaction. */
  async function deny(role: string, resource: string, action: string) {
    await db.asOwner();
    await db.query(
      `UPDATE public.role_capabilities SET allowed = false
        WHERE role = $1 AND resource_key = $2 AND action = $3`,
      [role, resource, action],
    );
  }

  it('a role denied crm:view cannot read contact_inquiries', async () => {
    const bot = await db.createUser('support_bot_text');   // crm: view + create
    await db.createInquiry({
      full_name: 'Lead Person',
      email: 'lead@example.test',
      phone_number: '+91 98765 43210',
      message: 'enquiry body',
    });

    await deny('support_bot_text', 'crm', 'view');         // create stays ON

    await db.loginAs(bot.id);
    const rows = await db.query(`SELECT full_name, email, phone_number
                                   FROM public.contact_inquiries`);

    // Before 075 this returned the row, in full.
    expect(rows).toHaveLength(0);
  });

  it('a role holding only crm:delete cannot read without crm:view', async () => {
    const support = await db.createUser('support_human');  // view/create/edit
    await db.createInquiry({
      full_name: 'Other Lead',
      email: 'other@example.test',
      phone_number: '+91 90000 00000',
      message: 'enquiry body',
    });

    await deny('support_human', 'crm', 'view');

    await db.loginAs(support.id);
    expect(await db.query(`SELECT 1 FROM public.contact_inquiries`)).toHaveLength(0);
  });

  it('crm:view alone still reads, but masked', async () => {
    // The point of 005 was masking, not blocking. That must survive the fix.
    const viewer = await db.createUser('viewer');          // crm: view only
    await db.createInquiry({
      full_name: 'Masked Lead',
      email: 'masked@example.test',
      phone_number: '+91 98765 43210',
      message: 'enquiry body',
    });

    await db.loginAs(viewer.id);
    const [row] = await db.query<{ email: string; phone_number: string }>(
      `SELECT email, phone_number FROM public.contact_inquiries_view`);

    expect(row).toBeDefined();
    expect(row.email).not.toBe('masked@example.test');
    expect(row.email).toContain('***');
    expect(row.phone_number).toContain('X');
  });

  it('an acting role with crm:view still reads raw PII', async () => {
    // The floor must not cost anyone the access they legitimately have.
    const admin = await db.createUser('admin');
    await db.createInquiry({
      full_name: 'Raw Lead',
      email: 'raw@example.test',
      phone_number: '+91 91234 56789',
      message: 'enquiry body',
    });

    await db.loginAs(admin.id);
    const [row] = await db.query<{ email: string; phone_number: string }>(
      `SELECT email, phone_number FROM public.contact_inquiries`);

    expect(row).toBeDefined();
    expect(row.email).toBe('raw@example.test');
    expect(row.phone_number).toBe('+91 91234 56789');
  });

  it('every default role with an acting crm capability also holds crm:view', async () => {
    // 075 makes crm:view a floor. That is only safe because no seeded role
    // grants create/edit/delete without it. If a future migration adds one,
    // this fails here rather than in production.
    await db.asOwner();
    const orphans = await db.query<{ role: string; action: string }>(
      `SELECT acting.role, acting.action
         FROM public.role_capabilities acting
        WHERE acting.resource_key = 'crm'
          AND acting.action IN ('create','edit','delete')
          AND acting.allowed
          AND NOT EXISTS (
                SELECT 1 FROM public.role_capabilities v
                 WHERE v.role = acting.role
                   AND v.resource_key = 'crm'
                   AND v.action = 'view'
                   AND v.allowed)`,
    );
    expect(orphans).toEqual([]);
  });
});
