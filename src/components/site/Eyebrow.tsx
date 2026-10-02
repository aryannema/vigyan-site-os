import type { ReactNode } from 'react';

type EyebrowProps = {
  children: ReactNode;
  tone?: 'saffron' | 'green' | 'muted';
  dot?: boolean;
  className?: string;
};

/**
 * Eyebrow — wide-tracked, ALL-CAPS mono micro-label that sits above headings.
 * Tricolor-coded: saffron (Vigyan / science) or green (Bytes / growth).
 */
export default function Eyebrow({ children, tone = 'saffron', dot = true, className = '' }: EyebrowProps) {
  const toneClass =
    tone === 'green' ? 'text-green-ink' : tone === 'muted' ? 'text-muted' : 'text-saffron-ink';
  return (
    <span className={`vb-eyebrow ${toneClass} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
