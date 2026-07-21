import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  AuthUser,
  bootstrapAuthHeaders,
  clearSession,
  getStoredToken,
  getStoredUser,
  loginRequest,
} from '../services/auth';

bootstrapAuthHeaders();

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() =>
    getStoredToken() ? getStoredUser() : null
  );

  const login = useCallback(async (username: string, password: string) => {
    const res = await loginRequest(username, password);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      login,
      logout,
    }),
    [user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
