/**
 * Capability-conditional PII masking (`005_contact_pii_masking.sql`).
 *
 * The rule under test, stated in capabilities rather than role names:
 *
 *   crm:edit OR crm:create -> raw email / phone_number, `pii_masked = false`
 *   crm:view only          -> masked email / phone_number, `pii_masked = true`
 *   no crm:view            -> no rows at all
 *
 * ── Why this needs a real database ──────────────────────────────────────────
 * The mechanism is view OWNERSHIP: `contact_inquiries_view` is deliberately NOT
 * `security_invoker`, so it reads the base table without that table's RLS
 * applying, and re-imposes the row rule in its own WHERE clause. The base
 * table's SELECT policy was then NARROWED so that "query the table instead of
 * the view" returns zero rows rather than raw PII. None of that is observable
 * against a mock, and the bypass — if it existed — would be silent.
 *
 * ── Expectations are read from the live matrix ──────────────────────────────
 * 005's own header says `editor` lands in the MASKED group, but a follow-up at
 * the end of that same file grants `editor` `crm:edit`, which moves it to the
 * unmasked group. This suite therefore derives masked/unmasked from
 * `role_capabilities` at run time. If a later matrix edit moves a role between
 * groups the tests follow it; if the VIEW stops honouring the matrix they fail.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ROLES } from '../types/schema';
import type { Role } from '../types/schema';
import {
  TestDb,
  expectedCapability,
  loadCapabilityMatrix,
  trackAssertions,
  type CapabilityMatrix,
} from './helpers/db';

const RAW_EMAIL = 'anita.sharma@acme-corp.co.in';
const RAW_PHONE = '+91 98765 43210';
const RAW_NAME = 'Anita Sharma';
const RAW_MESSAGE = 'Please call me back about the enterprise plan.';

const SHORT_EMAIL = 'jd@example.com';
const NO_PHONE_NAME = 'Bala Krishnan';

interface ViewRow {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  message: string;
  created_at: string | null;
  pii_masked: boolean;
}

let db: TestDb;
let matrix: CapabilityMatrix;
const users = new Map<Role, string>();
let rolelessUserId = '';
let withPhoneId = '';
let withoutPhoneId = '';
/** What mask_email/mask_phone produce for the fixtures, per the database itself. */
let maskedEmail = '';
let maskedPhone = '';
let maskedShortEmail = '';

const canView = (role: Role): boolean => expectedCapability(matrix, role, 'crm', 'view');
const unmasked = (role: Role): boolean =>
  expectedCapability(matrix, role, 'crm', 'edit') ||
  expectedCapability(matrix, role, 'crm', 'create');
const canReadRaw = (role: Role): boolean =>
  unmasked(role) || expectedCapability(matrix, role, 'crm', 'delete');

trackAssertions('pii-masking');

beforeAll(async () => {
  db = await TestDb.open('piimask');
  ({ matrix } = await loadCapabilityMatrix(db));

  for (const role of ROLES) {
    users.set(role, (await db.createUser(role)).id);
  }
  rolelessUserId = (await db.createUser(null)).id;

  withPhoneId = await db.createInquiry({
    full_name: RAW_NAME,
    email: RAW_EMAIL,
    phone_number: RAW_PHONE,
    message: RAW_MESSAGE,
  });
  withoutPhoneId = await db.createInquiry({
    full_name: NO_PHONE_NAME,
    email: SHORT_EMAIL,
    phone_number: null,
    message: 'No phone on this one.',
  });
  fixtureIds = [withPhoneId, withoutPhoneId];

  await db.asOwner();
  const masks = await db.one<{ e: string; p: string; se: string }>(
    'SELECT public.mask_email($1) AS e, public.mask_phone($2) AS p, public.mask_email($3) AS se',
    [RAW_EMAIL, RAW_PHONE, SHORT_EMAIL],
  );
  maskedEmail = masks.e;
  maskedPhone = masks.p;
  maskedShortEmail = masks.se;
});

