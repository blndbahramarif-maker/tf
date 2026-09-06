import { Loader2, AlertTriangle } from "lucide-react";

export function PageLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-32 text-ink-950/50">
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}

export function PageError({
  message = "Something went wrong. Please try again.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-32 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50">
        <AlertTriangle className="h-7 w-7 text-rose-500" />
      </span>
      <p className="font-display text-lg font-bold text-ink-950">Unable to load</p>
      <p className="text-sm text-ink-950/60">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
