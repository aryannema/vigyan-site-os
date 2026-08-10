import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * A native checkbox. shadcn's Checkbox wraps Radix and renders a <button
 * role="checkbox"> plus a hidden input; the native control is used here for the
 * same reason as Select (no Radix dependency available — see BLOCKERS.md) and
 * because the capability grid wants real checkbox semantics for its ~180 cells.
 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      'h-4 w-4 shrink-0 cursor-pointer rounded-sm border border-border accent-primary',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';
