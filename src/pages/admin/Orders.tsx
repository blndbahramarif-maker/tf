import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "../../lib/admin-auth-context";
import { adminListOrders } from "../../lib/api";
import { formatPrice } from "../../lib/format";
import { PageLoader, PageError } from "../../components/ui/PageState";
import { usePageMeta } from "../../lib/usePageMeta";
import type { OrderStatus } from "../../types/product";
import { StatusBadge } from "../../components/admin/StatusBadge";

const STATUS_FILTERS: ("All" | OrderStatus)[] = [
  "All",
  "pending",
  "confirmed",
  "ready",
  "completed",
  "cancelled",
];

export default function AdminOrders() {
  usePageMeta("Manage Orders", "View and manage customer orders.");
  const { token } = useAdminAuth();
  const [status, setStatus] = useState<"All" | OrderStatus>("All");

  const ordersQuery = useQuery({
    queryKey: ["admin", "orders"],
    queryFn: () => adminListOrders(token as string),
    enabled: !!token,
  });

  const filtered = useMemo(() => {
    const list = ordersQuery.data ?? [];
    return status === "All" ? list : list.filter((o) => o.status === status);
  }, [ordersQuery.data, status]);

  if (ordersQuery.isLoading) return <PageLoader label="Loading orders..." />;
  if (ordersQuery.isError) return <PageError onRetry={() => ordersQuery.refetch()} />;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink-950">Orders</h1>
      <p className="mt-1 text-sm text-ink-950/50">{ordersQuery.data?.length ?? 0} orders placed.</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-4 py-2 text-sm font-bold capitalize transition-colors ${
              status === s ? "border-transparent bg-brand-600 text-white" : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-ink-950/5 bg-white shadow-soft">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-ink-950/5 bg-ink-950/[0.02] text-xs font-bold uppercase tracking-wide text-ink-950/50">
            <tr>
              <th className="px-5 py-3">Order</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Fulfilment</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-950/5">
            {filtered.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-ink-950/[0.015]">
                <td className="px-5 py-3">
                  <Link to={`/admin/orders/${o.id}`} className="font-bold text-brand-600 hover:text-brand-700">
                    #{o.orderNumber}
                  </Link>
                  <p className="text-xs text-ink-950/40">{o.items.length} item{o.items.length !== 1 ? "s" : ""}</p>
                </td>
                <td className="px-5 py-3">
                  <p className="font-semibold text-ink-950">{o.customerName}</p>
                  <p className="text-xs text-ink-950/40">{o.phone}</p>
                </td>
                <td className="px-5 py-3 capitalize text-ink-950/70">{o.fulfilmentType}</td>
                <td className="px-5 py-3 font-bold text-ink-950">{formatPrice(o.total)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-5 py-3 text-ink-950/50">{new Date(o.createdAt).toLocaleDateString("en-GB")}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-950/40">
                  No orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
