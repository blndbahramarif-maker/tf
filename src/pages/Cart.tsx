import { Link } from "react-router-dom";
import { Minus, Plus, Trash2, ShoppingBasket, ArrowRight } from "lucide-react";
import { useCart } from "../lib/cart-context";
import { ILLUSTRATIONS } from "../components/illustrations/Illustrations";
import { formatPrice } from "../lib/format";
import { Section, SectionHeading } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { usePageMeta } from "../lib/usePageMeta";

export default function Cart() {
  usePageMeta("Your Basket", "Review the items in your DGN Tech Mobiles basket.");
  const { items, setQuantity, removeItem, subtotal } = useCart();

  return (
    <Section>
      <SectionHeading eyebrow="Your Basket" title="Review Your Items" />
      {items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center rounded-3xl border border-dashed border-ink-950/15 py-20 text-center">
          <ShoppingBasket className="h-14 w-14 text-ink-950/15" />
          <p className="mt-4 font-display text-lg font-bold text-ink-950">Your basket is empty</p>
          <p className="mt-1 text-sm text-ink-950/50">Browse our shop and add something you love.</p>
          <Button to="/shop" variant="primary" className="mt-6">Start Shopping</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {items.map((item) => {
              const Illustration = ILLUSTRATIONS[item.icon];
              return (
                <div key={item.id} className="flex flex-col gap-4 rounded-2xl border border-ink-950/5 bg-white p-4 shadow-soft sm:flex-row sm:items-center">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                    <Illustration className="h-14 w-14" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link to={`/product/${item.slug}`} className="font-bold text-ink-950 hover:text-brand-600">{item.name}</Link>
                      <p className="text-sm text-ink-950/50">{formatPrice(item.price)} each</p>
                    </div>
                    <div className="flex items-center gap-5">
                      <div className="flex items-center gap-2 rounded-full border border-ink-950/10 px-1.5 py-1">
                        <button onClick={() => setQuantity(item.id, item.quantity - 1)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-950/5" aria-label="Decrease quantity">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center font-bold">{item.quantity}</span>
                        <button onClick={() => setQuantity(item.id, item.quantity + 1)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-950/5" aria-label="Increase quantity">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="w-20 text-right font-display font-bold text-ink-950">{formatPrice(item.price * item.quantity)}</span>
                      <button onClick={() => removeItem(item.id)} aria-label="Remove item" className="text-ink-950/30 hover:text-rose-500">
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="h-fit rounded-3xl border border-ink-950/5 bg-white p-7 shadow-soft">
            <h3 className="font-display text-lg font-bold text-ink-950">Order Summary</h3>
            <div className="mt-5 space-y-3 text-sm text-ink-950/70">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold text-ink-950">{formatPrice(subtotal)}</span></div>
              <div className="flex justify-between"><span>Delivery / Collection</span><span className="font-semibold text-ink-950">Calculated at checkout</span></div>
            </div>
            <div className="mt-5 flex justify-between border-t border-ink-950/10 pt-5 text-base font-bold text-ink-950">
              <span>Total</span><span>{formatPrice(subtotal)}</span>
            </div>
            <Button to="/checkout" variant="primary" className="mt-6 w-full" iconRight={<ArrowRight className="h-4 w-4" />}>
              Proceed to Checkout
            </Button>
            <Link to="/shop" className="mt-3 block text-center text-sm font-semibold text-brand-600 hover:text-brand-700">
              Continue Shopping
            </Link>
          </div>
        </div>
      )}
    </Section>
  );
}
