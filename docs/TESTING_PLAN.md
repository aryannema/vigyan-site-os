# Testing plan

Written 2026-09-17, after a session that added checkout, GST, invoicing,
company records and key rotation — none of which has been exercised by a real
browser or a real payment.

---

## Where we actually are

**195 unit tests, all passing.** They cover the arithmetic well: GST splits,
pricing floors, discount maths, key rotation round-trips, sanitiser evasions,
PDF rendering, validation rules.

**Zero end-to-end tests.** Nothing has clicked a button. The entire purchase
path — sign up, complete profile, verify WhatsApp, pick a product, pay, receive
an invoice — has never run start to finish, in any browser, by anyone.

That gap is the point of this document. Unit tests prove a function is right;
they say nothing about whether the pieces connect.

---

## What unit tests cannot catch, and have not

Worth being concrete, because it sets the scope:

- A form that posts to the wrong action, or a server action that silently
  returns before writing.
- A redirect loop between `/complete-profile` and `/account`.
- Razorpay's modal failing to open because the key id is for the wrong mode.
- An invoice email that sends but arrives with no attachment.
- A page that renders on a laptop and breaks at 360px.
- A capability check that passes for a role it should refuse.
- The CSP blocking Razorpay's iframe once it stops being report-only.

Every one of those is a whole-system failure between correct parts.

---

## Layers, and what belongs in each

### 1. Unit — vitest, already running

Pure logic. Fast, no database, no network. **Keep adding here first** — a bug
provable in a unit test should never need a browser.

### 2. Integration — API routes against a real database

Not built. The routes to cover, in order of what would hurt most:

| Route | The assertion that matters |
|---|---|
| `POST /api/checkout/quote` | tax split changes with the buyer's state; an expired offer does not apply |
| `POST /api/checkout/order` | price comes from the DB, NOT the request body; a tampered amount is ignored |
| `POST /api/webhook/razorpay` | a forged signature is refused; a redelivered webhook does not double-issue an invoice |
| `GET /api/invoice/[id]` | another user's invoice returns 404, not the PDF |
| `POST /api/mcp` | pricing floor refused; lead-gen product refused; missing `X-Caller-Label` refused |

These need a database, so they run against a **disposable schema**, never
production. See "Test data" below.

### 3. End-to-end — a real browser

The journeys, smallest useful set:

1. **Sign up → complete profile → account.** Includes the WhatsApp OTP, which
   is the hard part (see "The WhatsApp problem").
2. **Browse → product page → Buy → Razorpay test mode → invoice.** The one that
   has never run.
3. **Admin: create a product with an offer, verify the countdown and the
   struck-through price on the public page.**
4. **Admin: edit company details, confirm they appear on the invoice and in the
   footer.**
5. **Data deletion request → dual confirmation → purge.**

### 4. Security — partly automatable

| Check | How |
|---|---|
| Security headers present | `curl -I`, assert each header. Trivial, do it first. |
| Admin routes require auth | request each `/admin/*` route unauthenticated, expect 307 |
| Another user's invoice/order | sign in as B, request A's id, expect 404 |
| Capability enforcement | `perform_action` with a non-admin uid, expect the refusal (already proven manually) |
| XSS payloads through every form | submit the sanitiser's evasion list, assert nothing executes |
| SQL injection through every input | `' OR 1=1--` and friends; queries are parameterised, so this should be boring |
| Rate limits | hammer OTP request and invoice resend, expect 429 |
| CSP violations | read the report-only violations before enforcing |

---

## Puppeteer or Claude-in-Chrome?

**Both, for different jobs.** They are not competing.

### Playwright for the suite — and Playwright over Puppeteer

Puppeteer was asked about specifically, so: Playwright is the better fit here,
for reasons that matter to this project rather than in the abstract.

- Runs the same suite on Chromium, Firefox and WebKit. The brand work is
  typography-heavy, and Safari is where font rendering diverges.
- Auto-waiting for elements, rather than manual sleeps. Sleeps are why browser
  suites become flaky and then get ignored.
