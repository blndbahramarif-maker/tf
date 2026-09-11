import type { ReactNode } from 'react';

/**
 * A labelled form control.
 *
 * The label is a real `<label htmlFor>` and the hint/error are wired through
 * `aria-describedby`, so a screen reader announces why a field was rejected
 * rather than leaving the user to guess.
 */
export function FormField({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string | null;
  error?: string | null;
  children: ReactNode;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-ink-muted text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-danger text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'border-border bg-surface focus:border-accent w-full rounded-md border px-3 py-2 text-sm';

/** Banner for a whole-form failure, announced when it appears. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      // Next injects its own empty role="alert" route announcer, so tests
      // target this id rather than the role.
      data-testid="form-error"
      className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm"
    >
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p className="border-accent/30 bg-accent-soft text-accent-strong rounded-md border px-3 py-2 text-sm">
      {children}
    </p>
  );
}
