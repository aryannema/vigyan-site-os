# Testing — what exists, how to run it, and what is not covered

Four layers, four commands. They are separate on purpose: folded into one, `pnpm test` would
fail on any machine without Postgres, and a failure would not tell you which layer broke.

```bash
pnpm typecheck    # tsc --noEmit                    — seconds, no deps
pnpm test         # vitest, unit                    — ~2s, no deps
pnpm test:db      # vitest + real Postgres          — needs DATABASE_URL
pnpm gen:e2e      # regenerate route tests          — run after adding a page
pnpm test:e2e     # Playwright, real browser        — starts a dev server on :3210
```

---

## Layer 1 — unit

```bash
pnpm test
```

326 tests, 28 files. Content parsing, serialization, pricing arithmetic, phone validation. No
database, no server, runs anywhere.

---

## Layer 2 — database

```bash
createdb vb_test
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -d vb_test -f "$f"
done
DATABASE_URL="postgresql://user@localhost:5432/vb_test" pnpm test:db
```

`ON_ERROR_STOP=1` matters — without it a failed migration is skipped and you test a
half-applied schema.

This is where the permission model is verified: `tests/capability-disclosure.test.ts` carries out
the actual attacks. It logs in as a viewer and tries to read an admin's capabilities; it revokes
`crm:view` from a role and tries to read raw PII.

**These tests are proven meaningful, not assumed.** Against a schema with migration 075 skipped,
two assertions fail with *expected true to be false*:

```bash
# build a database WITHOUT the fix — the tests must go red
for f in supabase/migrations/*.sql; do
  case "$(basename $f)" in 075_*) continue ;; esac
  psql -v ON_ERROR_STOP=1 -d vb_nofix -f "$f"
done
DATABASE_URL="postgresql://user@localhost:5432/vb_nofix" pnpm test:db   # MUST FAIL
```

A test that passes with and without the fix proves nothing, and you will not discover that
later — you will simply trust it.

**Cannot run in parallel.** `SET ROLE` and the session identity are connection-wide, so two
files interleaving would see each other's role changes. `vitest.db.config.mts` sets
`fileParallelism: false`.

---

## Layer 3 — browser

```bash
pnpm gen:e2e      # first, if routes changed
pnpm test:e2e
pnpm test:e2e:ui  # interactive, for debugging a failure
```

**Port 3210, deliberately.** A dev server for the *main* checkout runs on 3000 on this machine,
and a fix was once "verified" against a worktree that did not contain it — same repo, different
branch, no error anywhere. Check before trusting a browser result:

```bash
pid=$(ss -ltnp | grep ':3210' | grep -oE 'pid=[0-9]+' | cut -d= -f2)
ls -l /proc/$pid/cwd
```

### What runs

| Spec | Covers |
|---|---|
| `e2e/generated/routes.spec.ts` | every page: renders, one `h1`, no console errors, `alt` on every image |
| `e2e/generated/permissions.spec.ts` | matrix invariants read from the live database |
| `e2e/ux.spec.ts` | axe wcag2a/2aa, focus visibility, no horizontal overflow, decorative duplicates inert |
| `e2e/branding.spec.ts` | design tokens resolve, contrast computed from what the page paints |
| `e2e/functional.spec.ts` | lead-form validation, labels, live-region announcements |

### Generated, not written

`pnpm gen:e2e` derives route tests from `src/app/**/page.tsx` — the App Router *is* the route
manifest, so a new page is covered the moment it exists and there is no list to forget.

Generated tests assert only what a generator can know. They say nothing about meaning: a
generator cannot know the annual toggle should cut the monthly figure by 20%, and one that
guesses produces confident nonsense. **Never edit `e2e/generated/` — it is overwritten.**

---

## Layer 4 — the agentic pass

Not a command. Claude drives a real browser through the feature: tabs with the keyboard, submits
the form empty, submits it wrong, resizes to 360px, reads the page through the accessibility tree
rather than the rendered text.

