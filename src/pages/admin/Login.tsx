import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Lock, AlertTriangle } from "lucide-react";
import { useAdminAuth } from "../../lib/admin-auth-context";
import { usePageMeta } from "../../lib/usePageMeta";

export default function AdminLogin() {
  usePageMeta("Admin Login", "Sign in to manage DGN Tech Mobiles.");
  const { admin, isLoading, login } = useAdminAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && admin) {
    const from = (location.state as { from?: Location })?.from;
    return <Navigate to={from?.pathname || "/admin"} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ink-950 via-brand-950 to-brand-900 px-4">
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-20" />
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white p-8 shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800">
          <Lock className="h-6 w-6 text-white" />
        </div>
        <h1 className="mt-5 text-center font-display text-2xl font-bold text-ink-950">Admin Sign In</h1>
        <p className="mt-1 text-center text-sm text-ink-950/50">DGN Tech Mobiles Dashboard</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-ink-950/80">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input mt-1.5 font-normal"
              placeholder="admin@dgntechmobiles.co.uk"
              autoFocus
            />
          </label>
          <label className="block text-sm font-bold text-ink-950/80">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input mt-1.5 font-normal"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="flex items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-semibold text-rose-600">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
