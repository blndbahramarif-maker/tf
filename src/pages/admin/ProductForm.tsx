import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useAdminAuth } from "../../lib/admin-auth-context";
import {
  adminCreateProduct,
  adminGetProduct,
  adminListProducts,
  adminUpdateProduct,
  ApiError,
} from "../../lib/api";
import { categories, type CategorySlug } from "../../data/categories";
import { ImageUploader } from "../../components/admin/ImageUploader";
import { ColorsEditor, type ColorInput } from "../../components/admin/ColorsEditor";
import { StorageOptionsEditor, type StorageOptionInput } from "../../components/admin/StorageOptionsEditor";
import { PageLoader, PageError } from "../../components/ui/PageState";
import { usePageMeta } from "../../lib/usePageMeta";
import { PRODUCTS_QUERY_KEY } from "../../lib/useProducts";

interface FormState {
  name: string;
  category: CategorySlug;
  subcategory: string;
  brand: string;
  condition: "" | "New" | "Used" | "Refurbished";
  price: string;
  oldPrice: string;
  badge: string;
  featured: boolean;
  description: string;
  shortDescription: string;
  stock: string;
  images: string[];
  colors: ColorInput[];
  storageOptions: StorageOptionInput[];
}

const emptyForm: FormState = {
  name: "",
  category: "phones",
  subcategory: "",
  brand: "",
  condition: "",
  price: "",
  oldPrice: "",
  badge: "",
  featured: false,
  description: "",
  shortDescription: "",
  stock: "0",
  images: [],
  colors: [],
  storageOptions: [],
};

