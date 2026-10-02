import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A native checkbox. Deliberately native rather than a styled button+hidden
 * input: the capability grid renders ~180 of these cells and wants real
 * checkbox semantics (and real keyboard behaviour) for every one of them.
 *
 * `accent-saffron-500` colours the check itself with the brand primary.
 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      'h-4 w-4 shrink-0 cursor-pointer rounded-sm border border-hairline-strong accent-saffron-500',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-500/40',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';
