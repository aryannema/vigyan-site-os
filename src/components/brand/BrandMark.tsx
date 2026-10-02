/**
 * BrandMark — the mandala mark on its own (no wordmark).
 *
 * Rules enforced here so callers cannot get them wrong
 * (docs/brand/DESIGN-SYSTEM.md §1, SKILL.md non-negotiables 2/3):
 *
 *  - **Size switch.** From 48 px up this renders the full mandala. At 32 px
 *    and 16 px it renders `mark-small-*`, which drops the wires — no screen
 *    can draw them at that size and the i-matra must survive. Callers pass a
 *    size; the correct file is chosen for them.
 *  - **Ground switch.** `-ivory` on ivory/white/sand, `-deep` on #020617.
 *    Never recoloured with filters, opacity or fill overrides.
 *  - **Embedded as `<img>`**, never inlined, so the browser caches it and the
 *    intrinsic 64×64 viewBox reserves layout space (no CLS).
 *
 * The mark is never a utility icon, bullet, spinner or watermark — use Lucide
 * for UI icons. One brand mark per screen.
 */
type BrandMarkProps = {
  /** Rendered size in px. 48+ uses the full mandala; below that, the small mark. */
  size?: number;
  /** Which ground it sits on. */
  on?: 'ivory' | 'deep';
  /** Decorative marks pass "" so screen readers skip them. */
  alt?: string;
  className?: string;
};

export default function BrandMark({
  size = 48,
  on = 'ivory',
  alt = 'YourSite',
  className,
}: BrandMarkProps) {
  const file = size >= 48 ? `mark-${on}` : `mark-small-${on}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/${file}.svg?v=4`}
      alt={alt}
      width={64}
      height={64}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}
