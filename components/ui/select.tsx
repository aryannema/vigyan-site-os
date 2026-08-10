import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * A native <select>. shadcn's Select is a Radix popover primitive; this repo has
 * no Radix dependency and adding one would mean editing package.json (out of the
 * admin agent's scope — see BLOCKERS.md), so the native control is used. It is
 * keyboard- and screen-reader-accessible by default and submits inside a plain
 * <form>, which every admin form here relies on.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
