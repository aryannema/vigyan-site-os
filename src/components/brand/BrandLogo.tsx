/**
 * BrandLogo — the mark + "YourSite" wordmark lockups.
 *
 * Rules enforced here (docs/brand/DESIGN-SYSTEM.md §2, STEP 7B):
 *
 *  - **Files are used exactly as supplied.** Never recoloured, never redrawn,
 *    never optimised. Pick the variant that matches the ground: `-ivory` on
 *    ivory/white/sand, `-deep` on #020617.
 *  - **Height is set in CSS, width stays auto.** Forcing both would distort
 *    the ratio. The intrinsic `width`/`height` come from each file's viewBox
 *    so the browser reserves the right box and nothing shifts on load.
 *  - **Embedded as `<img>`.** The tagline and stacked lockups are ~33 KB each;
 *    inlining them would re-download the markup on every page instead of
 *    letting the browser cache one file.
 *  - **Minimum widths** (§2): primary 200 px, tagline 320 px. On narrow
 *    screens use `primary` rather than shrinking `tagline` below its minimum.
 *  - **`?v=4`** because the filenames are stable across brand revisions, so a
 *    query bump is what makes browsers pick up a new cut.
 *
 * The tagline in a hero or heading must be real HTML text — the tagline
 * lockup is decoration for the footer and brand art only.
 */
type Lockup = 'primary' | 'tagline' | 'stacked';

/** Intrinsic dimensions, read from each file's viewBox. */
const VIEWBOX: Record<Lockup, { w: number; h: number }> = {
  primary: { w: 852.44, h: 206.055 },
  tagline: { w: 854.44, h: 210.238 },
  stacked: { w: 646.385, h: 477.104 },
};

type BrandLogoProps = {
  lockup?: Lockup;
  on?: 'ivory' | 'deep';
  /** Tailwind height utilities, e.g. "h-7 md:h-9". Width stays auto. */
  className?: string;
  alt?: string;
  /** Set on the header logo so it is not lazy-loaded. */
  priority?: boolean;
};

export default function BrandLogo({
  lockup = 'primary',
  on = 'ivory',
  className = 'h-7 w-auto md:h-9',
  alt = 'YourSite',
  priority = false,
}: BrandLogoProps) {
  const { w, h } = VIEWBOX[lockup];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/logo-${lockup}-${on}.svg?v=4`}
      alt={alt}
      width={w}
      height={h}
      className={className}
      {...(priority
        ? { fetchPriority: 'high' as const, loading: 'eager' as const }
        : { loading: 'lazy' as const })}
    />
  );
}
