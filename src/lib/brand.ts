/**
 * The fixed brand strings. Placeholder values — the site-bootstrap skill
 * replaces them. Pages read these constants so a string is phrased the same
 * way everywhere; keep --vb-tagline / --vb-label in docs/brand/tokens.css in
 * sync (CSS custom properties cannot carry real, indexable text).
 */

/** The long-lived promise. */
export const BRAND_TAGLINE = 'Your tagline goes here.';

/** The tagline split for styling: the second half is set in the accent style. */
export const BRAND_TAGLINE_LEAD = 'Your tagline';
export const BRAND_TAGLINE_EMPHASIS = 'goes here.';

/** Short uppercase label, one line. */
export const BRAND_LABEL = 'YOUR LABEL · GOES · HERE';

/** Web hero and banners only. */
export const BRAND_SUPPORTING = 'One sentence on what you do and who it is for.';

/** What the business stands behind. Used for meta descriptions and hero body. */
export const BRAND_STANCE =
  'YourSite helps its customers with one clear promise — replace this sentence with yours.';
