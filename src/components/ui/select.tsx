import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A native <select>. The shadcn Select in this project's registry is a popover
 * primitive; the native control is used for the admin forms because it submits
 * inside a plain <form> (which every ported admin form relies on) and is
 * keyboard/screen-reader accessible with no extra dependency.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-hairline-strong bg-surface px-2 text-sm text-ink',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-500/40',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
