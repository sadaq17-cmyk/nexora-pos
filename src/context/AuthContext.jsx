import { createContext, useContext, useState, useEffect } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);
const STORAGE_KEY = "nexora_session";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);

  const loadPermissions = async () => {
    if (!api.permissions?.getMine) return;
    const perms = await api.permissions.getMine();
    setPermissions(perms || {});
  };

  useEffect(() => {
    (async () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const cachedUser = JSON.parse(raw);
          setUser(cachedUser);
          // The main process only knows who's logged in via this call —
          // it has no access to the renderer's localStorage.
          if (api.auth?.restoreSession) await api.auth.restoreSession(cachedUser);
          await loadPermissions();
        } catch { /* ignore corrupt session */ }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const result = await api.auth.login(email, password);
    if (result.success) {
      setUser(result.user);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result.user));
      await loadPermissions();
    }
    return result;
  };

  const logout = () => {
    api.auth?.logout?.();
    setUser(null);
    setPermissions({});
    localStorage.removeItem(STORAGE_KEY);
  };

  // Admins implicitly have everything, even if the permissions table hasn't
  // loaded yet — avoids a flash of "no access" right after login.
  const can = (module, action) => {
    if (user?.role === "admin") return true;
    return !!permissions?.[module]?.[action];
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, permissions, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
