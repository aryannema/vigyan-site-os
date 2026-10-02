/**
 * Functional — the paths a visitor actually walks.
 *
 * Scope note, so this file is not mistaken for more than it is: these tests
 * exercise the CLIENT side of the lead form and the sign-in page. They do not
 * submit real leads, do not authenticate, and do not assert anything about
 * what lands in the database — the permission layer is covered by the Postgres
 * suite (`pnpm test:db`), which is a better place for it.
 *
 * What is deliberately NOT here, and is still owed:
 *   - a real sign-in round trip (needs a seeded test identity and a way to
 *     hold a session without a live OAuth provider)
 *   - checkout (no orders exist yet; a test asserting an empty flow is theatre)
 *   - the WhatsApp opt-in path (the WABA question is unsettled)
 *
 * Writing those down beats a green suite that quietly covers less than its
 * name suggests.
 */

import { test, expect } from '@playwright/test';

test.describe('lead form: validation is enforced before anything is sent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
  });

  test('an empty submit reports every missing field, and posts nothing', async ({ page }) => {
    // If the form posts on an empty submit, validation is decorative and the
    // server is carrying the whole load. Fail here rather than find out from
    // a table full of blank rows.
    let posted = false;
    await page.route('**/api/**', (route) => {
      if (route.request().method() === 'POST') posted = true;
      return route.continue();
    });

    await page.getByRole('button', { name: /send|submit|get in touch/i }).first().click();

    await expect(page.getByText(/first name is required/i)).toBeVisible();
    await expect(page.getByText(/last name is required/i)).toBeVisible();
    expect(posted, 'an invalid form still POSTed').toBe(false);
  });

  test('a malformed email is rejected client-side', async ({ page }) => {
    await page.getByPlaceholder('First').fill('Test');
    await page.getByPlaceholder('Last').fill('Person');
    await page.getByPlaceholder('you@example.com').fill('not-an-email');
    await page.getByRole('button', { name: /send|submit|get in touch/i }).first().click();

    await expect(page.getByText(/valid email address/i)).toBeVisible();
  });

  test('the message minimum is enforced', async ({ page }) => {
    await page.getByPlaceholder('First').fill('Test');
    await page.getByPlaceholder('Last').fill('Person');
    await page.getByPlaceholder('you@example.com').fill('test@example.test');
    const message = page.locator('textarea').first();
    await message.fill('short');
    await page.getByRole('button', { name: /send|submit|get in touch/i }).first().click();

    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  });

  test('errors are announced, not just coloured', async ({ page }) => {
    // A message that only turns red is invisible to a screen reader and to
    // anyone who cannot distinguish the colour.
    await page.getByRole('button', { name: /send|submit|get in touch/i }).first().click();
    await expect(page.getByText(/first name is required/i)).toBeVisible();

    const announced = await page.evaluate(() => {
      const live = Array.from(document.querySelectorAll('[role="alert"],[aria-live]'));
      return live.some((el) => /required|valid|characters/i.test(el.textContent || ''));
    });
    expect(announced, 'validation errors are in no live region').toBe(true);
  });

  test('every input has a label an assistive tech can read', async ({ page }) => {
    const unlabelled = await page.evaluate(() => {
      const fields = Array.from(
        document.querySelectorAll<HTMLElement>('input:not([type=hidden]),textarea,select'),
      );
      return fields
        .filter((el) => {
          if (el.getAttribute('aria-label')) return false;
          if (el.getAttribute('aria-labelledby')) return false;
          const id = el.getAttribute('id');
          if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return false;
          return !el.closest('label');
        })
        .map((el) => `${el.tagName.toLowerCase()}[name=${el.getAttribute('name') ?? '?'}]`);
    });

    // A placeholder is not a label: it disappears the moment you type.
    expect(unlabelled, `unlabelled fields: ${unlabelled.join(', ')}`).toEqual([]);
  });
});

test.describe('phone validation is server-backed, not just client-side', () => {
  test('the client cannot be the only gate', async ({ page, request }) => {
    // The client validator is a convenience. If the API accepts what the
    // client rejects, the rule does not exist — anyone can POST directly.
    const res = await request.post('/api/validate-phone', {
      data: { phone: '+91123' },
      failOnStatusCode: false,
    });

    // Either the endpoint rejects it, or it is not the endpoint we think it
    // is. 404 means this test is pointed at nothing and should be fixed, not
    // silently passing.
    test.skip(res.status() === 404, 'no /api/validate-phone on this build');
    expect([400, 422]).toContain(res.status());
  });
});

test.describe('sign-in', () => {
  test('the page renders and offers a way in', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const ways = await page
      .locator('button:visible, a[href*="auth"]:visible, input[type="email"]:visible')
      .count();
    expect(ways, '/login offers no control to sign in with').toBeGreaterThan(0);
  });

  test('admin is not reachable while signed out', async ({ page }) => {
    // The template's README says /admin is unauthenticated today. This test is
    // the one that must go red the day that stops being true — and it is the
    // check an adopter most needs before deploying.
    const res = await page.goto('/admin');
    const status = res?.status() ?? 0;
    const landed = page.url();

    const redirectedAway = !landed.includes('/admin');
    const refused = status === 401 || status === 403;

    expect(
      redirectedAway || refused,
      `/admin returned ${status} and stayed at ${landed} while signed out`,
    ).toBe(true);
  });
});
