import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Minus, Plus, ShoppingBasket, CheckCircle2, Check } from "lucide-react";
import { useProduct, useAllProducts, filterByCategory } from "../lib/useProducts";
import { getCategory } from "../data/categories";
import { ILLUSTRATIONS } from "../components/illustrations/Illustrations";
import { resolveIllustrationKey } from "../lib/productDisplay";
import { formatPrice } from "../lib/format";
import { useCart } from "../lib/cart-context";
import { ProductCard } from "../components/shop/ProductCard";
import { Section, SectionHeading } from "../components/ui/Section";
import { PageLoader, PageError } from "../components/ui/PageState";
import { usePageMeta } from "../lib/usePageMeta";
import NotFound from "./NotFound";

export default function ProductDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading, isError, refetch } = useProduct(slug);
  const { data: allProducts } = useAllProducts();

  usePageMeta(product ? product.name : "Product", product?.shortDescription);

  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedColor, setSelectedColor] = useState<string | undefined>();
  const [selectedStorage, setSelectedStorage] = useState<string | undefined>();

  const category = product ? getCategory(product.category) : undefined;
  const Illustration = product ? ILLUSTRATIONS[resolveIllustrationKey(product)] : undefined;

  const related = useMemo(() => {
    if (!product || !allProducts) return [];
    return filterByCategory(allProducts, product.category)
      .filter((p) => p.id !== product.id)
      .slice(0, 4);
  }, [product, allProducts]);

  const color = selectedColor ?? product?.colors[0]?.name;
  const storageOption = product?.storageOptions.find(
    (o) => o.label === (selectedStorage ?? product.storageOptions[0]?.label)
  );
  const storage = storageOption?.label;
  const price = product ? product.price + (storageOption?.priceDelta ?? 0) : 0;
  const stock = product
    ? product.storageOptions.length > 0
      ? storageOption?.stock ?? 0
      : product.stock
    : 0;
  const needsStorageChoice = (product?.storageOptions.length ?? 0) > 0 && !storageOption;
  const canAdd = stock > 0 && !needsStorageChoice;

  if (isLoading) return <PageLoader label="Loading product..." />;
  if (isError) return <PageError onRetry={() => refetch()} />;
  if (!product) return <NotFound />;

  const handleAdd = () => {
    if (!canAdd) return;
    addItem(product, qty, { color, storage });
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
          <div>
            <div className={`flex aspect-square items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br ${category?.gradient ?? "from-brand-50 to-white"} p-12 opacity-95`}>
              {product.images.length > 0 ? (
                <img
                  src={product.images[activeImage] ?? product.images[0]}
                  alt={product.name}
                  className="h-full w-full object-contain drop-shadow-2xl"
                />
              ) : (
                Illustration && <Illustration className="h-72 w-72 drop-shadow-2xl animate-float" />
              )}
            </div>
            {product.images.length > 1 && (
              <div className="mt-4 flex gap-3">
                {product.images.map((img, i) => (
                  <button
                    key={img}
                    onClick={() => setActiveImage(i)}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 p-1 ${
                      activeImage === i ? "border-brand-500" : "border-ink-950/10"
                    }`}
                  >
                    <img src={img} alt="" className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            )}
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
              <span className="font-display text-3xl font-extrabold text-ink-950">{formatPrice(price)}</span>
              {product.oldPrice && <span className="text-lg text-ink-950/40 line-through">{formatPrice(product.oldPrice)}</span>}
            </div>

            <p className="mt-5 leading-relaxed text-ink-950/70">{product.description}</p>

            {product.colors.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-bold text-ink-950/80">
                  Colour{color ? `: ${color}` : ""}
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {product.colors.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedColor(c.name)}
                      title={c.name}
                      className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 ${
                        color === c.name ? "border-brand-500" : "border-transparent"
                      }`}
                    >
                      <span
                        className="h-8 w-8 rounded-full border border-black/10 shadow-inner"
                        style={{ backgroundColor: c.hex }}
                      />
                      {color === c.name && (
                        <Check className="absolute h-4 w-4 text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.8)] mix-blend-difference" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {product.storageOptions.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-bold text-ink-950/80">Storage</p>
                <div className="flex flex-wrap gap-2.5">
                  {product.storageOptions.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setSelectedStorage(o.label)}
                      disabled={o.stock === 0}
                      className={`rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        storage === o.label
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
                      }`}
                    >
                      {o.label}
                      {o.priceDelta > 0 && <span className="ml-1 font-normal opacity-70">+{formatPrice(o.priceDelta)}</span>}
                      {o.stock === 0 && <span className="ml-1 font-normal">(Sold out)</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5">
              {stock === 0 ? (
                <p className="text-sm font-bold text-rose-600">Out of stock</p>
              ) : stock <= 5 ? (
                <p className="text-sm font-bold text-accent-600">Only {stock} left in stock</p>
              ) : (
                <p className="text-sm font-semibold text-teal-600">In stock</p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 rounded-full border border-ink-950/10 px-2 py-1.5">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-950/5" aria-label="Decrease quantity">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center font-bold">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(stock || 1, q + 1))} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-950/5" aria-label="Increase quantity">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={handleAdd}
                disabled={!canAdd}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-8 py-3.5 text-base font-bold text-white shadow-glow transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                {added ? <CheckCircle2 className="h-5 w-5" /> : <ShoppingBasket className="h-5 w-5" />}
                {added ? "Added to Basket" : stock === 0 ? "Out of Stock" : "Add to Basket"}
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
