import { Link } from "react-router-dom";
import { ShoppingBasket, Eye } from "lucide-react";
import type { Product } from "../../types/product";
import { productTotalStock } from "../../types/product";
import { ILLUSTRATIONS } from "../illustrations/Illustrations";
import { formatPrice } from "../../lib/format";
import { useCart } from "../../lib/cart-context";
import { resolveIllustrationKey, defaultSelection } from "../../lib/productDisplay";

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const Illustration = ILLUSTRATIONS[resolveIllustrationKey(product)];
  const { addItem } = useCart();
  const image = product.images[0];
  const inStock = productTotalStock(product) > 0;

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
        <div className="flex flex-col items-end gap-1.5">
          {product.condition && (
            <span className="rounded-full bg-ink-950/85 px-2.5 py-1 text-[11px] font-semibold text-white">
              {product.condition}
            </span>
          )}
          {!inStock && (
            <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white">
              Out of Stock
            </span>
          )}
        </div>
      </div>
      <Link
        to={`/product/${product.slug}`}
        className="shine-wrap relative flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-brand-50 via-white to-accent-50/60 p-6"
      >
        {image ? (
          <img
            src={image}
            alt={product.name}
            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <Illustration className="h-40 w-40 drop-shadow-xl transition-transform duration-500 group-hover:-translate-y-2 group-hover:scale-105 md:h-44 md:w-44" />
        )}
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
            onClick={() => addItem(product, 1, defaultSelection(product))}
            disabled={!inStock}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-transform hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <ShoppingBasket className="h-4 w-4" /> {inStock ? "Add to Basket" : "Out of Stock"}
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
