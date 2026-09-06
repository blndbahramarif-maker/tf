import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { products as allProducts } from "../data/products";
import { categories } from "../data/categories";
import { ProductCard } from "../components/shop/ProductCard";
import { Section } from "../components/ui/Section";
import { usePageMeta } from "../lib/usePageMeta";

type SortKey = "featured" | "price-asc" | "price-desc" | "name-asc";

export default function Shop() {
  usePageMeta("Shop All Products", "Browse everything at DGN Tech Mobiles — phones, accessories, drinks, kitchen essentials, toys and more.");
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [sort, setSort] = useState<SortKey>("featured");

  const shoppable = allProducts.filter((p) => p.category !== "vape");

  const filtered = useMemo(() => {
    let list = shoppable;
    if (urlQuery) {
      const q = urlQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.subcategory.toLowerCase().includes(q));
    }
    if (activeCategory !== "All") list = list.filter((p) => p.category === activeCategory);

    const sorted = [...list];
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "featured") sorted.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shoppable, urlQuery, activeCategory, sort]);

  return (
    <div>
      <div className="relative overflow-hidden bg-gradient-to-br from-ink-950 via-brand-950 to-brand-800 py-14 text-white sm:py-20">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest backdrop-blur">
            Shop All
          </span>
          <h1 className="mt-4 max-w-2xl text-balance font-display text-3xl font-extrabold sm:text-4xl lg:text-5xl">
            Everything In One Place
          </h1>
          <p className="mt-4 max-w-xl text-balance text-white/80">
            Search and filter across our full range of phones, accessories, drinks, kitchen essentials and toys.
          </p>
        </div>
      </div>

      <Section className="pt-10">
        {urlQuery && (
          <p className="mb-6 text-sm text-ink-950/60">
            Showing results for <span className="font-bold text-ink-950">&ldquo;{urlQuery}&rdquo;</span>
          </p>
        )}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory("All")}
              className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                activeCategory === "All" ? "border-transparent bg-brand-600 text-white" : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
              }`}
            >
              All
            </button>
            {categories.filter((c) => c.slug !== "vape").map((c) => (
              <button
                key={c.slug}
                onClick={() => setActiveCategory(c.slug)}
                className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                  activeCategory === c.slug ? `border-transparent bg-gradient-to-r ${c.gradient} text-white` : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
                }`}
              >
                {c.shortName}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-xl border border-ink-950/10 px-3.5 py-2.5 text-sm font-medium"
          >
            <option value="featured">Featured</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="name-asc">Name: A–Z</option>
          </select>
        </div>

        <p className="mb-6 text-sm font-semibold text-ink-950/60">{filtered.length} products</p>

        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink-950/15 py-24 text-center">
            <p className="font-display text-lg font-bold text-ink-950">No products found</p>
            <p className="mt-2 text-sm text-ink-950/50">Try a different search term or category.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        )}

        <div className="mt-16 rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Looking for vape products?{" "}
          <Link to="/vape" className="font-bold text-slate-700 underline">
            Visit our age-restricted 18+ Vape section
          </Link>
          .
        </div>
      </Section>
    </div>
  );
}