- `expect(page).toHaveScreenshot()` for visual regression — which matters
  because **the 360px and 1440px check has been deferred all session**.
- Built-in tracing: a failed CI run gives a video and a DOM snapshot, instead of
  "it failed on the machine you cannot see".

Puppeteer is fine and Chrome-only. Given the choice is being made now, Playwright
costs nothing extra and covers more.

### Claude-in-Chrome for exploration

Different job, and the one thing a script genuinely cannot do: judgement.

A written test asserts what it was told to assert. It cannot notice that the
invoice looks wrong, that a button is where nobody would look for it, or that an
error message is confusing — which is exactly the feedback this project has had
before ("a working feature rejected as confusing").

So: **Claude-in-Chrome to explore and find what is wrong; Playwright to make
sure it stays fixed.** Anything found by exploration becomes a written test.

It disconnected mid-session twice today, so it is not something to build a
pipeline on.

---

## The WhatsApp problem

Journey 1 needs a WhatsApp OTP, and the WABA is `TIER_250` with **zero approved
templates**. Automated sign-up cannot receive a real code.

Options, least bad first:

1. **A test-mode bypass**, gated on an env flag that is absent in production and
   asserted absent by a test. A fixed code for a fixed test number.
2. **Seed a verified account** directly in the database and start the journey
   after verification. Skips the step rather than testing it.
3. **Meta's test numbers**, if the WABA supports them — needs checking.

Option 1 is the only one that tests the real flow, and it is also the one that
introduces a way in if it ever leaks into production. If it is built, the flag
check belongs in a test that fails the build when the flag is set.

---

## Test data, and what must never happen

**Never run against production.** The deletion journey ends in a purge; a
mistake there is unrecoverable.

Needed:

- A disposable schema or database, migrated from `supabase/migrations/`.
- Seeded products, including one with an offer and one lead magnet.
- Razorpay **test mode** — `rzp_test_` keys, and `keyModeMismatch()` already
  refuses to transact when the key and the live flag disagree.
- A test email address; Resend has a sandbox.
- Teardown that runs even when a test fails.

---

## Skills and agents — the question asked

**A testing skill: yes, and it earns its place.** Not because the commands are
hard, but because the project-specific traps are invisible and have already
cost time today:

- `BUILD_TARGET=stable` must match between build and start, or the server serves
  a stale directory.
- Rebuilding under a running server breaks every page — it looks like a code bug.
- A stale `next-server` survives `pkill -f "next start"`.
- Admin routes 307 to `/login`; that is correct, not a failure.
- Migrations are applied by hand, in order, as `postgres`.

A test that does not know these produces false failures, which is how a suite
loses its credibility.

**A testing agent: not yet.** An agent is worth it when there is a large,
parallelisable surface — dozens of files to sweep, many independent checks to
run at once. Right now there are five journeys and no suite at all. Write the
first tests by hand, learn what is actually flaky, then consider parallelising.
Building the orchestration before the thing being orchestrated is the wrong
order.

---

## Order of work

1. **Header and auth assertions** — a morning's work, catches real regressions,
   needs no browser.
2. **Integration tests on the money routes** — checkout, webhook, invoice
   ownership. Highest consequence if wrong.
3. **Playwright, journey 2 first** — the purchase path, because it has never run.
4. **Visual regression at 360px and 1440px** — the deferred check, finally.
5. **The rest of the journeys.**
6. **Claude-in-Chrome exploration**, converting each finding into a written test.

---

## Definition of done

Not "the tests pass". A release is testable when:

- A real card in Razorpay test mode produces a paid order, a numbered invoice,
  an archived PDF and an email with an attachment — verified by opening the email.
- The same product shows the same price on the product page, in the quote, and
  on the invoice.
- An expired offer charges the standard price.
- Another user's invoice returns 404.
- The site is **looked at** on a phone and a desktop, by a person.

That last one has been deferred all session. It stays on the list until someone
has actually seen it.
