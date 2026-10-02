/**
 * UI/UX regressions — the class of bug that reads fine in source and is wrong
 * in a browser.
 *
 * Every assertion here started as something an agent found by driving the page.
 * That is the intended workflow: the agent explores and finds once, and the
 * finding becomes a cheap deterministic check that runs on every PR forever.
 * Running an agent per commit is slow, costly and non-reproducible; running
 * this is none of those.
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { brand } from './brand.expectations';

/* ── The marquee finding ──────────────────────────────────────────────────
 * Found by an agent in a browser, 2026-09-23: OfferingsMarquee duplicates its
 * cards with cloneNode(true) to hide the loop seam, and nothing marked the
 * copies as decoration. Ten "See more" links, all ten reachable by keyboard,
 * for five destinations — a screen reader read the service list twice and a
 * keyboard user tabbed through every card twice.
 *
 * The general rule it generalises to: a duplicated-for-visual-effect element
 * must not be reachable or announced. That holds for any carousel or ticker
 * anyone adds later, which is why the test is written against the rule rather
 * than against this one component.
 * ────────────────────────────────────────────────────────────────────────*/
test.describe('decorative duplicates are inert', () => {
  test('no link is reachable twice for the same destination', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const reachable = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .filter((a) => !a.closest('[inert]') && a.getAttribute('aria-hidden') !== 'true')
        .map((a) => `${(a.textContent || '').trim()}|${a.getAttribute('href')}`)
        .filter((k) => k.length > 1);
    });

    const seen = new Map<string, number>();
    for (const key of reachable) seen.set(key, (seen.get(key) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1);

    // A nav link repeated in the footer is legitimate and has different text or
    // a different href; this catches the same text AND href twice, which is
    // what cloning produces.
    expect(duplicated, `reachable twice: ${duplicated.map(([k]) => k).join(', ')}`).toEqual([]);
  });

  test('cloned nodes carry both inert and aria-hidden', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(() => {
      const clones = Array.from(document.querySelectorAll('[data-marquee-clone="true"]'));
      return {
        count: clones.length,
        allInert: clones.every((c) => c.hasAttribute('inert')),
        allHidden: clones.every((c) => c.getAttribute('aria-hidden') === 'true'),
        focusableInside: clones.flatMap((c) =>
          Array.from(c.querySelectorAll('a,button,input,select,textarea,[tabindex]')),
        ).length,
      };
    });

    // Guard the vacuous pass. `[].every()` is true, so without this a page that
    // renders no clones at all reports a clean bill of health — which is how
    // the first run of this check lied during development.
    test.skip(result.count === 0, 'no marquee on this page');

    expect(result.allInert).toBe(true);
    expect(result.allHidden).toBe(true);
    expect(result.focusableInside).toBeGreaterThan(0); // else inert proves nothing
  });
});

/* ── Keyboard reachability ───────────────────────────────────────────────*/
test.describe('keyboard', () => {
  for (const route of brand.routes) {
    test(`${route}: focus is always visible`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Tab through the first 20 stops and confirm each focused element has a
      // visible indicator. An outline removed without a replacement leaves a
      // keyboard user with no idea where they are.
      const invisible: string[] = [];
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const hasRing =
            (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
            s.boxShadow !== 'none' ||
            s.textDecorationLine.includes('underline');
          return hasRing ? null : `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 30)}`;
        });
        if (info) invisible.push(info);
      }

      expect(invisible, `no focus indicator on: ${invisible.join(' / ')}`).toEqual([]);
    });
  }

  test('a skip link is the first stop', async ({ page }) => {
    // Without one, a keyboard user traverses the whole nav on every page.
    await page.goto('/');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}:${(el.textContent || '').trim()}` : '';
    });
    expect(first.toLowerCase()).toContain('skip');
  });
});

/* ── Automated a11y sweep ────────────────────────────────────────────────
 * axe catches the mechanical failures — missing labels, bad roles, orphaned
 * form controls. It does NOT catch the marquee bug above, which is why both
 * layers exist.
 * ────────────────────────────────────────────────────────────────────────*/
test.describe('axe', () => {
  for (const route of brand.routes) {
    test(`${route}: no serious or critical violations`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page } as { page: Page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const bad = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );

      expect(
        bad,
        bad.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`).join('\n'),
      ).toEqual([]);
    });
  }
});

/* ── Layout ──────────────────────────────────────────────────────────────*/
test.describe('layout', () => {
  for (const width of [360, 768, 1440]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        if (d.scrollWidth <= d.clientWidth) return null;
        // Name the widest offender rather than just failing: "something
        // overflows" costs an hour of bisecting.
        const worst = Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .map((el) => ({ el, right: el.getBoundingClientRect().right }))
          .filter((x) => x.right > d.clientWidth + 1)
          .sort((a, b) => b.right - a.right)[0];
        return {
          scrollWidth: d.scrollWidth,
          clientWidth: d.clientWidth,
          culprit: worst
            ? `${worst.el.tagName.toLowerCase()}.${worst.el.className}`.slice(0, 120)
            : 'unknown',
        };
      });

      expect(overflow, `horizontal overflow: ${JSON.stringify(overflow)}`).toBeNull();
    });
  }
});
