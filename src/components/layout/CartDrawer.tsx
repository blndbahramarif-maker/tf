import { Link } from "react-router-dom";
import { X, Minus, Plus, Trash2, ShoppingBasket } from "lucide-react";
import { useCart } from "../../lib/cart-context";
import { ILLUSTRATIONS } from "../illustrations/Illustrations";
import { formatPrice } from "../../lib/format";

export function CartDrawer() {
  const { items, isOpen, close, setQuantity, removeItem, subtotal } = useCart();

  return (
    <div
      className={`fixed inset-0 z-[70] transition-opacity duration-300 ${
        isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!isOpen}
    >
      <div className="absolute inset-0 bg-ink-950/50" onClick={close} />
      <div
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink-950/10 px-6 py-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
            <ShoppingBasket className="h-5 w-5 text-brand-600" /> Your Basket
          </h2>
          <button onClick={close} aria-label="Close basket" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-950/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <ShoppingBasket className="h-14 w-14 text-ink-950/15" />
              <p className="mt-4 font-semibold text-ink-950/60">Your basket is empty</p>
              <Link to="/shop" onClick={close} className="mt-4 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
                Start Shopping
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => {
                const Illustration = ILLUSTRATIONS[item.icon];
                return (
                  <li key={item.id} className="flex gap-3 rounded-2xl border border-ink-950/5 p-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                      <Illustration className="h-12 w-12" />
                    </div>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/product/${item.slug}`} onClick={close} className="text-sm font-bold text-ink-950 hover:text-brand-600">
                          {item.name}
                        </Link>
                        <button onClick={() => removeItem(item.id)} aria-label="Remove item" className="text-ink-950/30 hover:text-rose-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-2 rounded-full border border-ink-950/10">
                          <button
                            onClick={() => setQuantity(item.id, item.quantity - 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-950/5"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
                          <button
                            onClick={() => setQuantity(item.id, item.quantity + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-950/5"
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="font-display font-bold text-ink-950">{formatPrice(item.price * item.quantity)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-ink-950/10 px-6 py-5">
            <div className="mb-4 flex items-center justify-between text-base">
              <span className="font-semibold text-ink-950/70">Subtotal</span>
              <span className="font-display text-xl font-extrabold text-ink-950">{formatPrice(subtotal)}</span>
            </div>
            <Link
              to="/checkout"
              onClick={close}
              className="flex w-full items-center justify-center rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-3.5 text-sm font-bold text-white shadow-glow hover:-translate-y-0.5"
            >
              Proceed to Checkout
            </Link>
            <Link
              to="/cart"
              onClick={close}
              className="mt-2.5 flex w-full items-center justify-center rounded-full border border-ink-950/10 px-5 py-3 text-sm font-semibold text-ink-950/70 hover:bg-ink-950/5"
            >
              View Basket
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
