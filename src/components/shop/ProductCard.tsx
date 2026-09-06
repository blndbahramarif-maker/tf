import { Link } from "react-router-dom";
import { ShoppingBasket, Eye } from "lucide-react";
import type { Product } from "../../data/products";
import { ILLUSTRATIONS } from "../illustrations/Illustrations";
import { formatPrice } from "../../lib/format";
import { useCart } from "../../lib/cart-context";

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const Illustration = ILLUSTRATIONS[product.icon];
  const { addItem } = useCart();

  return (
    <div
      className="animate-fade-up group relative flex flex-col overflow-hidden rounded-3xl border border-ink-950/5 bg-white shadow-soft card-hover"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
        {product.badge ? (
          <span className="rounded-full bg-accent-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-md">
            {product.badge}
          </span>
        ) : (
          <span />
        )}
        {product.condition && (
          <span className="rounded-full bg-ink-950/85 px-2.5 py-1 text-[11px] font-semibold text-white">
            {product.condition}
          </span>
        )}
      </div>
      <Link
        to={`/product/${product.slug}`}
        className="shine-wrap relative flex aspect-square items-center justify-center bg-gradient-to-br from-brand-50 via-white to-accent-50/60 p-6"
      >
        <Illustration className="h-40 w-40 drop-shadow-xl transition-transform duration-500 group-hover:-translate-y-2 group-hover:scale-105 md:h-44 md:w-44" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-500">
          {product.subcategory}
        </span>
        <Link to={`/product/${product.slug}`} className="font-display text-lg font-bold leading-snug text-ink-950 hover:text-brand-600">
          {product.name}
        </Link>
        <p className="line-clamp-2 text-sm text-ink-950/60">{product.shortDescription}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-display text-xl font-extrabold text-ink-950">{formatPrice(product.price)}</span>
          {product.oldPrice && (
            <span className="text-sm text-ink-950/40 line-through">{formatPrice(product.oldPrice)}</span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => addItem(product)}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <ShoppingBasket className="h-4 w-4" /> Add to Basket
          </button>
          <Link
            to={`/product/${product.slug}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-950/10 text-ink-950/80 transition-colors hover:border-brand-300 hover:text-brand-700"
            aria-label={`View details for ${product.name}`}
            title="View details"
          >
            <Eye className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
