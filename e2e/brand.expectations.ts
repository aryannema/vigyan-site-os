/**
 * What the branding suite asserts — and the one file an adopter edits.
 *
 * The public template ships with almost no branding, on purpose: the adopter
 * brings their own. So a branding test must never assert OUR palette, OUR
 * wordmark or OUR copy. A suite that does fails on every adopter's first run
 * and teaches them the tests are noise, which is worse than shipping none.
 *
 * What survives that constraint is the SHAPE of a correctly branded site:
 *   - the design tokens the CSS claims to define are actually defined
 *   - text meets contrast against the background it is actually painted on
 *   - the accessible name of the home link is the brand, whatever the brand is
 *   - a favicon, an OG image and a title exist
 *
 * None of those depend on the brand being ours. Fill this file in and the
 * suite tests YOUR site; leave it as shipped and it tests that the template's
 * defaults are coherent.
 */

export interface BrandExpectations {
  /** Accessible name of the home/logo link. Yours, not ours. */
  brandName: string;

  /**
   * CSS custom properties the stylesheet must define on :root, with a
   * non-empty computed value. Names only — never the values, which are the
   * adopter's business. A token that is referenced but never defined resolves
   * to nothing, and the element silently renders unstyled.
   */
  requiredTokens: string[];

  /**
   * Pairs to check for WCAG contrast, as CSS selectors. The suite reads the
   * COMPUTED colours off the live page, so it does not need to know what they
   * are — only which foreground sits on which background.
   */
  contrastPairs: Array<{
    label: string;
    foreground: string;
    background: string;
    /** 4.5 for body text, 3.0 for large text and UI components (WCAG AA). */
    minRatio: number;
  }>;

  /** Routes the suite walks. An adopter adds theirs; the template ships the ones it has. */
  routes: string[];

  /**
   * Substrings that must NOT appear in the rendered page. This is how the
   * template catches a half-finished rebrand: ship it with the template's own
   * placeholder name and any adopter who forgot to run site-bootstrap finds
   * out from a test rather than from a customer.
   */
  forbiddenStrings: string[];
}

export const brand: BrandExpectations = {
  brandName: 'YourSite',

  // Real names from public/brand/tokens.css. These were guessed as
  // --color-bg / --color-fg on first write and every one of them failed,
  // which is the test doing its job on the test rather than on the site:
  // a token name that does not exist proves nothing about the page.
  requiredTokens: [
    '--bg',
    '--text-body',
    '--accent',
    '--border',
  ],

  contrastPairs: [
    { label: 'body text on page background', foreground: 'body', background: 'body', minRatio: 4.5 },
    { label: 'primary CTA label on its fill', foreground: 'a[href="/contact"]', background: 'a[href="/contact"]', minRatio: 4.5 },
  ],

  routes: ['/', '/services', '/contact'],

  // Ours is empty: this IS the branded site. The template ships with its
  // placeholder name here, so a forgotten rebrand fails loudly.
  forbiddenStrings: [],
};
