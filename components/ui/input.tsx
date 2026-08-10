import * as React from 'react';

import { cn } from '../../lib/utils';

export const inputClassName = cn(
  'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm',
  'placeholder:text-muted-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClassName, className)} {...props} />
  ),
);
Input.displayName = 'Input';