export default function AdminProductForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  usePageMeta(isEdit ? "Edit Product" : "Add Product", "Manage your product catalogue.");

  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const productQuery = useQuery({
    queryKey: ["admin", "product", id],
    queryFn: () => adminGetProduct(token as string, Number(id)),
    enabled: !!token && isEdit,
  });

  const allProductsQuery = useQuery({
    queryKey: ["admin", "products"],
    queryFn: () => adminListProducts(token as string),
    enabled: !!token,
  });

  useEffect(() => {
    if (productQuery.data) {
      const p = productQuery.data;
      setForm({
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
        brand: p.brand ?? "",
        condition: (p.condition as FormState["condition"]) ?? "",
        price: String(p.price),
        oldPrice: p.oldPrice != null ? String(p.oldPrice) : "",
        badge: p.badge ?? "",
        featured: p.featured,
        description: p.description,
        shortDescription: p.shortDescription,
        stock: String(p.stock),
        images: p.images,
        colors: p.colors.map((c) => ({ name: c.name, hex: c.hex })),
        storageOptions: p.storageOptions.map((o) => ({
          label: o.label,
          priceDelta: String(o.priceDelta),
          stock: String(o.stock),
        })),
      });
    }
  }, [productQuery.data]);

  const subcategorySuggestions = useMemo(() => {
    const list = allProductsQuery.data ?? [];
    const set = new Set(list.filter((p) => p.category === form.category).map((p) => p.subcategory));
    return Array.from(set);
  }, [allProductsQuery.data, form.category]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        category: form.category,
        subcategory: form.subcategory,
        brand: form.brand || null,
        condition: (form.condition || null) as never,
        price: parseFloat(form.price) || 0,
        oldPrice: form.oldPrice ? parseFloat(form.oldPrice) : null,
        badge: form.badge || null,
        featured: form.featured,
        description: form.description,
        shortDescription: form.shortDescription,
        stock: parseInt(form.stock, 10) || 0,
        images: form.images,
        colors: form.colors.filter((c) => c.name.trim()),
        storageOptions: form.storageOptions
          .filter((o) => o.label.trim())
          .map((o) => ({
            label: o.label,
            priceDelta: parseFloat(o.priceDelta) || 0,
            stock: parseInt(o.stock, 10) || 0,
          })),
      };
      return isEdit
        ? adminUpdateProduct(token as string, Number(id), payload)
        : adminCreateProduct(token as string, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      navigate("/admin/products");
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not save product.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.subcategory.trim() || !form.price) {
      setError("Name, subcategory and price are required.");
      return;
    }
    mutation.mutate();
  }

  if (isEdit && productQuery.isLoading) return <PageLoader label="Loading product..." />;
  if (isEdit && productQuery.isError) return <PageError onRetry={() => productQuery.refetch()} />;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/admin/products" className="flex items-center gap-1.5 text-sm font-semibold text-ink-950/50 hover:text-ink-950">
        <ArrowLeft className="h-4 w-4" /> Back to Products
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-ink-950">
        {isEdit ? `Edit ${productQuery.data?.name ?? "Product"}` : "Add New Product"}
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Basic Details</h2>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label className="block text-sm font-bold text-ink-950/80 sm:col-span-2">
              Product Name *
              <input className="input mt-1.5 font-normal" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Category *
              <select
                className="input mt-1.5 font-normal"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as CategorySlug }))}
              >
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Subcategory *
              <input
                list="subcategory-suggestions"
                className="input mt-1.5 font-normal"
                value={form.subcategory}
                onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                placeholder="e.g. Smartphones"
              />
              <datalist id="subcategory-suggestions">
                {subcategorySuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Brand
              <input className="input mt-1.5 font-normal" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="e.g. Apple" />
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Condition
              <select className="input mt-1.5 font-normal" value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value as FormState["condition"] }))}>
                <option value="">Not applicable</option>
                <option value="New">New</option>
                <option value="Used">Used</option>
                <option value="Refurbished">Refurbished</option>
              </select>
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Badge
              <input className="input mt-1.5 font-normal" value={form.badge} onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value }))} placeholder="e.g. Best Seller" />
            </label>
            <label className="flex items-center gap-2.5 pt-7 text-sm font-bold text-ink-950/80">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} className="h-4 w-4 rounded accent-brand-600" />
              Feature on homepage
            </label>
            <label className="block text-sm font-bold text-ink-950/80 sm:col-span-2">
              Short Description
              <input className="input mt-1.5 font-normal" value={form.shortDescription} onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))} placeholder="One line shown on product cards" />
            </label>
            <label className="block text-sm font-bold text-ink-950/80 sm:col-span-2">
              Full Description
              <textarea className="input mt-1.5 min-h-28 resize-y font-normal" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Pricing &amp; Stock</h2>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <label className="block text-sm font-bold text-ink-950/80">
              Price (£) *
              <input type="number" step="0.01" min="0" className="input mt-1.5 font-normal" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Was Price (£)
              <input type="number" step="0.01" min="0" className="input mt-1.5 font-normal" value={form.oldPrice} onChange={(e) => setForm((f) => ({ ...f, oldPrice: e.target.value }))} placeholder="Optional" />
            </label>
            <label className="block text-sm font-bold text-ink-950/80">
              Stock
              <input
                type="number"
                min="0"
                disabled={form.storageOptions.length > 0}
                className="input mt-1.5 font-normal disabled:opacity-40"
                value={form.stock}
                onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
              />
              {form.storageOptions.length > 0 && (
                <span className="mt-1 block text-xs font-normal text-ink-950/40">Managed per storage option below</span>
              )}
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Photos</h2>
          <p className="mt-1 text-sm text-ink-950/50">
            Upload real product photos. Until you do, a placeholder illustration is shown automatically.
          </p>
          <div className="mt-4">
            <ImageUploader images={form.images} onChange={(images) => setForm((f) => ({ ...f, images }))} />
          </div>
        </div>

        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Colours</h2>
          <p className="mt-1 text-sm text-ink-950/50">Optional. Add the colour options customers can choose from.</p>
          <div className="mt-4">
            <ColorsEditor colors={form.colors} onChange={(colors) => setForm((f) => ({ ...f, colors }))} />
          </div>
        </div>

        <div className="rounded-2xl border border-ink-950/5 bg-white p-6 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-950">Storage Options</h2>
          <p className="mt-1 text-sm text-ink-950/50">Optional. Use this for phones/tablets with multiple storage sizes.</p>
          <div className="mt-4">
            <StorageOptionsEditor options={form.storageOptions} onChange={(storageOptions) => setForm((f) => ({ ...f, storageOptions }))} />
          </div>
        </div>

        {error && (
          <p className="flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-8 py-3.5 text-sm font-bold text-white shadow-glow transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}
          </button>
          <Link to="/admin/products" className="rounded-full border border-ink-950/15 px-6 py-3.5 text-sm font-bold text-ink-950/70 hover:bg-ink-950/5">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
