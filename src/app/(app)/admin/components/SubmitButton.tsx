'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';

type SubmitButtonProps = Omit<React.ComponentProps<typeof Button>, 'type'> & {
  pendingLabel?: string;
};

/**
 * Submit button that disables itself while its enclosing <form>'s action is in
 * flight. Must be rendered inside the form it submits — that is how
 * useFormStatus finds it.
 *
 * Wraps this repo's existing shadcn/base-ui `Button` rather than
 * vigyan-site-os's hand-rolled one, so there is a single button implementation.
 */
export function SubmitButton({ children, pendingLabel, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </Button>
  );
}