afterAll(async () => {
  if (!db) return;
  const leaked = await db.rollbackAndVerify();
  expect(leaked).toEqual({ users: 0, roles: 0, inquiries: 0, audits: 0 });
  await db.close();
});

/**
 * Every query below is scoped to THIS file's fixture ids.
 *
 * `contact_inquiries` is a shared, long-lived table — the local database may
 * already hold seed/demo leads, and other work may add more while this suite
 * runs. Asserting on `count(*)` would make the tests depend on that, so the
 * scope is always an explicit id list. Row COUNTS are still meaningful, because
 * the question is "how many of MY two rows does this role see?".
 */
let fixtureIds: string[] = [];

const readView = async (): Promise<ViewRow[]> =>
  db.query<ViewRow & Record<string, unknown>>(
    `SELECT id, full_name, email, phone_number, message, created_at, pii_masked
       FROM public.contact_inquiries_view
      WHERE id = ANY($1::uuid[])
      ORDER BY full_name`,
    [fixtureIds],
  ) as Promise<ViewRow[]>;

const readRaw = async (): Promise<
  Array<{ id: string; email: string; phone_number: string | null }>
> =>
  db.query<{ id: string; email: string; phone_number: string | null }>(
    `SELECT id, email, phone_number FROM public.contact_inquiries
      WHERE id = ANY($1::uuid[]) ORDER BY email`,
    [fixtureIds],
  );

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The masking primitives, against their documented algorithms
 * ════════════════════════════════════════════════════════════════════════*/

describe('mask_email()', () => {
  const cases: Array<[string, string]> = [
    ['john.doe@example.com', 'j***@example.com'],
    ['JD@example.com', '***@example.com'],
    ['a+tag@sub.domain.in', 'a***@sub.domain.in'],
    ['@example.com', '***@example.com'],
    ['not-an-email', 'n***'],
    ['ab', '***'],
  ];

  it.each(cases)('masks %s -> %s', async (input, expected) => {
    await db.asOwner();
    expect(await db.value<string>('SELECT public.mask_email($1)', [input])).toBe(expected);
  });

  it('is NULL-in / NULL-out (STRICT), not a placeholder', async () => {
    await db.asOwner();
    expect(await db.value<string | null>('SELECT public.mask_email(NULL)')).toBeNull();
  });

  it('never echoes the local part back', async () => {
    await db.asOwner();
    const masked = await db.value<string>('SELECT public.mask_email($1)', [RAW_EMAIL]);
    expect(masked).not.toContain('anita.sharma');
    expect(masked).toContain('@acme-corp.co.in');
  });
});

