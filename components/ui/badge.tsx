import * as React from 'react';

import { cn } from '../../lib/utils';

type Variant = 'default' | 'outline' | 'muted' | 'destructive';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground',
  outline: 'border border-border text-foreground',
  muted: 'bg-muted text-muted-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = 'muted', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
