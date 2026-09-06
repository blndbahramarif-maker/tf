import type { PaymentStatus } from "../../types/product";

const STYLES: Record<PaymentStatus, string> = {
  unpaid: "bg-ink-950/10 text-ink-950/60",
  paid: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  refunded: "bg-accent-100 text-accent-700",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold capitalize ${STYLES[status]}`}>
      {status}
    </span>
  );
}
