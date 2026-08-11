/**
 * ADVERSARIAL FINDINGS — deliberately FAILING tests.
 *
 * This file is not part of the permission-matrix suite. Every test in it
 * documents a way the permission model can be walked around that the other
 * three suites do not cover, because they test the INTENDED access paths and
 * these are unintended ones.
 *
 * ⚠ THESE TESTS ARE EXPECTED TO FAIL TODAY. Each one asserts the behaviour the
 *   system should have; the failure IS the finding. Do not "fix" a test by
 *   relaxing its assertion — fix the mechanism, or delete the test with a note
 *   saying the behaviour is accepted.
 *
 * Conventions are inherited from tests/helpers/db.ts: one file-wide transaction,
 * a SAVEPOINT per test, nothing committed. The one exception is the last test,
 * which exercises the admin UI's real write path (`app/admin/lib/db.ts`) on its
 * own connection pool and therefore commits; it cleans up after itself.
 */

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { TestDb, databaseUrl, trackAssertions } from './helpers/db';

let db: TestDb;

trackAssertions('adversarial-findings');

beforeAll(async () => {
  db = await TestDb.open('adv');
});

beforeEach(async () => {
  await db.beginTest();
});

afterEach(async () => {
  await db.asOwner();
  await db.rollbackTest();
});

afterAll(async () => {
  if (db) {
    await db.rollbackAndVerify();
    await db.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 1 — an `authenticated` session can rewrite `request.jwt.claims`
 *             and become any other user.
 *
 * 004 §2 justifies perform_action()'s anti-impersonation check with: "without
 * this check any authenticated caller could pass an admin's uuid as p_actor and
 * borrow their capabilities". The check compares p_actor against auth.uid() —
 * but auth.uid() is derived from the `request.jwt.claims` GUC (000), which is a
 * plain custom GUC that the `authenticated` role may overwrite with a bare
 * set_config() call. `auth.local_login()` is correctly REVOKEd from PUBLIC;
 * set_config() achieves exactly the same thing and is not.
 *
 * CORRECT BEHAVIOUR: a session must not be able to change the identity that
 * auth.uid() reports. The claim must be established by something the session
 * cannot write — e.g. a SECURITY DEFINER setter that only the request layer may
 * call, a per-request role, or verification of a signed token inside auth.uid()
 * itself. As long as the GUC is session-writable, every rule in 003/004/005 is
 * only as strong as "no authenticated session can ever execute arbitrary SQL".
 *
 * NOT reachable through today's surfaces: the admin UI and the MCP route both
 * connect as the table owner, and every query they issue is parameterised, so no
 * session currently runs as `authenticated` at all. This is a latent break in
 * the mechanism, not a live exploit — but it is the mechanism the whole model
 * rests on, and RLS is explicitly described (BLOCKERS #3) as what still governs
 * "browser-side/PostgREST access".
 * ═══════════════════════════════════════════════════════════════════════════*/

describe('FINDING 1: session-writable request.jwt.claims defeats every identity check', () => {
  it('an authenticated viewer cannot promote itself to admin by setting the claims GUC', async () => {
    const admin = await db.createUser('admin');
    const viewer = await db.createUser('viewer');

    await db.loginAs(viewer.id);
    expect(await db.value<string>('SELECT auth.uid()::text')).toBe(viewer.id);

    // auth.local_login() is owner-only, and correctly refuses here...
    const denied = await db.expectSqlError('SELECT auth.local_login($1::uuid)', [admin.id]);
    expect(denied.code).toBe('42501');

    // ...but set_config() on the same GUC is not restricted at all.
    await db.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: admin.id, role: 'authenticated' }),
    ]);

    const uid = await db.value<string>('SELECT auth.uid()::text');
    const role = await db.value<string | null>('SELECT public.get_user_role()');

    // EXPECTED: the session is still the viewer it authenticated as.
    expect(uid).toBe(viewer.id);
    expect(role).toBe('viewer');
  });

  it('a forged claim does not unlock raw CRM PII or a role escalation', async () => {
    const admin = await db.createUser('admin');
    const viewer = await db.createUser('viewer');
    await db.createInquiry({
      full_name: 'Adversarial Lead',
      email: 'adversarial.lead@example.test',
      phone_number: '+91 98765 43210',
      message: 'probe',
    });

    await db.loginAs(viewer.id);
    // A crm:view-only session correctly sees nothing in the raw table.
    expect(await db.query('SELECT id FROM public.contact_inquiries')).toHaveLength(0);

    await db.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: admin.id, role: 'authenticated' }),
    ]);

    const raw = await db.query<{ email: string }>('SELECT email FROM public.contact_inquiries');
    // EXPECTED: still nothing — the viewer never stopped being the viewer.
    expect(raw).toHaveLength(0);

    // And the same forged identity lets the viewer rewrite its own role row,
    // which user_roles' UPDATE policy is supposed to reserve for users:edit.
    const promoted = await db.query<{ role: string }>(
      `UPDATE public.user_roles SET role = 'admin' WHERE user_id = $1 RETURNING role`,
      [viewer.id],
    );
    expect(promoted).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 2 — the `publish` capability has no enforcement in the database.
 *
 * 003 §8.3 acknowledges that RLS cannot gate a single column and delegates
 * `publish` to "surfaces that change status". But 003 §9 grants `authenticated`
 * a direct UPDATE on public.posts and public.job_openings, and the UPDATE policy
 * only asks for blog:edit / careers:edit. So any caller that reaches the tables
 * without going through those surfaces — supabase-js, PostgREST, psql, a future
 * admin screen that forgets — can flip `status` to 'published' / 'open' with no
 * publish grant and no audit row.
 *
 * `publish` is a first-class capability in the vocabulary (ACTIONS in
 * types/schema.ts), is a column in the admin capability grid, and is one of the
 * five checkboxes an operator can toggle. An operator who unticks it has been
 * told they revoked something; they have not.
 *
 * CORRECT BEHAVIOUR: making a row publicly visible must require blog:publish /
 * careers:publish at the data layer — e.g. a BEFORE UPDATE trigger that refuses
 * a transition into the publicly-readable status without the capability, or a
 * WITH CHECK that pins `status` for non-publishers. Delegating it to the
 * application layer while simultaneously granting the table to `authenticated`
 * means the capability is advisory.
 * ═══════════════════════════════════════════════════════════════════════════*/

