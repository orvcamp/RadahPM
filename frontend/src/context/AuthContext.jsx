// src/context/AuthContext.jsx

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken } from "../api/client";

const AuthContext = createContext(null);

// Separate localStorage keys for the platform admin's own session, stashed
// aside while impersonating an org. Kept distinct from the regular token key
// so a page refresh mid-impersonation doesn't lose the way back.
const STASH_TOKEN_KEY = "radah_pm_platform_stash_token";
const STASH_USER_KEY = "radah_pm_platform_stash_user";
const IMPERSONATING_ORG_KEY = "radah_pm_impersonating_org_name";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [impersonatingOrgName, setImpersonatingOrgName] = useState(localStorage.getItem(IMPERSONATING_ORG_KEY) || null);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("radah_pm_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get("/auth/me");
      setUser(data.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  async function login(email, password) {
    const data = await api.post("/auth/login", { email, password }, { auth: false });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  async function register(payload) {
    const data = await api.post("/auth/register", payload, { auth: false });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    // Logging out fully also clears any stashed impersonation session —
    // don't leave a platform admin's token sitting in localStorage after
    // they've explicitly signed out.
    localStorage.removeItem(STASH_TOKEN_KEY);
    localStorage.removeItem(STASH_USER_KEY);
    localStorage.removeItem(IMPERSONATING_ORG_KEY);
    setImpersonatingOrgName(null);
    setToken(null);
    setUser(null);
  }

  // Switches the active session to the given org's admin, stashing the
  // current (platform admin) session so stopImpersonating can return to it.
  function impersonate({ token, user: targetUser, orgName }) {
    const currentToken = localStorage.getItem("radah_pm_token");
    if (currentToken && user) {
      localStorage.setItem(STASH_TOKEN_KEY, currentToken);
      localStorage.setItem(STASH_USER_KEY, JSON.stringify(user));
    }
    localStorage.setItem(IMPERSONATING_ORG_KEY, orgName);
    setImpersonatingOrgName(orgName);
    setToken(token);
    setUser(targetUser);
  }

  // Restores the stashed platform-admin session. If there's no stash (e.g.
  // a page refresh landed here some other way), this just logs out — never
  // leaves someone stuck in a half-impersonated state.
  function stopImpersonating() {
    const stashedToken = localStorage.getItem(STASH_TOKEN_KEY);
    const stashedUserRaw = localStorage.getItem(STASH_USER_KEY);
    localStorage.removeItem(STASH_TOKEN_KEY);
    localStorage.removeItem(STASH_USER_KEY);
    localStorage.removeItem(IMPERSONATING_ORG_KEY);
    setImpersonatingOrgName(null);
    if (stashedToken && stashedUserRaw) {
      setToken(stashedToken);
      setUser(JSON.parse(stashedUserRaw));
    } else {
      setToken(null);
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, reload: loadMe, impersonate, stopImpersonating, impersonatingOrgName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
