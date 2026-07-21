// src/components/PortalLayout.jsx
// Deliberately not DashboardLayout's sidebar — an owner's whole world is
// "my properties," not the dozen internal nav items staff need. A simple
// top bar keeps this feeling like its own product, matching the "one
// login, mode-switch" framing this was scoped around rather than looking
// like a cut-down version of the internal app.

import { Outlet, Link, useNavigate } from "react-router-dom";
import { usePortalAuth } from "../context/PortalAuthContext.jsx";
import { APP_NAME } from "../config.js";

export default function PortalLayout() {
  const { account, logout } = usePortalAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/portal/login", { replace: true });
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.9rem 1.6rem",
          background: "var(--navy)",
          color: "var(--off-white)",
        }}
      >
        <Link to="/portal" style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "inherit", textDecoration: "none" }}>
          <svg width="26" height="26" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="32" height="32" rx="3" stroke="#C9A227" strokeWidth="1.5" />
            <path d="M9 24L17 8L21 16H25L17 27L13 19H9" stroke="#3DBA6E" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "1.05rem" }}>
            {APP_NAME} <span style={{ fontWeight: 500, opacity: 0.75 }}>· Owner Portal</span>
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.85rem", opacity: 0.85 }}>{account?.fullName}</span>
          <button className="logout-btn" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "1.8rem 1.6rem" }}>
        <Outlet />
      </main>
    </div>
  );
}
