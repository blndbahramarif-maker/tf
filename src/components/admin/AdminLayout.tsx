import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ClipboardList, LogOut, ExternalLink } from "lucide-react";
import { useAdminAuth } from "../../lib/admin-auth-context";

const navItems = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/orders", label: "Orders", icon: ClipboardList },
];

export function AdminLayout() {
  const { admin, isLoading, logout } = useAdminAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 text-white/60">
        Loading admin dashboard...
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col bg-ink-950 text-white lg:flex">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-6 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white">
              <rect x="7" y="2" width="10" height="20" rx="2.5" fill="currentColor" opacity="0.95" />
              <rect x="9" y="5" width="6" height="12" rx="0.5" fill="#4a17cc" />
              <circle cx="12" cy="19" r="1" fill="#4a17cc" />
            </svg>
          </span>
          <div>
            <p className="font-display text-sm font-extrabold leading-tight">DGN Tech</p>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-300">Admin</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-6">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-white/10 px-3 py-4">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/60 hover:bg-white/5 hover:text-white"
          >
            <ExternalLink className="h-4 w-4" /> View Shop
          </Link>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/60 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Log Out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-ink-950/5 bg-white px-4 py-4 sm:px-8">
          <p className="font-display text-lg font-bold text-ink-950 lg:hidden">DGN Admin</p>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-950/60">{admin.email}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
              {admin.email[0]?.toUpperCase()}
            </span>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-8">
          <Outlet />
        </main>

        <nav className="sticky bottom-0 z-10 flex items-center justify-around border-t border-ink-950/10 bg-white py-2 lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-4 py-1.5 text-xs font-semibold ${
                  isActive ? "text-brand-600" : "text-ink-950/50"
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
