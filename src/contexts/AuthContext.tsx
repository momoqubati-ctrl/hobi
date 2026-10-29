import React, { createContext, useContext } from "react";
import { useAuth, type UseAuthReturn } from "@/hooks/useAuth";

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<UseAuthReturn | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

// ─── Consumer hook ────────────────────────────────────────────────────────────

/**
 * useAuthContext – returns the auth state/actions from the nearest AuthProvider.
 * Must be used inside <AuthProvider>.
 */
export function useAuthContext(): UseAuthReturn {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used inside <AuthProvider>");
  }
  return ctx;
}
