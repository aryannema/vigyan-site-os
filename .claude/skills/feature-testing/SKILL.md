---
name: feature-testing
description: Use after building a feature — explore it in a real browser to find what nobody predicted, then turn each finding into a deterministic test that guards it forever. Covers the agentic pass, what to generate vs hand-write, and how to skip honestly when a capability is missing.
---

# Testing a feature you just built

Two tools, two jobs, and confusing them wastes both.

| | Agentic pass (browser) | Playwright |
|---|---|---|
| Finds | bugs nobody thought of | bugs already found, returning |
| Cost | high, slow, non-reproducible | ~free, seconds, identical every run |
| When | once, after building | every commit, forever |

**The agent explores. The suite guards.** An agent run per commit is slow and flaky; a
hand-written suite alone only covers what its author remembered. Each agent finding becomes one
cheap assertion, and the suite grows by exactly what was actually discovered rather than what
someone imagined.

Worked example from this repo: an agent driving the home page found that the offerings marquee
cloned its cards with `cloneNode(true)` and marked none of them as decoration — ten
keyboard-reachable "See more" links for five destinations. Nothing in the source reads as
wrong. That finding became one assertion ("no link reachable twice for the same destination"),
which now covers any carousel anyone adds later. Writing that one test caused the suite to
surface 31 further contrast failures on its own.

## 1. Generate what can be derived

```bash
pnpm gen:e2e
```

Routes come from `src/app/**/page.tsx` — the App Router already IS the route manifest, so a new
page is covered the moment it exists, with no second list to forget. Permission invariants read
`role_capabilities` from the live database at run time, so a role added by a migration is
covered without regenerating.

Generated tests assert only what a generator can know: the page renders, has one `h1`, logs no
console errors, every image has `alt`. **They deliberately assert nothing about meaning.** A
generator that guesses what a page is FOR produces confident nonsense. Never hand-edit
`e2e/generated/` — it is overwritten.

## 2. Explore it in a browser

Load the Chrome tools, open the feature, and use it as a person would. Not a script — a
person: tab through it, submit it empty, submit it wrong, resize to 360px, read it with the
accessibility tree rather than the rendered text.

**Check the port before you trust anything.** More than one dev server can be running, and they
can be different branches of the same repo. This has already produced an hour of confusion
here: a fix was "verified" against a checkout that did not contain it, with no error anywhere.

```bash
pid=$(ss -ltnp | grep ':3000' | grep -oE 'pid=[0-9]+' | cut -d= -f2)
ls -l /proc/$pid/cwd     # which working tree is this actually serving?
```

What the agent is for — things a static read cannot see:

- **Reachability.** Count what a keyboard can reach versus what should be reachable.
- **Computed styles.** Transparent text, a token that resolves to nothing, contrast against the
  colour actually painted rather than the one in the stylesheet.
- **Order and focus.** Where focus lands after a dialog closes; whether the tab order matches
  the visual order.
- **The empty and the wrong.** Submit nothing. Submit nonsense. Double-click submit.
- **What the DOM says versus what the accessibility tree says.** `get_page_text` includes
  `inert` content; the accessibility tree does not. Use the right instrument or you will
  "confirm" a bug that is already fixed.

## 3. Turn each finding into one assertion

Write it in `e2e/*.spec.ts` (never `e2e/generated/`). Generalise to the rule, not the instance:
"no link reachable twice for the same destination" outlives the component that prompted it.

**Prove the test can fail.** Run it against the code without the fix. A test that passes both
before and after proves nothing, and you will not discover that later — you will simply trust
it. Both of this repo's security tests were checked this way: 10/10 green with migration 075
applied, two genuine assertion failures with it skipped.

**Guard against the vacuous pass.** `[].every()` is `true`. A check over "all the clones" on a
page with no clones reports success and means nothing:

```ts
test.skip(result.count === 0, 'no marquee on this page');
expect(result.allInert).toBe(true);
```

That exact mistake happened here during development and reported a clean bill of health.

## 4. Skip honestly, or not at all

A skipped test and a passing test look identical in a green summary. Ship a suite to someone
with no brand configured, no Resend key and no WhatsApp number, and they get "42 passed" while
branding, email and OTP quietly did nothing — a result they will trust and should not.

`e2e/capabilities.ts` detects what this install can actually exercise and **prints it**. Every
skip names the capability it needed and what goes untested without it:

```
[OFF] Transactional email (Resend)
      ↳ set RESEND_API_KEY to run the delivery round-trip
      ↳ untested: invoice email actually leaves the building
```

When a feature needs an external service, default to **intercepting** the call so the code path
runs everywhere, and do the real round trip only when credentials exist. State plainly which
one ran: "the send was intercepted; the request shape is correct, delivery is unproven" is
honest. "Email tested" is not.

When you cannot cover something, **write down that you did not**. `e2e/functional.spec.ts`
opens by listing what it does not cover — no real sign-in, no checkout, no WhatsApp opt-in. A
green suite that quietly covers less than its name suggests is the failure worth naming.

## 5. Run all three layers

```bash
pnpm test        # unit — no dependencies
pnpm test:db     # Postgres — permissions, RLS, PII
pnpm test:e2e    # browser — functional, UX, branding
```

Three commands so a failure says which layer broke. Folding them together means the unit tests
fail on any machine without a database.

## Branding is asserted by shape, never by value

The public template ships almost unbranded because the adopter supplies the brand. `--accent is
#E8A33D` is our business and no adopter's; `--accent resolves to something` is everyone's — a
token referenced but never defined renders as nothing, silently. Contrast is computed from what
the page actually paints, so the suite needs no knowledge of anyone's palette.

`e2e/brand.expectations.ts` is the single file an adopter edits. A branding test that asserts
OUR palette fails on their first run and teaches them the suite is noise, which is worse than
shipping no branding tests at all.

## Finish

- `pnpm gen:e2e` re-run if routes or roles changed
- each agent finding has exactly one assertion, proven to fail without the fix
- `e2e/capabilities.ts` updated if the feature needs a new external service
- `work-units/session-state.json` → `public_template_sync` says whether this crosses to the
  public template, stubbed or real
