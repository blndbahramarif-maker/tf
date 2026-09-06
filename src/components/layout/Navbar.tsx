import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  ShoppingBasket,
  Menu,
  X,
  ChevronDown,
  Phone,
  Wrench,
} from "lucide-react";
import { categories } from "../../data/categories";
import { useAllProducts, searchProductList } from "../../lib/useProducts";
import { useCart } from "../../lib/cart-context";

const navLinkBase =
  "px-3 py-2 text-sm font-semibold transition-colors rounded-full";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cart = useCart();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    setMobileOpen(false);
    setShopOpen(false);
    setSearchOpen(false);
  }, [navigate]);

  const { data: allProducts } = useAllProducts();
  const results = searchProductList(allProducts ?? [], query).slice(0, 6);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/shop?q=${encodeURIComponent(query.trim())}`);
      setSearchOpen(false);
      setQuery("");
    }
  }

  return (
    <>
      <div className="hidden bg-ink-950 text-white sm:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-xs sm:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <a href="tel:07939294583" className="flex items-center gap-1.5 hover:text-brand-300">
              <Phone className="h-3.5 w-3.5" /> 07939 294583
            </a>
            <span className="hidden items-center gap-1.5 text-white/70 md:flex">
              10 Russell Hill Road, Purley, CR8 2LA
            </span>
          </div>
          <Link to="/repairs" className="flex items-center gap-1.5 font-semibold text-accent-400 hover:text-accent-300">
            <Wrench className="h-3.5 w-3.5" /> Same-Day &amp; Next-Day Repairs Available
          </Link>
        </div>
      </div>

      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-white/90 shadow-md backdrop-blur-lg" : "bg-white"
        }`}
      >
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 shadow-glow">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-white">
                <rect x="7" y="2" width="10" height="20" rx="2.5" fill="currentColor" opacity="0.95" />
                <rect x="9" y="5" width="6" height="12" rx="0.5" fill="#4a17cc" />
                <circle cx="12" cy="19" r="1" fill="#4a17cc" />
              </svg>
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-display text-lg font-extrabold text-ink-950">DGN Tech</span>
              <span className="-mt-1 text-[11px] font-bold uppercase tracking-widest text-brand-600">Mobiles</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            <NavLink to="/" className={({ isActive }) => `${navLinkBase} ${isActive ? "bg-brand-50 text-brand-700" : "text-ink-950/80 hover:bg-ink-950/5"}`}>
              Home
            </NavLink>
            <div
              className="relative"
              onMouseEnter={() => setShopOpen(true)}
              onMouseLeave={() => setShopOpen(false)}
            >
              <button
                className={`${navLinkBase} flex items-center gap-1 text-ink-950/80 hover:bg-ink-950/5`}
                onClick={() => setShopOpen((o) => !o)}
              >
                Shop <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {shopOpen && (
                <div className="absolute left-1/2 top-full w-[560px] -translate-x-1/2 pt-3">
                  <div className="grid grid-cols-2 gap-1 rounded-2xl border border-ink-950/5 bg-white p-3 shadow-soft">
                    {categories.map((c) => (
                      <Link
                        key={c.slug}
                        to={c.href}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-brand-50"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${c.gradient}`} />
                        <span>
                          <span className="block text-sm font-bold text-ink-950">{c.shortName}</span>
                          <span className="block text-xs text-ink-950/50">{c.tagline}</span>
                        </span>
                      </Link>
                    ))}
                    <Link to="/shop" className="col-span-2 mt-1 flex items-center justify-center rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-bold text-brand-700 hover:bg-brand-100">
                      View All Products
                    </Link>
                  </div>
                </div>
              )}
            </div>
            <NavLink to="/repairs" className={({ isActive }) => `${navLinkBase} ${isActive ? "bg-accent-50 text-accent-700" : "text-ink-950/80 hover:bg-ink-950/5"}`}>
              Repairs
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => `${navLinkBase} ${isActive ? "bg-brand-50 text-brand-700" : "text-ink-950/80 hover:bg-ink-950/5"}`}>
              About Us
            </NavLink>
            <NavLink to="/contact" className={({ isActive }) => `${navLinkBase} ${isActive ? "bg-brand-50 text-brand-700" : "text-ink-950/80 hover:bg-ink-950/5"}`}>
              Contact
            </NavLink>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setSearchOpen((o) => !o)}
              aria-label="Search products"
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-950/80 hover:bg-ink-950/5"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              onClick={cart.open}
              aria-label="Open basket"
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-950/80 hover:bg-ink-950/5"
            >
              <ShoppingBasket className="h-5 w-5" />
              <AnimatePresence>
                {cart.count > 0 && (
                  <motion.span
                    key={cart.count}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20 }}
                    className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[11px] font-bold text-white"
                  >
                    {cart.count}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-950/80 hover:bg-ink-950/5 lg:hidden"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </nav>

        {searchOpen && (
          <div className="border-t border-ink-950/5 bg-white px-4 py-4 shadow-lg sm:px-6 lg:px-8">
            <form onSubmit={submitSearch} className="mx-auto flex max-w-2xl items-center gap-2">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
                placeholder="Search phones, accessories, drinks, toys..."
                className="w-full rounded-full border border-ink-950/10 bg-ink-950/[0.03] px-5 py-3 text-sm outline-none focus:border-brand-400"
              />
              <button type="submit" className="rounded-full bg-brand-600 px-5 py-3 text-sm font-bold text-white hover:bg-brand-700">
                Search
              </button>
            </form>
            {query && results.length > 0 && (
              <div className="mx-auto mt-3 max-w-2xl divide-y divide-ink-950/5 overflow-hidden rounded-2xl border border-ink-950/5">
                {results.map((r) => (
                  <Link
                    key={r.id}
                    to={`/product/${r.slug}`}
                    onClick={() => setSearchOpen(false)}
                    className="flex items-center justify-between bg-white px-4 py-3 text-sm hover:bg-brand-50"
                  >
                    <span className="font-semibold text-ink-950">{r.name}</span>
                    <span className="text-ink-950/50">{r.subcategory}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-lg font-extrabold text-ink-950">Menu</span>
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink-950/5">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {[
                { to: "/", label: "Home" },
                { to: "/shop", label: "Shop All" },
                { to: "/phones", label: "Phones & Technology" },
                { to: "/accessories", label: "Phone Accessories" },
                { to: "/repairs", label: "Repairs" },
                { to: "/drinks", label: "Drinks" },
                { to: "/kitchen", label: "Kitchen & Home" },
                { to: "/toys", label: "Kids' Toys" },
                { to: "/vape", label: "Vape 18+" },
                { to: "/about", label: "About Us" },
                { to: "/contact", label: "Contact" },
              ].map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `rounded-xl px-4 py-3.5 text-base font-semibold ${
                      isActive ? "bg-brand-50 text-brand-700" : "text-ink-950/80 hover:bg-ink-950/5"
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-3 border-t border-ink-950/10 pt-6">
              <a href="tel:07939294583" className="flex items-center justify-center gap-2 rounded-full bg-brand-600 px-5 py-3.5 text-sm font-bold text-white">
                <Phone className="h-4 w-4" /> Call 07939 294583
              </a>
              <Link to="/repairs" className="flex items-center justify-center gap-2 rounded-full bg-accent-500 px-5 py-3.5 text-sm font-bold text-white">
                Book a Repair
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
