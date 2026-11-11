import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthUser } from "@workspace/api-client-react";
export type { AuthUser };

type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (returnTo?: string) => void;
  logout: () => void;
  reload: () => void;
};
const Context = createContext<AuthState | null>(null);
function safePath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f]/.test(path) ? path : "/";
}
export function AuthProvider({ children, basePath = "" }: { children: ReactNode; basePath?: string }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const hasAuthenticatedSession = useRef(false);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setVersion(v => v + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    // Returning from a native file picker focuses the window. Recheck the
    // session without unmounting the page and discarding its unsaved forms.
    setLoading(!hasAuthenticatedSession.current); setError(null);
    fetch("/api/auth/user", { credentials: "include", cache: "no-store", signal: ctrl.signal })
      .then(async res => {
        if (!res.ok) throw new Error("Sign-in status could not be checked. Please try again.");
        return await res.json() as { user: AuthUser | null };
      })
      .then(data => { if (!ctrl.signal.aborted) { hasAuthenticatedSession.current = !!data.user; setUser(data.user); setLoading(false); } })
      .catch(e => { if (!ctrl.signal.aborted) { hasAuthenticatedSession.current = false; setUser(null); setError(e.message); setLoading(false); } });
    return () => ctrl.abort();
  }, [version]);
  const login = useCallback((returnTo?: string) => {
    const url = `/api/login?returnTo=${encodeURIComponent(safePath(returnTo ?? (basePath || "/")))}`;
    if (window.top !== window.self) window.open(url, "_blank", "noopener,noreferrer");
    else window.location.assign(url);
  }, [basePath]);
  const logout = useCallback(() => {
    const url = `/api/logout?returnTo=${encodeURIComponent(basePath || "/")}`;
    if (window.top !== window.self) window.open(url, "_blank", "noopener,noreferrer");
    else window.location.assign(url);
  }, [basePath]);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  return <Context.Provider value={{ user, isLoading, error, isAuthenticated: !!user, login, logout, reload }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}
