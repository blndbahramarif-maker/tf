import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, Phone, MapPin, Package } from "lucide-react";
import { useAdminAuth } from "../../lib/admin-auth-context";
import { adminGetOrder, adminUpdateOrderStatus } from "../../lib/api";
import { formatPrice } from "../../lib/format";
import { PageLoader, PageError } from "../../components/ui/PageState";
import { usePageMeta } from "../../lib/usePageMeta";
import { StatusBadge } from "../../components/admin/StatusBadge";
import type { OrderStatus } from "../../types/product";

const STATUS_OPTIONS: OrderStatus[] = ["pending", "confirmed", "ready", "completed", "cancelled"];

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  usePageMeta("Order Detail", "View and manage this customer order.");
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState(false);

  const orderQuery = useQuery({
    queryKey: ["admin", "order", id],
    queryFn: () => adminGetOrder(token as string, Number(id)),
    enabled: !!token,
  });

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => adminUpdateOrderStatus(token as string, Number(id), status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2000);
    },
  });

  if (orderQuery.isLoading) return <PageLoader label="Loading order..." />;
  if (orderQuery.isError || !orderQuery.data) return <PageError onRetry={() => orderQuery.refetch()} />;

  const order = orderQuery.data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/admin/orders" className="flex items-center gap-1.5 text-sm font-semibold text-ink-950/50 hover:text-ink-950">
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-950">Order #{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-ink-950/50">
            Placed {new Date(order.createdAt).toLocaleString("en-GB")}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Customer</h2>
          <div className="mt-4 space-y-2.5 text-sm text-ink-950/70">
            <p className="font-bold text-ink-950">{order.customerName}</p>
            <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-brand-600" /> {order.phone}</p>
            <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-brand-600" /> {order.email}</p>
            {order.address && (
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {order.address}</p>
            )}
            <p className="flex items-center gap-2 capitalize"><Package className="h-4 w-4 text-brand-600" /> {order.fulfilmentType}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Update Status</h2>
          <div className="mt-4 grid grid-cols-1 gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => statusMutation.mutate(s)}
                disabled={statusMutation.isPending}
                className={`rounded-xl border-2 px-4 py-2.5 text-left text-sm font-bold capitalize transition-colors disabled:opacity-60 ${
                  order.status === s
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {savedMessage && <p className="mt-3 text-sm font-semibold text-teal-600">Status updated.</p>}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-950">Items</h2>
        <ul className="mt-4 divide-y divide-ink-950/5">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-bold text-ink-950">{item.productName}</p>
                <p className="text-xs text-ink-950/40">
                  {[item.color, item.storage].filter(Boolean).join(" · ") || "—"} · Qty {item.quantity}
                </p>
              </div>
              <span className="font-bold text-ink-950">{formatPrice(item.unitPrice * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2 border-t border-ink-950/10 pt-4 text-sm text-ink-950/70">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
          <div className="flex justify-between"><span>Delivery</span><span>{order.deliveryFee === 0 ? "Free" : formatPrice(order.deliveryFee)}</span></div>
        </div>
        <div className="mt-3 flex justify-between border-t border-ink-950/10 pt-3 text-base font-bold text-ink-950">
          <span>Total</span><span>{formatPrice(order.total)}</span>
        </div>
      </div>
    </div>
  );
}
