import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Ported from vigyan-site-os, restyled onto this repo's tokens (`surface` for
 * the field background, `hairline-strong` for its edge) so it sits alongside
 * the existing shadcn/base-ui primitives in this folder rather than
 * introducing a second look.
 *
 * No focus classes here on purpose: the 3px saffron focus ring is a GLOBAL
 * :focus-visible rule in globals.css (CLAUDE-BRIEF.md §3, cross-cutting rule
 * 1 -- "Do not add per-component focus:ring-2"). A local ring-2 at 40% would
 * both double up and disagree with the brand's 3px-at-18%.
 */
export const inputClassName = cn(
  'flex h-9 w-full rounded-md border border-hairline-strong bg-surface px-3 py-1 text-sm text-ink',
  'placeholder:text-faint',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClassName, className)} {...props} />
  ),
);
Input.displayName = 'Input';
