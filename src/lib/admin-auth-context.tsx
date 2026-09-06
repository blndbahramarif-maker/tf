import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { adminLogin, adminMe, ApiError } from "./api";

const TOKEN_KEY = "dgn-admin-token";

interface AdminAuthValue {
  token: string | null;
  admin: { id: number; email: string } | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [admin, setAdmin] = useState<AdminAuthValue["admin"]>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setAdmin(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    adminMe(token)
      .then((a) => {
        if (!cancelled) setAdmin(a);
      })
      .catch(() => {
        if (!cancelled) {
          setAdmin(null);
          setToken(null);
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            /* ignore */
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function login(email: string, password: string) {
    const session = await adminLogin(email, password);
    setToken(session.token);
    setAdmin(session.admin);
    try {
      localStorage.setItem(TOKEN_KEY, session.token);
    } catch {
      /* storage unavailable */
    }
  }

  function logout() {
    setToken(null);
    setAdmin(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <AdminAuthContext.Provider value={{ token, admin, isLoading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}

export { ApiError };
