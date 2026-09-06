import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { ProductCard } from "./ProductCard";
import type { Product } from "../../data/products";
import type { Category } from "../../data/categories";

type SortKey = "featured" | "price-asc" | "price-desc" | "name-asc";

export function ProductListingPage({
  category,
  products,
  heroTitle,
  heroDescription,
}: {
  category: Category;
  products: Product[];
  heroTitle: string;
  heroDescription: string;
}) {
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [subcategory, setSubcategory] = useState<string>("All");
  const [brand, setBrand] = useState<string>("All");
  const [condition, setCondition] = useState<string>("All");
  const [sort, setSort] = useState<SortKey>("featured");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const subcategories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((p) => p.subcategory)))],
    [products]
  );
  const brands = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))) as string[],
    [products]
  );
  const conditions = useMemo(
    () => Array.from(new Set(products.map((p) => p.condition).filter(Boolean))) as string[],
    [products]
  );

  const filtered = useMemo(() => {
    let list = products;
    if (urlQuery) {
      const q = urlQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (subcategory !== "All") list = list.filter((p) => p.subcategory === subcategory);
    if (brand !== "All") list = list.filter((p) => p.brand === brand);
    if (condition !== "All") list = list.filter((p) => p.condition === condition);

    const sorted = [...list];
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "featured") sorted.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
    return sorted;
  }, [products, urlQuery, subcategory, brand, condition, sort]);

  const hasActiveFilters = subcategory !== "All" || brand !== "All" || condition !== "All";

  const FilterControls = (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-950/50">Category</h3>
        <div className="flex flex-wrap gap-2">
          {subcategories.map((s) => (
            <button
              key={s}
              onClick={() => setSubcategory(s)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                subcategory === s
                  ? `border-transparent bg-gradient-to-r ${category.gradient} text-white`
                  : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {brands.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-950/50">Brand</h3>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="w-full rounded-xl border border-ink-950/10 px-3.5 py-2.5 text-sm font-medium"
          >
            <option>All</option>
            {brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
      )}

      {conditions.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-950/50">Condition</h3>
          <div className="flex flex-wrap gap-2">
            {["All", ...conditions].map((c) => (
              <button
                key={c}
                onClick={() => setCondition(c)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  condition === c
                    ? `border-transparent bg-gradient-to-r ${category.gradient} text-white`
                    : "border-ink-950/10 text-ink-950/70 hover:border-ink-950/25"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-950/50">Sort By Price</h3>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="w-full rounded-xl border border-ink-950/10 px-3.5 py-2.5 text-sm font-medium"
        >
          <option value="featured">Featured</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="name-asc">Name: A–Z</option>
        </select>
      </div>

      {hasActiveFilters && (
        <button
          onClick={() => {
            setSubcategory("All");
            setBrand("All");
            setCondition("All");
          }}
          className="text-sm font-bold text-brand-600 hover:text-brand-700"
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div>
      <div className={`relative overflow-hidden bg-gradient-to-br ${category.gradient} py-14 text-white sm:py-20`}>
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest backdrop-blur">
            {category.tagline}
          </span>
          <h1 className="mt-4 max-w-2xl text-balance font-display text-3xl font-extrabold sm:text-4xl lg:text-5xl">
            {heroTitle}
          </h1>
          <p className="mt-4 max-w-xl text-balance text-white/80">{heroDescription}</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {urlQuery && (
          <p className="mb-6 text-sm text-ink-950/60">
            Showing results for <span className="font-bold text-ink-950">&ldquo;{urlQuery}&rdquo;</span>
          </p>
        )}
        <div className="flex gap-10">
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-28 rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
              {FilterControls}
            </div>
          </aside>

          <div className="flex-1">
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-950/60">{filtered.length} products</p>
              <button
                onClick={() => setMobileFiltersOpen(true)}
                className="flex items-center gap-2 rounded-full border border-ink-950/10 px-4 py-2 text-sm font-semibold lg:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </button>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-ink-950/15 py-24 text-center">
                <p className="font-display text-lg font-bold text-ink-950">No products found</p>
                <p className="mt-2 text-sm text-ink-950/50">Try adjusting your filters or search term.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p, i) => (
                  <ProductCard key={p.id} product={p} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileFiltersOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-6">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Filters</h3>
              <button onClick={() => setMobileFiltersOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink-950/5">
                <X className="h-5 w-5" />
              </button>
            </div>
            {FilterControls}
            <button
              onClick={() => setMobileFiltersOpen(false)}
              className={`mt-6 w-full rounded-full bg-gradient-to-r ${category.gradient} py-3.5 text-sm font-bold text-white`}
            >
              Show {filtered.length} Results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
