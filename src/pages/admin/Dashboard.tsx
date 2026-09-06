import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Package, ClipboardList, AlertTriangle, PoundSterling, ArrowRight } from "lucide-react";
import { useAdminAuth } from "../../lib/admin-auth-context";
import { adminListProducts, adminListOrders } from "../../lib/api";
import { productTotalStock } from "../../types/product";
import { formatPrice } from "../../lib/format";
import { usePageMeta } from "../../lib/usePageMeta";
import { PageLoader, PageError } from "../../components/ui/PageState";

export default function AdminDashboard() {
  usePageMeta("Admin Dashboard", "DGN Tech Mobiles admin overview.");
  const { token } = useAdminAuth();

  const productsQuery = useQuery({
    queryKey: ["admin", "products"],
    queryFn: () => adminListProducts(token as string),
    enabled: !!token,
  });
  const ordersQuery = useQuery({
    queryKey: ["admin", "orders"],
    queryFn: () => adminListOrders(token as string),
    enabled: !!token,
  });

  if (productsQuery.isLoading || ordersQuery.isLoading) return <PageLoader label="Loading dashboard..." />;
  if (productsQuery.isError || ordersQuery.isError) {
    return <PageError onRetry={() => { productsQuery.refetch(); ordersQuery.refetch(); }} />;
  }

  const products = productsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const lowStock = products.filter((p) => {
    const stock = productTotalStock(p);
    return stock > 0 && stock <= 5;
  });
  const outOfStock = products.filter((p) => productTotalStock(p) === 0);
  const pendingOrders = orders.filter((o) => o.status === "pending");
  const revenue = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total, 0);

  const stats = [
    { label: "Total Products", value: products.length, icon: Package, tone: "from-brand-500 to-brand-700" },
    { label: "Total Orders", value: orders.length, icon: ClipboardList, tone: "from-teal-400 to-teal-600" },
    { label: "Pending Orders", value: pendingOrders.length, icon: AlertTriangle, tone: "from-accent-400 to-accent-600" },
    { label: "Total Revenue", value: formatPrice(revenue), icon: PoundSterling, tone: "from-emerald-400 to-emerald-600" },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink-950">Dashboard</h1>
      <p className="mt-1 text-sm text-ink-950/50">A quick overview of your shop.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-ink-950/5 bg-white p-5 shadow-soft">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${s.tone}`}>
              <s.icon className="h-5 w-5 text-white" />
            </span>
            <p className="mt-3 font-display text-2xl font-extrabold text-ink-950">{s.value}</p>
            <p className="text-sm text-ink-950/50">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink-950/5 bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink-950">Recent Orders</h2>
            <Link to="/admin/orders" className="flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-ink-950/50">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-ink-950/5">
              {orders.slice(0, 5).map((o) => (
                <li key={o.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <Link to={`/admin/orders/${o.id}`} className="font-bold text-ink-950 hover:text-brand-600">
                      #{o.orderNumber}
                    </Link>
                    <p className="text-ink-950/50">{o.customerName}</p>
                  </div>
                  <span className="font-bold text-ink-950">{formatPrice(o.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-ink-950/5 bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink-950">Stock Alerts</h2>
            <Link to="/admin/products" className="flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700">
              Manage products <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {lowStock.length === 0 && outOfStock.length === 0 ? (
            <p className="text-sm text-ink-950/50">All products are well stocked.</p>
          ) : (
            <ul className="divide-y divide-ink-950/5">
              {[...outOfStock, ...lowStock].slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3 text-sm">
                  <Link to={`/admin/products/${p.id}/edit`} className="font-semibold text-ink-950 hover:text-brand-600">
                    {p.name}
                  </Link>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      productTotalStock(p) === 0 ? "bg-rose-100 text-rose-700" : "bg-accent-100 text-accent-700"
                    }`}
                  >
                    {productTotalStock(p)} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