describe('FINDING 2: blog:publish / careers:publish are not enforced by RLS', () => {
  it('a role with blog:edit but no blog:publish can publish a draft post', async () => {
    const user = await db.createUser('viewer');

    await db.asOwner();
    // Put the fixture role in the state an operator would produce with the
    // capability grid: edit ticked, publish explicitly unticked.
    await db.query(`DELETE FROM public.role_capabilities WHERE role = 'viewer'`);
    await db.query(
      `INSERT INTO public.role_capabilities (role, resource_key, action, allowed) VALUES
         ('viewer','blog','view',true), ('viewer','blog','edit',true), ('viewer','blog','publish',false)`,
    );
    const postId = await db.value<string>(
      `INSERT INTO public.posts (title, slug, category, content_blocks, status)
       VALUES ('adv', 'adv-finding-2-post', 'general', '[]'::jsonb, 'draft') RETURNING id`,
    );

    expect(await db.value<boolean>(`SELECT public.user_has_capability($1,'blog','publish')`, [user.id])).toBe(false);
    expect(await db.value<boolean>(`SELECT public.user_has_capability($1,'blog','edit')`, [user.id])).toBe(true);

    await db.loginAs(user.id);
    const updated = await db.query<{ status: string }>(
      `UPDATE public.posts SET status = 'published' WHERE id = $1 RETURNING status`,
      [postId],
    );

    // EXPECTED: RLS refuses the transition into the anon-readable state.
    expect(updated).toHaveLength(0);

    await db.asOwner();
    expect(await db.value<string>('SELECT status FROM public.posts WHERE id = $1', [postId])).toBe('draft');
    // ...and, because nothing went through perform_action(), it is unaudited.
    expect(
      Number(await db.value<string>('SELECT count(*) FROM public.action_audit_log WHERE target_id = $1', [postId])),
    ).toBeGreaterThan(0);
  });

  it('a role with careers:edit but no careers:publish can open a draft job listing', async () => {
    const user = await db.createUser('viewer');

    await db.asOwner();
    await db.query(`DELETE FROM public.role_capabilities WHERE role = 'viewer'`);
    await db.query(
      `INSERT INTO public.role_capabilities (role, resource_key, action, allowed) VALUES
         ('viewer','careers','view',true), ('viewer','careers','edit',true), ('viewer','careers','publish',false)`,
    );
    const jobId = await db.value<string>(
      `INSERT INTO public.job_openings (title, slug, description, status)
       VALUES ('adv', 'adv-finding-2-job', 'd', 'draft') RETURNING id`,
    );

    await db.loginAs(user.id);
    const updated = await db.query<{ status: string }>(
      `UPDATE public.job_openings SET status = 'open' WHERE id = $1 RETURNING status`,
      [jobId],
    );

    // EXPECTED: refused — 'open' is the publicly readable state.
    expect(updated).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 3 — perform_action() authorizes a CLAIM, not a mutation, so any
 *             capability holder can forge entries in the append-only audit log.
 *
 * `action_audit_log` has no INSERT policy and no INSERT grant for
 * `authenticated` (004 §1) — "an audit log its subjects can write to, amend or
 * erase is decoration". But perform_action() is SECURITY DEFINER, is granted to
 * `authenticated`, and inserts p_target_id / p_payload verbatim after checking
 * only that the caller holds SOME capability on the named resource. It never
 * verifies that the described change happened, or that the target exists.
 *
 * Consequence: a crm:view-only user (the least privileged role that holds any
 * CRM grant at all) can write audit rows that read exactly like a real triage
 * action on a real lead, with fabricated before/after state — using nothing but
 * the `view` action, which mutates nothing and therefore has no legitimate
 * reason to accept a payload at all.
 *
 * CORRECT BEHAVIOUR: at minimum, a caller must not be able to insert an audit
 * record whose target does not exist and whose before/after describe a change
 * that did not occur. Options: bind perform_action() to the mutation it
 * authorizes (return a token the write path must present), reject before/after
 * payloads for non-mutating actions, or stop granting EXECUTE on it to
 * `authenticated` and let only the trusted server context call it.
 * ═══════════════════════════════════════════════════════════════════════════*/

describe('FINDING 3: audit-log forgery through perform_action()', () => {
  it('a crm:view-only user cannot fabricate an audit record of a change it never made', async () => {
    const viewer = await db.createUser('viewer');
    const inquiryId = await db.createInquiry({
      full_name: 'Real Lead',
      email: 'real.lead@example.test',
      phone_number: null,
      message: 'real',
    });

    await db.loginAs(viewer.id);
    // Direct INSERT is correctly refused...
    const denied = await db.expectSqlError(
      `INSERT INTO public.action_audit_log (actor, resource_key, action) VALUES ($1,'crm','edit')`,
      [viewer.id],
    );
    expect(denied.code).toBe('42501');

    // ...but perform_action() will write whatever it is handed.
    await db.query(
      `SELECT public.perform_action($1,'crm','view',$2,$3::jsonb)`,
      [
        viewer.id,
        inquiryId,
        JSON.stringify({ before: { status: 'new' }, after: { status: 'resolved by me' } }),
      ],
    );

    await db.asOwner();
    const forged = await db.query(
      `SELECT id FROM public.action_audit_log
        WHERE actor = $1 AND target_id = $2 AND after_data ? 'status'`,
      [viewer.id, inquiryId],
    );

    // EXPECTED: no such row — nothing about that inquiry actually changed.
    expect(forged).toHaveLength(0);
  });

  it('the audit log records a canonical actor, so "everything user X did" is answerable', async () => {
    const viewer = await db.createUser('viewer');

    await db.loginAs(viewer.id);
    // perform_action() resolves a uuid through ::uuid (which accepts a braced
    // form) and an email through lower(btrim(...)), then stores p_actor VERBATIM.
    // Three spellings of one identity, three different `actor` strings.
    await db.query(`SELECT public.perform_action($1,'crm','view')`, [viewer.id]);
    await db.query(`SELECT public.perform_action($1,'crm','view')`, [`{${viewer.id}}`]);
    await db.query(`SELECT public.perform_action($1,'crm','view')`, [`  ${viewer.email.toUpperCase()}  `]);

    await db.asOwner();
    const byCanonicalId = Number(
      await db.value<string>('SELECT count(*) FROM public.action_audit_log WHERE actor = $1', [viewer.id]),
    );

    // EXPECTED: all three rows are attributable to the identity that produced
    // them. Today only one is, so an "actions by user X" query silently
    // under-reports — and the actor column is attacker-chosen free text.
    expect(byCanonicalId).toBe(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 4 — crm:create (or crm:delete) grants raw PII reads even when
 *             crm:view is explicitly DENIED.
 *
 * 005 §4 narrows contact_inquiries' SELECT policy to
 *   crm_pii_unmasked(uid) OR user_has_capability(uid,'crm','delete')
 * i.e. crm:edit OR crm:create OR crm:delete — crm:view is not part of it.
 * The masked view keeps requiring crm:view.
 *
 * That makes the RAW table strictly more permissive than the "supported read
 * path" for any role that can act on an inquiry but has not been granted (or
 * has been explicitly denied) crm:view. types/schema.ts states the contract as
 * "no crm:view -> no rows at all"; the base table does not honour it.
 *
 * This is reachable straight from the admin capability grid: untick `view` for
 * support_bot_text while leaving `create` ticked — the intuitive way to say
 * "this bot may append messages but may not read the lead list" — and the bot
 * can still read every lead's real email and phone number.
 *
 * CORRECT BEHAVIOUR: crm:view should be a precondition for reading
 * contact_inquiries at all, with crm:edit/create/delete deciding only whether
 * the identifiers arrive raw. (The 005 §4 comment argues the delete case
 * deliberately — "so a future matrix that grants delete without edit does not
 * produce a role that can destroy rows it cannot read" — but it does not
 * consider create-without-view, and does not consider an EXPLICIT deny.)
 * ═══════════════════════════════════════════════════════════════════════════*/

describe('FINDING 4: crm:create bypasses an explicit crm:view deny on raw PII', () => {
  it('a role explicitly denied crm:view cannot read contact_inquiries', async () => {
    const bot = await db.createUser('support_bot_text');
    await db.createInquiry({
      full_name: 'Lead Four',
      email: 'lead.four@example.test',
      phone_number: '+91 98765 43210',
      message: 'probe',
    });

    await db.asOwner();
    await db.query(`DELETE FROM public.role_capabilities WHERE role = 'support_bot_text'`);
    await db.query(
      `INSERT INTO public.role_capabilities (role, resource_key, action, allowed) VALUES
         ('support_bot_text','crm','view',false), ('support_bot_text','crm','create',true)`,
    );
    expect(await db.value<boolean>(`SELECT public.user_has_capability($1,'crm','view')`, [bot.id])).toBe(false);

    await db.loginAs(bot.id);

    // The masked view correctly returns nothing.
    expect(await db.query('SELECT id FROM public.contact_inquiries_view')).toHaveLength(0);

    // EXPECTED: the raw table returns nothing either.
    const raw = await db.query<{ email: string; phone_number: string | null }>(
      'SELECT email, phone_number FROM public.contact_inquiries',
    );
    expect(raw).toHaveLength(0);
  });

  it('a role holding only crm:delete cannot read contact_inquiries without crm:view', async () => {
    const user = await db.createUser('viewer');
    await db.createInquiry({
      full_name: 'Lead Five',
      email: 'lead.five@example.test',
      phone_number: null,
      message: 'probe',
    });

    await db.asOwner();
    await db.query(`DELETE FROM public.role_capabilities WHERE role = 'viewer'`);
    await db.query(`INSERT INTO public.role_capabilities VALUES ('viewer','crm','delete',true)`);

    await db.loginAs(user.id);
    // EXPECTED: reading rows requires crm:view; deletion by id does not require
    // reading the whole lead list in cleartext.
    expect(await db.query('SELECT email FROM public.contact_inquiries')).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 5 — user_has_capability() is an open privilege-enumeration oracle.
 *
 * 003 §5 grants EXECUTE on user_has_capability(uuid, text, text) to
 * `authenticated` because RLS policy expressions are evaluated as the calling
 * role. But the function takes an arbitrary uuid, so any signed-in user can also
 * call it directly and read out ANY other user's effective permissions —
 * including "who holds users:edit", i.e. a target list for a phishing or session
 * theft attempt. The equivalent data in user_roles and role_capabilities is
 * carefully restricted (self-read only, or users:view); this function hands out
 * the same answers with no restriction.
 *
 * CORRECT BEHAVIOUR: a caller may probe its own capabilities freely; probing
 * another identity's should require users:view. The RLS policies themselves are
 * unaffected — they always pass auth.uid().
 * ═══════════════════════════════════════════════════════════════════════════*/

describe('FINDING 5: any authenticated user can enumerate any other user’s privileges', () => {
  it('a viewer cannot read out an admin’s capabilities', async () => {
    const admin = await db.createUser('admin');
    const viewer = await db.createUser('viewer');

    await db.loginAs(viewer.id);
    const probed = await db.one<{ a: boolean; b: boolean }>(
      `SELECT public.user_has_capability($1,'users','edit') AS a,
              public.user_has_capability($1,'crm','delete')  AS b`,
      [admin.id],
    );

    // EXPECTED: probing a different identity discloses nothing.
    expect(probed.a).toBe(false);
    expect(probed.b).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 6 — the admin UI's single write path performs NO capability check in
 *             the configuration this repo actually ships.
 *
 * `mutate()` in app/admin/lib/db.ts routes through perform_action() only when
 * ADMIN_ACTOR names an identity. `.env.local` does not set ADMIN_ACTOR, so the
 * `else` branch runs: the mutation is applied on an RLS-bypassing owner
 * connection and an audit row is written directly as 'system:admin-ui', with no
 * capability decision anywhere in the path. Combined with BLOCKERS #3 (no auth
 * layer, no middleware) this means every admin Server Action is reachable by an
 * unauthenticated HTTP request.
 *
 * Verified end-to-end against a running `next dev` — no cookies, no token:
 *
 *   curl -X POST http://localhost:3000/admin/users/capabilities \
 *     -H 'content-type: application/json' \
 *     -H 'Next-Action: <id from /_next/static/chunks/app/admin/users/capabilities/page.js>' \
 *     -d '[{"role":"viewer","resourceKey":"careers","action":"view","allowed":true}]'
 *
 * ...returned 200 and inserted ('viewer','careers','view',true) into
 * role_capabilities, audited as actor 'system:admin-ui'. An anonymous caller can
 * therefore rewrite the entire capability matrix, including granting a role it
 * controls users:edit or crm:delete. Setting ADMIN_ACTOR does not fix this — it
 * only means the anonymous caller inherits that identity's capabilities instead
 * of having none checked.
 *
 * CORRECT BEHAVIOUR: `mutate()` must fail closed when there is no identity to
 * authorize against, rather than degrading to an unchecked write. "Nobody is
 * signed in" is not a reason to skip the permission check; it is the strongest
 * possible reason to refuse.
 *
 * This test uses the real module and its own pool, so it COMMITS. It removes the
 * audit row it creates. It deliberately performs no data mutation.
 * ═══════════════════════════════════════════════════════════════════════════*/

describe('FINDING 6: mutate() fails OPEN when no actor is configured', () => {
  it('refuses to write when there is no identity to check a capability against', async () => {
    process.env.DATABASE_URL ??= databaseUrl();
    delete process.env.ADMIN_ACTOR; // the state `.env.local` ships in

    const { mutate, getPool, ANONYMOUS_ADMIN_ACTOR } = await import('../app/admin/lib/db');
    const marker = `adversarial-finding-6:${Date.now()}`;

    let refused = false;
    try {
      await mutate(async () => ({
        result: undefined,
        audit: {
          // The most privileged capability in the system. Nothing checks it.
          resourceKey: 'users',
          action: 'edit' as const,
          targetId: marker,
          before: null,
          after: { note: 'no session, no actor, no capability check' },
        },
      }));
    } catch {
      refused = true;
    } finally {
      await getPool().query('DELETE FROM public.action_audit_log WHERE target_id = $1', [marker]);
    }

    // EXPECTED: mutate() raises rather than writing an unauthorized,
    // unattributable change.
    expect(refused).toBe(true);
    expect(ANONYMOUS_ADMIN_ACTOR).toBe('system:admin-ui');
  });
});
