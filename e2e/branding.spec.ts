/**
 * Branding — asserted by SHAPE, never by value.
 *
 * The public template ships nearly unbranded because the adopter supplies the
 * brand. So every check here reads what the live page actually computes and
 * asks whether it is coherent, rather than comparing it to a colour we chose.
 * Edit e2e/brand.expectations.ts and this suite tests your site.
 *
 * The distinction that makes this work: "--color-accent is #E8A33D" is our
 * business and no adopter's. "--color-accent resolves to something" is
 * everyone's — a token referenced but never defined renders as nothing, and
 * the element silently loses its styling with no error anywhere.
 */

import { test, expect } from '@playwright/test';
import { brand } from './brand.expectations';

/** WCAG relative luminance, sRGB. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

test.describe('design tokens', () => {
  test('every required token resolves to a value', async ({ page }) => {
    await page.goto('/');

    const missing = await page.evaluate((tokens: string[]) => {
      const s = getComputedStyle(document.documentElement);
      return tokens.filter((t) => !s.getPropertyValue(t).trim());
    }, brand.requiredTokens);

    expect(
      missing,
      `tokens referenced but never defined on :root: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  test('no element paints a var() that does not exist', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // A misspelled custom property is silent: the declaration is dropped and
    // the element inherits instead. Transparent text on a transparent
    // background looks like a missing section, not a CSS error.
    const broken = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *')).slice(0, 400)) {
        const s = getComputedStyle(el);
        if (s.color === 'rgba(0, 0, 0, 0)' && (el.textContent || '').trim().length > 0) {
          out.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
        }
      }
      return out;
    });

    expect(broken, `text painted fully transparent: ${broken.join(' / ')}`).toEqual([]);
  });
});

test.describe('contrast', () => {
  for (const pair of brand.contrastPairs) {
    test(`${pair.label} meets ${pair.minRatio}:1`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const colours = await page.evaluate(
        ({ fg, bg }: { fg: string; bg: string }) => {
          const fgEl = document.querySelector(fg);
          const bgEl = document.querySelector(bg);
          if (!fgEl || !bgEl) return null;

          // Walk up for the first non-transparent background: an element's own
          // background is usually transparent and the real one is an ancestor's.
          let node: Element | null = bgEl;
          let background = '';
          while (node) {
            const c = getComputedStyle(node).backgroundColor;
            if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { background = c; break; }
            node = node.parentElement;
          }
          return { foreground: getComputedStyle(fgEl).color, background };
        },
        { fg: pair.foreground, bg: pair.background },
      );

      test.skip(!colours, `selector not present on this page: ${pair.foreground}`);

      const fg = parseRgb(colours!.foreground);
      const bg = parseRgb(colours!.background);
      test.skip(!fg || !bg, 'could not resolve a painted colour');

      const ratio = contrastRatio(fg!, bg!);
      expect(
        Number(ratio.toFixed(2)),
        `${colours!.foreground} on ${colours!.background} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(pair.minRatio);
    });
  }
});

test.describe('identity', () => {
  test('the home link is named for the brand', async ({ page }) => {
    await page.goto('/');
    // Accessible name, not visible text: a logo is usually an image or an SVG,
    // and its alt/aria-label is what a screen reader announces as the brand.
    const home = page.locator('a[href="/"]').first();
    await expect(home).toHaveAccessibleName(new RegExp(brand.brandName, 'i'));
  });

  test('every route has a title, a favicon and an OG image', async ({ page }) => {
    for (const route of brand.routes) {
      await page.goto(route);
      await expect(page).toHaveTitle(/.+/);

      const icon = await page.locator('link[rel~="icon"]').count();
      expect(icon, `${route}: no favicon`).toBeGreaterThan(0);

      const og = await page.locator('meta[property="og:image"]').count();
      expect(og, `${route}: no og:image — link previews render blank`).toBeGreaterThan(0);
    }
  });

  test('no placeholder branding survives', async ({ page }) => {
    // The template ships its own placeholder name in forbiddenStrings, so an
    // adopter who skipped site-bootstrap learns it from a test rather than
    // from a customer noticing someone else's name on their site.
    test.skip(brand.forbiddenStrings.length === 0, 'nothing forbidden configured');

    for (const route of brand.routes) {
      await page.goto(route);
      const text = await page.locator('body').innerText();
      for (const needle of brand.forbiddenStrings) {
        expect(text, `${route} still contains placeholder "${needle}"`).not.toContain(needle);
      }
    }
  });
});
