# Adding a feature

A complete worked example. We'll add a testimonials section — customers submit a quote, you
approve it, approved ones show on the home page.

Follow along and you'll see every command and what it prints.

---

## The 4 skills, and when each runs

```
You: "add testimonials"
      │
      ├─ 1. feature-intake     decide WHAT to build      (5 min talking)
      ├─ 2. feature-schema     database table + rules    (writes a .sql file)
      ├─ 3.  (you build UI)    admin page + public page  (normal React work)
      └─ 4. feature-testing    browser check + tests     (writes a .spec.ts file)
```

You don't invoke these manually. You say *"add testimonials"* and Claude runs them in order.
Knowing they exist helps you tell when one got skipped.

---

## Step 1 — `feature-intake`: decide what to build

Claude asks you 3–4 questions. Not a form — it stops when the answers stop changing the build.

```
Q: What happens today without this?
A: Prospects ask for references, I paste them in email.

Q: How many testimonials, how often?
A: Maybe 20, a few new ones per month.

Q: Who approves them?
A: Only me.

Q: Should these come from Trustpilot instead?
A: No, I collect them myself.
```

That last question matters. **Testimonials can be built two completely different ways:**

| | Build it yourself | Use Trustpilot |
|---|---|---|
| Where data lives | your database | their servers |
| Can you SQL query it | yes | no, export only |
| Cost | ₹0 | ~₹2,000+/month |
| Visitor trust | it's your own site saying it | third-party badge |
| If they go down | n/a | your section breaks |

**Rule of thumb:** does a visitor believe it *more* because of whose logo is on it?
Trustpilot — yes, that's the whole product. Your own quotes — no. So build it.

**Output of this step:** a short plan you approve.

> *"Testimonials, built not integrated. One table, admin approve/reject screen, home page
> section. About a day. One thing to note: approved quotes are public, so the submit form must
> say that."*

---

## Step 2 — `feature-schema`: the database

Claude writes a new file. They're numbered — look at the last one and add 1:

```bash
ls supabase/migrations | tail -1
# 075_capability_disclosure.sql   →  yours is 076_testimonials.sql
```

### Rule: never edit an old migration file

Migration `075` already ran on the database. If you edit that file now, **nothing happens** —
it won't run again. Your change does nothing, and now your file doesn't match what's actually
in the database.

Wrong thing to add a column → edit `076`? No. Write `077`.

### What goes in the file

```sql
CREATE TABLE public.testimonials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote        text NOT NULL,
  company      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
```

### ⚠️ The mistake everyone makes

You just enabled Row Level Security. **You must now write a policy, in the same file.**

Enable RLS with no policy → every query returns **0 rows**. Not an error. Not a warning. Just
an empty result, and you spend two hours debugging your React code.

```sql
-- visitors see approved ones
CREATE POLICY "testimonials_public_read"
  ON public.testimonials FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- staff with permission see everything
CREATE POLICY "testimonials_staff_read"
  ON public.testimonials FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'testimonials', 'view'));
```

### Permissions: 3 things or it doesn't work

**1. Register the name** in `src/types/schema.ts`:

```ts
export const RESOURCE_KEYS = [ 'cms', 'blog', 'crm', 'testimonials' ] as const;
```

Skip this → your admin permissions screen has no row for testimonials. Nobody can be granted
anything.

**2. Grant it to roles** (in the same migration):

```sql
INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES ('admin','testimonials','view',   true),
       ('admin','testimonials','publish',true),
       ('editor','testimonials','view',  true),
       ('editor','testimonials','publish', false);   -- editors can't approve
```

**3. `view` is required for everything else.** Since migration 075:

```
grant publish but not view  →  they get NOTHING
```

If someone can approve testimonials, they must also be able to view them. Always grant `view`
alongside anything else.

### Test it on a scratch database, never production

```bash
createdb testdb
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -d testdb -f "$f"
done
```

If any file fails, `ON_ERROR_STOP=1` halts immediately instead of continuing with a
half-applied schema.

Then:

```bash
DATABASE_URL="postgresql://...@localhost:5432/testdb" pnpm test:db
```

```
Test Files  6 passed (6)
     Tests  313 passed (313)
```

If this goes red after your migration, you broke a permission rule. Fix it before touching the
UI.

---

## Step 3 — Build the UI

Normal React work. Admin page at `src/app/(app)/admin/testimonials/page.tsx`, public section
on the home page. Nothing special about this step.

---

## Step 4 — `feature-testing`: three layers

### 4a. Auto-generated tests — free, you write nothing

```bash
pnpm gen:e2e
```

```
generated e2e/generated/routes.spec.ts      (19 routes x 4 checks)
generated e2e/generated/permissions.spec.ts (matrix invariants, DB-driven)
```

It scans `src/app/**/page.tsx`. Every page you create is automatically checked for:

- loads without a 500
- has exactly one `<h1>`
- no console errors
- every `<img>` has `alt`

**You never maintain this list.** Add a page → it's covered next time you run `pnpm gen:e2e`.

