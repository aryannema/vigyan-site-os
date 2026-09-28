---
name: testing-browser
description: Use when testing a site in a real browser — functional flows, accessibility, contrast, responsive layout, and brand consistency. Covers Puppeteer and Playwright, how to assert branding by SHAPE rather than by hex value so the tests survive a rebrand, and why agentic exploration finds different bugs from scripted assertions. For API and database testing load testing-e2e instead.
---

# Browser testing

Two activities that get confused, and need each other:

| | what it is | finds |
|---|---|---|
| **Scripted** | assertions you wrote, run every commit | regressions |
| **Agentic** | an agent driving the browser, looking around | things nobody predicted |

Agentic exploration is how you **discover** a bug. A scripted assertion is how
you stop it coming back. Doing only the first means finding the same bug twice;
only the second means never finding it at all.

## Puppeteer or Playwright

Both drive a real browser. Pick on this:

| | Puppeteer | Playwright |
|---|---|---|
| Browsers | Chrome/Chromium | Chromium, Firefox, WebKit |
| Auto-waiting | manual | built in |
| Test runner | bring your own | included |
| Install | ~170 MB | ~400 MB (three browsers) |

**Playwright for a test suite** — auto-waiting removes the single largest source
of flakiness, which is asserting before the DOM settled. **Puppeteer for a
script** that does one thing, or when Chrome is all you need and size matters.

```bash
pnpm add -D @playwright/test && pnpm exec playwright install chromium
# or
pnpm add -D puppeteer
```

Neither is currently a dependency here — add it in the commit that adds the
first test, not before.

## Assert branding by shape, never by value

The rule that decides whether these tests survive a rebrand.

```ts
// WRONG — breaks the day someone changes the accent, and tells you nothing
expect(color).toBe('#E8A33D');

// RIGHT — still true after any rebrand
expect(getComputedStyle(el).getPropertyValue('--accent')).not.toBe('');
expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
```

`#E8A33D` is one project's business and no adopter's. **"The accent token
resolves to something"** and **"body text passes 4.5:1"** are everyone's.

This matters doubly in a template: a test asserting a specific hex fails
immediately for every person who clones it and puts their own brand in, and they
will delete the test rather than fix it — losing the check entirely.

What is worth asserting about brand:

| assert | do not assert |
|---|---|
| every colour token resolves | its exact value |
| contrast ratios pass AA | a specific pairing |
| one font family across headings | which family |
| the favicon is not the framework default | which icon |
| spacing comes from the scale | a pixel count |

## Accessibility — measured, not judged

```bash
pnpm add -D @axe-core/playwright
```

```ts
const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

axe catches what is mechanically checkable: contrast, missing labels, ARIA
misuse, heading order, images without alt text. It **cannot** tell you the page
is confusing — that is what agentic exploration is for.

Start by recording the current violation count rather than asserting zero on an
existing site. A test that has been failing since the day it was written gets
ignored, and then so does every other failure.

## Responsive

Test the widths where layouts actually break, not a tidy set of round numbers:

```ts
for (const width of [360, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  // the assertion that matters:
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);   // nothing forces a horizontal scrollbar
}
```

360 is a real phone. Horizontal overflow at 360 is the most common responsive
bug and the easiest to assert.

## Screenshots: diff structure, not pixels

Pixel-diffing full pages produces failures on every font-rendering difference
between your machine and CI, so the suite gets ignored.

Prefer: assert the **structure** (element exists, is visible, is in the right
order), and keep screenshots as *evidence attached to a failure* rather than as
the assertion itself. If you do want visual diffing, scope it to one component
with a fixed viewport and a disabled animation.

## Agentic exploration

Give an agent the goal and the constraints, not a script:

```
Open http://localhost:3000/contact in Chrome. Submit the form with an
invalid email, then a valid one. Report what a first-time visitor would find
confusing, and anything that looks broken at 360px wide.
```

Then **turn each finding into one assertion** in the scripted suite. The
exploration is not the test; it is how you find out what to test.

Things agents reliably find that scripts do not: a form that accepts submission
twice, an error that says "something went wrong", a focus outline invisible
against the accent, a button that looks disabled but is not.

## Running it

```bash
pnpm build && pnpm start -p 3111 &     # test the production build
BASE_URL=http://127.0.0.1:3111 pnpm exec playwright test
```

**Test `pnpm start`, not `pnpm dev`.** Dev mode has different bundling, no
minification, and React's development warnings — and it hides bugs that only
appear in a production build.

## What not to test in a browser

Authorization. A browser test can confirm a button is hidden; it cannot confirm
the capability is enforced, because the interesting attacker never loads your
page. That belongs in `testing-e2e` and in the database tests — hiding the button
is presentation, and presentation is not a permission.
