import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle, HelpCircle } from "lucide-react";
import { useCart } from "../lib/cart-context";
import { formatPrice } from "../lib/format";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { usePageMeta } from "../lib/usePageMeta";
import { fetchOrderBySession, ApiError } from "../lib/api";
import { PRODUCTS_QUERY_KEY } from "../lib/useProducts";

export default function OrderConfirmation() {
  usePageMeta("Order Confirmation", "Your order at DGN Tech Mobiles.");
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { clear } = useCart();
  const queryClient = useQueryClient();
  const clearedRef = useRef(false);

  const { data: order, isLoading, error } = useQuery({
    queryKey: ["order-by-session", sessionId],
    queryFn: () => fetchOrderBySession(sessionId as string),
    enabled: !!sessionId,
    // Stripe's webhook may take a moment to arrive after the browser
    // redirect, so keep polling briefly until the order shows as paid.
    refetchInterval: (query) => (query.state.data?.paymentStatus === "paid" ? false : 2000),
  });

  useEffect(() => {
    if (order?.paymentStatus === "paid" && !clearedRef.current) {
      clearedRef.current = true;
      clear();
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    }
  }, [order?.paymentStatus, clear, queryClient]);

  if (!sessionId) {
    return (
      <Section>
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl border border-ink-950/5 bg-white p-10 text-center shadow-soft">
          <HelpCircle className="h-16 w-16 text-ink-950/30" />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">No order found</h1>
          <p className="mt-2 text-ink-950/60">This page is shown after completing a payment.</p>
          <Button to="/shop" variant="primary" className="mt-6">Continue Shopping</Button>
        </div>
      </Section>
    );
  }

  if (isLoading || (!order && !error)) {
    return (
      <Section>
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl border border-ink-950/5 bg-white p-10 text-center shadow-soft">
          <Clock className="h-16 w-16 animate-pulse text-brand-400" />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">Confirming your payment...</h1>
          <p className="mt-2 text-ink-950/60">This only takes a moment.</p>
        </div>
      </Section>
    );
  }

  if (error || !order) {
    return (
      <Section>
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl border border-rose-100 bg-rose-50 p-10 text-center">
          <XCircle className="h-16 w-16 text-rose-500" />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">We couldn't find that order</h1>
          <p className="mt-2 text-ink-950/60">
            {error instanceof ApiError ? error.message : "Please check your email for confirmation, or contact us."}
          </p>
          <Button to="/contact" variant="primary" className="mt-6">Contact Us</Button>
        </div>
      </Section>
    );
  }

  if (order.paymentStatus === "failed") {
    return (
      <Section>
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl border border-rose-100 bg-rose-50 p-10 text-center">
          <XCircle className="h-16 w-16 text-rose-500" />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">Payment Failed</h1>
          <p className="mt-2 text-ink-950/60">
            Your payment for order <strong>#{order.orderNumber}</strong> could not be completed. Your basket has been kept
            so you can try again.
          </p>
          <Button to="/checkout" variant="primary" className="mt-6">Try Again</Button>
        </div>
      </Section>
    );
  }

  const paid = order.paymentStatus === "paid";

  return (
    <Section>
      <div className={`mx-auto flex max-w-lg flex-col items-center rounded-3xl border p-10 text-center ${
        paid ? "border-teal-100 bg-teal-50" : "border-brand-100 bg-brand-50"
      }`}>
        {paid ? (
          <CheckCircle2 className="h-16 w-16 text-teal-600" />
        ) : (
          <Clock className="h-16 w-16 animate-pulse text-brand-500" />
        )}
        <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">
          {paid ? "Payment Successful!" : "Finalising your payment..."}
        </h1>
        <p className="mt-2 text-ink-950/60">
          Thanks {order.customerName.split(" ")[0]}! Your order <strong>#{order.orderNumber}</strong> total was{" "}
          <strong>{formatPrice(order.total)}</strong>. We'll contact you at {order.phone} to confirm{" "}
          {order.fulfilmentType === "collection" ? "collection from our Purley shop." : "your delivery."}
        </p>
        {!paid && (
          <p className="mt-4 text-xs text-ink-950/40">
            Waiting for payment confirmation from Stripe — this page will update automatically.
          </p>
        )}
        <Button to="/shop" variant="primary" className="mt-6">Continue Shopping</Button>
      </div>
    </Section>
  );
}