### 4b. Browser pass — Claude clicks around

Claude opens Chrome and uses it: tabs through with the keyboard, submits the form empty,
resizes to 360px, reads the page the way a screen reader does.

**This finds things that look fine in code.** Real example from this repo:

The home page has a scrolling row of service cards. To make the scroll loop seamlessly, the
code duplicates the cards:

```js
// the bug
originalChildren.forEach(item => scroller.appendChild(item.cloneNode(true)));
```

Looks fine. But in the browser:

```js
document.querySelectorAll('a').filter(a => a.textContent.includes('See more')).length
// → 10 links, for 5 destinations
```

A keyboard user tabs through all 10. A screen reader reads the service list twice. You cannot
see this by reading the code.

The fix:

```js
const clone = item.cloneNode(true);
clone.setAttribute('inert', '');           // removes from tab order AND screen readers
clone.setAttribute('aria-hidden', 'true');
```

### 4c. Turn the finding into a permanent test

This is the important part. One assertion, written to catch the *rule*, not this one bug:

```ts
test('no link is reachable twice for the same destination', async ({ page }) => {
  await page.goto('/');
  const reachable = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .filter(a => !a.closest('[inert]'))
      .map(a => `${a.textContent.trim()}|${a.getAttribute('href')}`)
  );
  const counts = {};
  reachable.forEach(k => counts[k] = (counts[k] ?? 0) + 1);
  expect(Object.entries(counts).filter(([,n]) => n > 1)).toEqual([]);
});
```

Now **any** carousel anyone adds in future is covered by this same test.

### ⚠️ Always check your test can actually fail

```bash
git stash              # remove your fix
pnpm test:e2e          # test MUST go red here
git stash pop          # restore
pnpm test:e2e          # now green
```

If it's green both times, your test is checking nothing. This is easy to do by accident — we
did it:

```ts
// BUG: passes when there are zero clones, because [].every() === true
expect(clones.every(c => c.hasAttribute('inert'))).toBe(true);

// FIX: bail out loudly instead of passing vacuously
test.skip(clones.length === 0, 'no marquee on this page');
expect(clones.every(c => c.hasAttribute('inert'))).toBe(true);
```

---

## The three test commands

```bash
pnpm test        # plain unit tests      — no database, no server, ~2s
pnpm test:db     # permissions & privacy — needs DATABASE_URL
pnpm test:e2e    # real browser          — starts a dev server on :3210
```

Three separate commands so a failure tells you *which layer* broke. If they were one command,
`pnpm test` would fail on any laptop without Postgres.

---

## How to know tests actually ran

Before `pnpm test:e2e` starts, it prints what it can and cannot check:

```
[ON ] Site reachable
[ON ] Postgres (DATABASE_URL)
[OFF] Transactional email (Resend)
      ↳ set RESEND_API_KEY to run the delivery round-trip
      ↳ untested: invoice email actually leaves the building
[OFF] WhatsApp / OTP
      ↳ set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID
      ↳ untested: an OTP is delivered to a real handset

4 of 7 capabilities are OFF. The suite can still go green;
what it proves is limited to the ON rows above.
```

**Why this exists:** clone this repo fresh, configure nothing, run the tests → "42 passed".
Without the printout above you'd think your email works. It was never checked.

### Tests that need external services

Two modes:

```
No RESEND_API_KEY  →  the HTTP call is intercepted
                      ✅ your code ran, request shape is correct
                      ❌ nothing was actually emailed

With RESEND_API_KEY →  real send, real delivery check
```

Both are useful. The suite tells you which one it did.

---

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| RLS on, no policy | every query returns 0 rows, no error | write the policy in the same migration |
| Forgot `RESOURCE_KEYS` | no row in the admin permission grid | add it in `src/types/schema.ts` |
| Granted `publish` without `view` | user gets nothing | always grant `view` too |
| Edited an applied migration | your change has no effect | write the next-numbered file |
| Test passes before and after | you're testing nothing | `git stash`, confirm red |
| `[].every()` assertion | passes on an empty page | add `test.skip` when count is 0 |
| Wrong dev server port | "fix doesn't work" but it does | `ls -l /proc/$(pgrep -f next-server)/cwd` |

That last one cost an hour here. Two dev servers were running from **different git worktrees of
the same repo**. The fix was verified against the checkout that didn't have it. No error
anywhere — it just silently tested the wrong code.

---

## Checklist before you call it done

```bash
pnpm typecheck          # compiles
pnpm test               # units green
pnpm test:db            # permissions green
pnpm gen:e2e            # regenerate route tests
pnpm test:e2e           # browser green
```

Plus:

- [ ] the new test goes **red** with `git stash` applied
- [ ] `node scripts/sql-classify.mjs` shows your migration in the tier you intended
- [ ] you wrote down whether this goes to the public template
      (`work-units/session-state.json` → `public_template_sync`)

---

## What to ask Claude

- **"Show me."** Get the URL, look at it.
- **"Did you prove the test fails without the fix?"** The single best question.
- **"What did you NOT test?"** There's always something. A straight answer names it.
