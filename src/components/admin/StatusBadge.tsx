import type { OrderStatus } from "../../types/product";

const STYLES: Record<OrderStatus, string> = {
  pending: "bg-accent-100 text-accent-700",
  confirmed: "bg-brand-100 text-brand-700",
  ready: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold capitalize ${STYLES[status]}`}>
      {status}
    </span>
  );
}
