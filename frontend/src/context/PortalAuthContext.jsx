// src/context/PortalAuthContext.jsx
// Mirrors AuthContext.jsx's shape (user/loading/login/logout) but talks to
// the separate portal_accounts identity via portalClient.js. No
// impersonation concept here — that's a platform-admin thing scoped to
// internal users, not relevant to owner logins.

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { portalApi, setPortalToken } from "../api/portalClient";

const PortalAuthContext = createContext(null);

export function PortalAuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("radah_portal_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await portalApi.get("/me");
      setAccount(data.account);
    } catch {
      setPortalToken(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  async function login(email, password) {
    const data = await portalApi.post("/login", { email, password }, { auth: false });
    setPortalToken(data.token);
    setAccount(data.account);
    return data.account;
  }

  function logout() {
    setPortalToken(null);
    setAccount(null);
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await portalApi.post("/change-password", { currentPassword, newPassword });
    if (data.token) setPortalToken(data.token);
    return data;
  }

  return (
    <PortalAuthContext.Provider value={{ account, loading, login, logout, changePassword, reload: loadMe }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error("usePortalAuth must be used within a PortalAuthProvider");
  return ctx;
}