describe('mask_phone()', () => {
  const cases: Array<[string, string]> = [
    ['+91 98765 43210', '+91 XXXXX XXX10'],
    ['+919876543210', '+91XXXXXXXX10'],
    ['9876543210', 'XXXXXXXX10'],
    ['+1 (555) 010-1234', '+1 (XXX) XXX-XX34'],
    ['12345', 'XXX45'],
    ['1234', 'XXXX'],
    ['call me', 'XXXX'],
  ];

  it.each(cases)('masks %s -> %s', async (input, expected) => {
    await db.asOwner();
    expect(await db.value<string>('SELECT public.mask_phone($1)', [input])).toBe(expected);
  });

  it('is NULL-in / NULL-out (STRICT) — a missing phone must not become "XXXX"', async () => {
    await db.asOwner();
    expect(await db.value<string | null>('SELECT public.mask_phone(NULL)')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. crm_pii_unmasked() — the rule, in one place
 * ════════════════════════════════════════════════════════════════════════*/

describe('crm_pii_unmasked()', () => {
  it.each(ROLES.map((role) => ({ role, name: role })))(
    '$name matches crm:edit OR crm:create from the live matrix',
    async ({ role }) => {
      await db.asOwner();
      const got = await db.value<unknown>('SELECT public.crm_pii_unmasked($1::uuid)', [
        users.get(role)!,
      ]);
      expect(typeof got).toBe('boolean');
      expect(got).toBe(unmasked(role));
    },
  );

  it('is false, never NULL, for a NULL user and for a user with no role', async () => {
    await db.asOwner();
    expect(await db.value<unknown>('SELECT public.crm_pii_unmasked(NULL::uuid)')).toBe(false);
    expect(
      await db.value<unknown>('SELECT public.crm_pii_unmasked($1::uuid)', [rolelessUserId]),
    ).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. contact_inquiries_view — per-role masking
 * ════════════════════════════════════════════════════════════════════════*/

describe('contact_inquiries_view', () => {
  it.each(ROLES.map((role) => ({ role, name: role })))(
    '$name sees the rows and the masking its capabilities imply',
    async ({ role }) => {
      await db.loginAs(users.get(role)!);
      const rows = await readView();

      if (!canView(role)) {
        expect(rows).toHaveLength(0);
        await db.asOwner();
        return;
      }

      expect(rows).toHaveLength(2);
      const withPhone = rows.find((r) => r.id === withPhoneId)!;
      const withoutPhone = rows.find((r) => r.id === withoutPhoneId)!;
      expect(withPhone).toBeDefined();
      expect(withoutPhone).toBeDefined();

      // The view reports the decision so the UI never re-derives it.
      expect(withPhone.pii_masked).toBe(!unmasked(role));
      expect(withoutPhone.pii_masked).toBe(!unmasked(role));

      if (unmasked(role)) {
        expect(withPhone.email).toBe(RAW_EMAIL);
        expect(withPhone.phone_number).toBe(RAW_PHONE);
        expect(withoutPhone.email).toBe(SHORT_EMAIL);
      } else {
        expect(withPhone.email).toBe(maskedEmail);
        expect(withPhone.phone_number).toBe(maskedPhone);
        expect(withoutPhone.email).toBe(maskedShortEmail);
        // Nothing recoverable leaks through.
        expect(withPhone.email).not.toBe(RAW_EMAIL);
        expect(withPhone.phone_number).not.toBe(RAW_PHONE);
        expect(withPhone.email).not.toContain('anita.sharma');
        expect(withPhone.phone_number).not.toContain('98765');
      }

      // A NULL phone stays NULL for BOTH groups — it is not masked into a
      // placeholder that would imply the customer left a number.
      expect(withoutPhone.phone_number).toBeNull();

      // full_name and message are never masked, for anybody (005 §5).
      expect(withPhone.full_name).toBe(RAW_NAME);
      expect(withPhone.message).toBe(RAW_MESSAGE);

      await db.asOwner();
    },
  );

  it('returns no rows to a signed-in user with no role at all', async () => {
    await db.loginAs(rolelessUserId);
    expect(await readView()).toHaveLength(0);
    await db.asOwner();
  });

  it('returns no rows when there is no session (auth.uid() IS NULL)', async () => {
    await db.asAuthenticatedWithoutSession();
    expect(await readView()).toHaveLength(0);
    await db.asOwner();
  });

  it('is not readable by anon at all', async () => {
    await db.asAnon();
    const err = await db.expectSqlError('SELECT * FROM public.contact_inquiries_view');
    expect(err.code).toBe('42501'); // insufficient_privilege
    await db.asOwner();
  });

  it('masking survives a filter on the masked column (the qual sees the mask)', async () => {
    // A caller cannot confirm a guessed address by filtering on `email`:
    // the outer qual is rewritten onto the CASE expression, so it compares
    // against the MASK, not the raw value.
    const masked = ROLES.find((r) => canView(r) && !unmasked(r));
    expect(masked).toBeDefined();
    await db.loginAs(users.get(masked as Role)!);

    const guess = await db.query(
      'SELECT id FROM public.contact_inquiries_view WHERE email = $1 AND id = ANY($2::uuid[])',
      [RAW_EMAIL, fixtureIds],
    );
    expect(guess).toHaveLength(0);

    const viaMask = await db.query(
      'SELECT id FROM public.contact_inquiries_view WHERE email = $1 AND id = ANY($2::uuid[])',
      [maskedEmail, fixtureIds],
    );
    expect(viaMask).toHaveLength(1);
    await db.asOwner();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. The base table is not a bypass
 * ════════════════════════════════════════════════════════════════════════*/

describe('contact_inquiries (raw table)', () => {
  it.each(ROLES.map((role) => ({ role, name: role })))(
    '$name reads the raw table only if entitled to raw identifiers',
    async ({ role }) => {
      await db.loginAs(users.get(role)!);
      // No error either way: silent emptiness is the correct RLS shape.
      const rows = await readRaw();

      if (canReadRaw(role)) {
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.email)).toContain(RAW_EMAIL);
      } else {
        // THE bypass test: a masked-only caller gets zero rows from the table,
        // so "read the table instead of the view" yields nothing at all.
        expect(rows).toHaveLength(0);
      }
      await db.asOwner();
    },
  );

  it('a masked-only role cannot count, aggregate or probe the raw table either', async () => {
    const masked = ROLES.find((r) => canView(r) && !canReadRaw(r));
    expect(masked).toBeDefined();
    await db.loginAs(users.get(masked as Role)!);

    const count = await db.value<string>(
      'SELECT count(*)::text FROM public.contact_inquiries WHERE id = ANY($1::uuid[])',
      [fixtureIds],
    );
    expect(Number(count)).toBe(0);

    const probe = await db.query(
      'SELECT id FROM public.contact_inquiries WHERE email LIKE $1 AND id = ANY($2::uuid[])',
      ['%acme-corp%', fixtureIds],
    );
    expect(probe).toHaveLength(0);

    const byId = await db.query('SELECT email FROM public.contact_inquiries WHERE id = $1', [
      withPhoneId,
    ]);
    expect(byId).toHaveLength(0);
    await db.asOwner();
  });

  it('a masked-only role cannot UPDATE ... RETURNING its way to the raw values', async () => {
    await db.beginTest();
    try {
      const masked = ROLES.find((r) => canView(r) && !canReadRaw(r))!;
      await db.loginAs(users.get(masked)!);
      const rows = await db.query(
        `UPDATE public.contact_inquiries SET message = 'tampered'
          WHERE id = ANY($1::uuid[]) RETURNING email, phone_number`,
        [fixtureIds],
      );
      expect(rows).toHaveLength(0);

      // ...and nothing was actually written.
      await db.asOwner();
      const untouched = await db.value<string>(
        'SELECT message FROM public.contact_inquiries WHERE id = $1',
        [withPhoneId],
      );
      expect(untouched).toBe(RAW_MESSAGE);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('anon can INSERT (the public contact form) but can never SELECT', async () => {
    await db.beginTest();
    try {
      await db.asAnon();
      await db.query(
        `INSERT INTO public.contact_inquiries (full_name, email, phone_number, message)
         VALUES ('Anon Visitor', 'anon@example.com', '+91 90000 00000', 'hello')`,
      );
      const err = await db.expectSqlError('SELECT * FROM public.contact_inquiries');
      expect(err.code).toBe('42501');
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. The view is the supported read path — it agrees with the raw table
 *    for the roles that can see both
 * ════════════════════════════════════════════════════════════════════════*/

describe('view / table consistency', () => {
  // Which roles are in scope is decided from the LIVE matrix inside the test —
  // `it.each` is evaluated at collection time, before `beforeAll` has run, so a
  // parameterised version here would have to hardcode the answer.
  it('every role entitled to raw identifiers sees the same values through both paths', async () => {
    const entitled = ROLES.filter((role) => canReadRaw(role));
    expect(entitled.length).toBeGreaterThan(0);

    for (const role of entitled) {
      await db.loginAs(users.get(role)!);
      const viaView = await readView();
      const viaTable = await readRaw();

      expect(viaTable.length).toBe(viaView.length);
      for (const row of viaTable) {
        const seen = viaView.find((v) => v.id === row.id)!;
        expect(seen).toBeDefined();
        expect(seen.email).toBe(row.email);
        expect(seen.phone_number).toBe(row.phone_number);
        expect(seen.pii_masked).toBe(false);
      }
    }
    await db.asOwner();
  });
});
