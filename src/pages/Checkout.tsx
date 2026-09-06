import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Lock, CheckCircle2, ShoppingBag, AlertTriangle } from "lucide-react";
import { useCart } from "../lib/cart-context";
import { formatPrice } from "../lib/format";
import { ILLUSTRATIONS } from "../components/illustrations/Illustrations";
import { resolveIllustrationKey } from "../lib/productDisplay";
import { Section, SectionHeading } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { usePageMeta } from "../lib/usePageMeta";
import { placeOrder, ApiError } from "../lib/api";
import { PRODUCTS_QUERY_KEY } from "../lib/useProducts";
import type { Order } from "../types/product";

export default function Checkout() {
  usePageMeta("Checkout", "Complete your order at DGN Tech Mobiles.");
  const { items, subtotal, clear } = useCart();
  const queryClient = useQueryClient();
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [fulfilment, setFulfilment] = useState<"collection" | "delivery">("collection");
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const deliveryFee = fulfilment === "delivery" ? 3.99 : 0;
  const total = subtotal + deliveryFee;

  const mutation = useMutation({
    mutationFn: placeOrder,
    onSuccess: (order) => {
      setPlacedOrder(order);
      clear();
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });

  function handlePlaceOrder(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || (fulfilment === "delivery" && !form.address)) {
      setFormError("Please fill in all required fields.");
      return;
    }
    setFormError(null);
    mutation.mutate({
      customerName: form.name,
      email: form.email,
      phone: form.phone,
      fulfilmentType: fulfilment,
      address: fulfilment === "delivery" ? form.address : undefined,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        color: i.color,
        storage: i.storage,
      })),
    });
  }

  if (placedOrder) {
    return (
      <Section>
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl border border-teal-100 bg-teal-50 p-10 text-center">
          <CheckCircle2 className="h-16 w-16 text-teal-600" />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">Order Placed!</h1>
          <p className="mt-2 text-ink-950/60">
            Thanks {form.name.split(" ")[0]}! Your order <strong>#{placedOrder.orderNumber}</strong> total was{" "}
            <strong>{formatPrice(placedOrder.total)}</strong>. We'll contact you at {placedOrder.phone} to confirm{" "}
            {placedOrder.fulfilmentType === "collection" ? "collection from our Purley shop." : "your delivery."}
          </p>
          <p className="mt-4 text-xs text-ink-950/40">
            Online payments aren't live yet — our team will confirm payment on collection or delivery.
          </p>
          <Button to="/shop" variant="primary" className="mt-6">Continue Shopping</Button>
        </div>
      </Section>
    );
  }

  if (items.length === 0) {
    return <Navigate to="/cart" replace />;
  }

  return (
    <Section>
      <SectionHeading eyebrow="Checkout" title="Complete Your Order" />
      <form onSubmit={handlePlaceOrder} className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-3xl border border-ink-950/5 bg-white p-6 shadow-soft sm:p-7">
            <h3 className="font-display text-lg font-bold text-ink-950">Contact Details</h3>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <label className="block text-sm font-bold text-ink-950/80">
                Full Name *
                <input className="input mt-1.5 font-normal" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="block text-sm font-bold text-ink-950/80">
                Phone Number *
                <input className="input mt-1.5 font-normal" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="block text-sm font-bold text-ink-950/80 sm:col-span-2">
                Email *
                <input type="email" className="input mt-1.5 font-normal" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-ink-950/5 bg-white p-6 shadow-soft sm:p-7">
            <h3 className="font-display text-lg font-bold text-ink-950">Collection or Delivery</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["collection", "delivery"] as const).map((opt) => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => setFulfilment(opt)}
                  className={`rounded-2xl border-2 p-4 text-left transition-colors ${
                    fulfilment === opt ? "border-brand-500 bg-brand-50" : "border-ink-950/10 hover:border-ink-950/25"
                  }`}
                >
                  <span className="block font-bold capitalize text-ink-950">{opt === "collection" ? "In-Store Collection" : "Local Delivery"}</span>
                  <span className="text-sm text-ink-950/50">{opt === "collection" ? "Free — ready within 24 hours" : "From £3.99 — Purley area only"}</span>
                </button>
              ))}
            </div>
            {fulfilment === "delivery" && (
              <label className="mt-5 block text-sm font-bold text-ink-950/80">
                Delivery Address *
                <textarea className="input mt-1.5 min-h-24 resize-y font-normal" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </label>
            )}
          </div>

          <div className="rounded-3xl border border-ink-950/5 bg-white p-6 shadow-soft sm:p-7">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
              <CreditCard className="h-5 w-5 text-brand-600" /> Payment
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-950/50">
              <Lock className="h-3.5 w-3.5" /> Online card payments are coming soon — this is a preview checkout.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 opacity-50 sm:grid-cols-2">
              <input disabled placeholder="Card Number" className="input" />
              <input disabled placeholder="Name on Card" className="input" />
              <input disabled placeholder="MM / YY" className="input" />
              <input disabled placeholder="CVC" className="input" />
            </div>
            <p className="mt-4 text-sm text-ink-950/60">
              Don't worry — you won't be charged online yet. Simply place your order and our team will confirm
              payment in-store, by card machine, or bank transfer.
            </p>
          </div>

          {(formError || mutation.isError) && (
            <p className="flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {formError ||
                (mutation.error instanceof ApiError
                  ? mutation.error.message
                  : "Could not place order. Please try again.")}
            </p>
          )}
        </div>

        <div className="h-fit rounded-3xl border border-ink-950/5 bg-white p-7 shadow-soft">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
            <ShoppingBag className="h-5 w-5 text-brand-600" /> Order Summary
          </h3>
          <ul className="mt-5 space-y-3">
            {items.map((item) => {
              const Illustration = ILLUSTRATIONS[resolveIllustrationKey(item)];
              const variant = [item.color, item.storage].filter(Boolean).join(" · ");
              return (
                <li key={item.key} className="flex items-center gap-3 text-sm">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-50">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="h-full w-full object-contain" />
                    ) : (
                      <Illustration className="h-8 w-8" />
                    )}
                  </div>
                  <span className="flex-1 font-semibold text-ink-950">
                    {item.name} <span className="text-ink-950/40">×{item.quantity}</span>
                    {variant && <span className="block text-xs font-normal text-ink-950/40">{variant}</span>}
                  </span>
                  <span className="font-bold text-ink-950">{formatPrice(item.unitPrice * item.quantity)}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 space-y-2 border-t border-ink-950/10 pt-5 text-sm text-ink-950/70">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
            <div className="flex justify-between"><span>{fulfilment === "collection" ? "Collection" : "Delivery"}</span><span>{deliveryFee === 0 ? "Free" : formatPrice(deliveryFee)}</span></div>
          </div>
          <div className="mt-4 flex justify-between border-t border-ink-950/10 pt-4 text-base font-bold text-ink-950">
            <span>Total</span><span>{formatPrice(total)}</span>
          </div>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="mt-6 w-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-4 text-base font-bold text-white shadow-glow transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {mutation.isPending ? "Placing Order..." : "Place Order"}
          </button>
          <Link to="/cart" className="mt-3 block text-center text-sm font-semibold text-ink-950/50 hover:text-ink-950">
            Back to Basket
          </Link>
        </div>
      </form>
    </Section>
  );
}