**This is where the surprising things turn up.** The marquee finding came from here: ten
keyboard-reachable "See more" links for five destinations, invisible in the source, obvious in a
browser. Nothing in axe catches it.

The workflow that matters:

```
agent explores  →  finds something  →  ONE generalised assertion in e2e/*.spec.ts
                                    →  runs free on every commit, forever
```

The agent is slow, expensive and non-reproducible; the assertion is none of those. Run the agent
when something new is built. Run the suite always.

**Generalise to the rule, not the instance.** "No link reachable twice for the same destination"
outlives the component that prompted it and covers any carousel anyone adds later.

---

## Two harness faults worth not repeating

**An assertion passed vacuously.** `[].every()` is `true`, so a check over "all the clones" on a
page with zero clones reported success:

```ts
test.skip(result.count === 0, 'no marquee on this page');   // guard FIRST
expect(result.allInert).toBe(true);
```

**A fix was verified against the wrong worktree.** Two dev servers, same repo, different
branches, no error anywhere. Hence the explicit port and the `/proc/<pid>/cwd` check above.

---

## Skips must be honest

A skipped test and a passing test look identical in a green summary. `e2e/capabilities.ts`
detects what an install can actually exercise and **prints it** before anything runs:

```
[ON ] Site reachable
[OFF] Transactional email (Resend)
      ↳ set RESEND_API_KEY to run the delivery round-trip
      ↳ untested: invoice email actually leaves the building

4 of 7 capabilities are OFF. The suite can still go green;
what it proves is limited to the ON rows above.
```

Without that, a fresh clone with nothing configured reports "42 passed" while checking almost
nothing — and you would believe it.

For anything needing an external service: **intercept by default** so the code path runs
everywhere, real round-trip only when credentials exist, and **say which one ran**. "The send was
intercepted; the request shape is correct, delivery is unproven" is honest. "Email tested" is not.

---

## What is NOT tested — verified by grep, 2026-09-28

Every one of these returned **zero** files across `e2e/`, `tests/` and `src/**/*.test.ts`:

| Surface | Why it matters |
|---|---|
| `/admin/payments/config` | Razorpay keys, webhook secret, test-vs-live mode |
| `/api/checkout/quote`, `/order` | also never run in production — 0 orders exist |
| `/api/webhook/razorpay` | **signature verification is the security boundary for payment confirmation** |
| email OTP | identity |
| `/api/profile/whatsapp/verify-otp` | identity, and a WABA was permanently banned once already |
| `/api/invoice/[id]/email` | Resend delivery |
| admin hub end-to-end | 36 pages; only reachability is checked, nothing creates a product or changes a capability through the UI |
| migrations 055–074 | schema exists, no screen, no test |

**326 passing flatters this badly.** What is well tested is the permission layer — which is also
where two real vulnerabilities were found, so the testing works where it exists. It does not
exist where the money is.

Tracked as `TODO-2026-09-28-E2E-MONEY-PATHS`, ordered by what breaks worst: webhook signature
first, then checkout, then gateway config, then the OTP flows.

---

## Known failing on the live site

- **31 serious contrast violations** on the home page, 7 on `/services`, 8 on `/contact`
- **No skip link** — keyboard users traverse the whole nav on every page
- **Missing focus indicators** on `/contact`
- **Lead-form tests cannot locate the form** — selectors or page, unresolved
- **The marquee `inert` fix is on `brand-v4`, not on `main`** — production still has it

---

## Before calling anything done

```bash
pnpm typecheck && pnpm test && pnpm test:db && pnpm gen:e2e && pnpm test:e2e
```

Plus:

- the new test goes **red** with `git stash` applied
- `node scripts/sql-classify.mjs` puts any new migration in the tier you intended
- `work-units/session-state.json` → `public_template_sync` records whether it crosses to the
  public template
