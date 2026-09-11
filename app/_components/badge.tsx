/** Small status pill. Tone is chosen by the caller from a fixed set. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warning';
}) {
  const tones = {
    neutral: 'bg-surface-sunken text-ink-muted',
    accent: 'bg-accent-soft text-accent-strong',
    warning: 'bg-warning-soft text-ink',
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
