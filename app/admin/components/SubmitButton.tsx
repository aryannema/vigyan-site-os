'use client';

import { useFormStatus } from 'react-dom';

import { Button, type ButtonProps } from '../../../components/ui/button';

interface SubmitButtonProps extends Omit<ButtonProps, 'type'> {
  pendingLabel?: string;
}

/**
 * Submit button that disables itself while its enclosing <form>'s action is in
 * flight. Must be rendered inside the form it submits — that is how
 * useFormStatus finds it.
 */
export function SubmitButton({ children, pendingLabel, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </Button>
  );
}
