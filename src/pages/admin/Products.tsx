import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useAdminAuth } from "../../lib/admin-auth-context";
import { adminDeleteProduct, adminListProducts } from "../../lib/api";
import { productTotalStock } from "../../types/product";
import { categories } from "../../data/categories";
import { formatPrice } from "../../lib/format";
import { PageLoader, PageError } from "../../components/ui/PageState";
import { usePageMeta } from "../../lib/usePageMeta";
import { PRODUCTS_QUERY_KEY } from "../../lib/useProducts";

export default function AdminProducts() {
  usePageMeta("Manage Products", "Add, edit and remove products.");
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const productsQuery = useQuery({
    queryKey: ["admin", "products"],
    queryFn: () => adminListProducts(token as string),
    enabled: !!token,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminDeleteProduct(token as string, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      setConfirmDelete(null);
    },
  });

  const filtered = useMemo(() => {
    let list = productsQuery.data ?? [];
    if (category !== "All") list = list.filter((p) => p.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [productsQuery.data, category, query]);

  if (productsQuery.isLoading) return <PageLoader label="Loading products..." />;
  if (productsQuery.isError) return <PageError onRetry={() => productsQuery.refetch()} />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-950">Products</h1>
          <p className="mt-1 text-sm text-ink-950/50">{productsQuery.data?.length ?? 0} products in your catalogue.</p>
        </div>
        <Link
          to="/admin/products/new"
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2.5 text-sm font-bold text-white shadow-glow hover:-translate-y-0.5"
        >
          <Plus className="h-4 w-4" /> Add Product
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-950/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products..."
            className="input pl-10"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input w-auto">
          <option value="All">All Categories</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-ink-950/5 bg-white shadow-soft">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-ink-950/5 bg-ink-950/[0.02] text-xs font-bold uppercase tracking-wide text-ink-950/50">
            <tr>
              <th className="px-5 py-3">Product</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Price</th>
              <th className="px-5 py-3">Stock</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-950/5">
            {filtered.map((p) => {
              const stock = productTotalStock(p);
              return (
                <tr key={p.id} className="hover:bg-ink-950/[0.015]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-50">
                        {p.images[0] ? (
                          <img src={p.images[0]} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-xs font-bold text-brand-400">{p.name[0]}</span>
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-ink-950">{p.name}</p>
                        <p className="text-xs text-ink-950/40">{p.subcategory}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-950/70">{categories.find((c) => c.slug === p.category)?.shortName ?? p.category}</td>
                  <td className="px-5 py-3 font-bold text-ink-950">{formatPrice(p.price)}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        stock === 0 ? "bg-rose-100 text-rose-700" : stock <= 5 ? "bg-accent-100 text-accent-700" : "bg-teal-100 text-teal-700"
                      }`}
                    >
                      {stock}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {p.featured && <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-bold text-brand-700">Featured</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/admin/products/${p.id}/edit`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-950/10 text-ink-950/60 hover:border-brand-300 hover:text-brand-600"
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-950/10 text-ink-950/60 hover:border-rose-300 hover:text-rose-600"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-950/40">
                  No products match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-ink-950">Delete this product?</h3>
            <p className="mt-2 text-sm text-ink-950/60">
              This will permanently remove it from the shop. This can't be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-full border border-ink-950/15 py-2.5 text-sm font-bold text-ink-950/70 hover:bg-ink-950/5"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete)}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-full bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
