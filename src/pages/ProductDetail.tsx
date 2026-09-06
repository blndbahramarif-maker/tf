import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Minus, Plus, ShoppingBasket, CheckCircle2 } from "lucide-react";
import { getProduct, getProductsByCategory } from "../data/products";
import { getCategory } from "../data/categories";
import { ILLUSTRATIONS } from "../components/illustrations/Illustrations";
import { formatPrice } from "../lib/format";
import { useCart } from "../lib/cart-context";
import { ProductCard } from "../components/shop/ProductCard";
import { Section, SectionHeading } from "../components/ui/Section";
import { usePageMeta } from "../lib/usePageMeta";
import NotFound from "./NotFound";

export default function ProductDetail() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getProduct(slug) : undefined;

  usePageMeta(product ? product.name : "Product Not Found", product?.shortDescription);

  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) return <NotFound />;

  const category = getCategory(product.category);
  const Illustration = ILLUSTRATIONS[product.icon];
  const related = getProductsByCategory(product.category).filter((p) => p.id !== product.id).slice(0, 4);

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div>
      <div className="mx-auto max-w-7xl px-4 pt-6 text-sm text-ink-950/50 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-1.5">
          <Link to="/" className="hover:text-brand-600">Home</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link to={category?.href ?? "/shop"} className="hover:text-brand-600">{category?.name}</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-ink-950/70">{product.name}</span>
        </nav>
      </div>

      <Section className="pt-6">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div className={`flex items-center justify-center rounded-3xl bg-gradient-to-br ${category?.gradient ?? "from-brand-50 to-white"} p-12 opacity-90`}>
            <Illustration className="h-72 w-72 drop-shadow-2xl animate-float" />
          </div>

          <div>
            {product.badge && (
              <span className="mb-3 inline-block rounded-full bg-accent-500 px-3 py-1 text-xs font-bold text-white">{product.badge}</span>
            )}
            <span className="block text-sm font-bold uppercase tracking-wide text-brand-600">{product.subcategory}</span>
            <h1 className="mt-2 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{product.name}</h1>

            <div className="mt-4 flex items-center gap-3">
              {product.condition && (
                <span className="rounded-full bg-ink-950/5 px-3 py-1 text-xs font-bold text-ink-950/70">{product.condition}</span>
              )}
              {product.brand && (
                <span className="rounded-full bg-ink-950/5 px-3 py-1 text-xs font-bold text-ink-950/70">{product.brand}</span>
              )}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <span className="font-display text-3xl font-extrabold text-ink-950">{formatPrice(product.price)}</span>
              {product.oldPrice && <span className="text-lg text-ink-950/40 line-through">{formatPrice(product.oldPrice)}</span>}
            </div>

            <p className="mt-5 leading-relaxed text-ink-950/70">{product.description}</p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 rounded-full border border-ink-950/10 px-2 py-1.5">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-950/5" aria-label="Decrease quantity">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center font-bold">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-950/5" aria-label="Increase quantity">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={handleAdd}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-8 py-3.5 text-base font-bold text-white shadow-glow transition-transform hover:-translate-y-0.5"
              >
                {added ? <CheckCircle2 className="h-5 w-5" /> : <ShoppingBasket className="h-5 w-5" />}
                {added ? "Added to Basket" : "Add to Basket"}
              </button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4 border-t border-ink-950/10 pt-6 text-sm text-ink-950/60 sm:grid-cols-3">
              <p>✓ In-store collection</p>
              <p>✓ 90-day support</p>
              <p>✓ Friendly local advice</p>
            </div>
          </div>
        </div>
      </Section>

      {related.length > 0 && (
        <Section className="bg-gradient-to-b from-white to-brand-50/40">
          <SectionHeading eyebrow="You Might Also Like" title="Related Products" />
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
            {related.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
