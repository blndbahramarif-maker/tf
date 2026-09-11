'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button that disables itself while the action is in flight.
 *
 * `useFormStatus` reads the state of the enclosing form, so this works without
 * the parent tracking anything. Double submission of a listing or a login is a
 * real problem, not a cosmetic one.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();

  const styles = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-strong',
    secondary: 'border-border border hover:border-border-strong',
    danger: 'border-danger/40 text-danger border hover:bg-danger/5',
  } as const;

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${styles[variant]}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
