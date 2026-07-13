// src/components/DashboardLayout.jsx

import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { APP_NAME, APP_TAGLINE, ROLE_LABELS_BY_VERTICAL } from "../config.js";
import NotificationBell from "./NotificationBell.jsx";
import ImpersonationBanner from "./ImpersonationBanner.jsx";

// Same 4-tier role shape everywhere, relabeled per vertical — see
// ROLE_LABELS_BY_VERTICAL in config.js for the shared definition.

// Which nav item(s) a vertical gets for its root entity, and where they
// point. Construction and Projects currently share the same /projects
// route (both verticals' root entity is a projects table row — see the
// design doc's Section 1 note that Projects reuses Project as-is);
// Facilities uses its own /properties + /vendors, per Phase 6.
function NavForVertical({ vertical }) {
  if (vertical === "facilities") {
    return (
      <>
        <NavLink to="/properties" className={({ isActive }) => (isActive ? "active" : "")}>Properties</NavLink>
        <NavLink to="/vendors" className={({ isActive }) => (isActive ? "active" : "")}>Vendors</NavLink>
      </>
    );
  }
  // construction and projects both land here today.
  return <NavLink to="/projects" className={({ isActive }) => (isActive ? "active" : "")}>Projects</NavLink>;
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const isInternal = user.role === "admin" || user.role === "staff";
  const isPlatformAdmin = !!user.isPlatformAdmin;
  const vertical = user.orgVertical || "construction";
  const roleLabels = ROLE_LABELS_BY_VERTICAL[vertical] || ROLE_LABELS_BY_VERTICAL.construction;

  return (
    <>
      <ImpersonationBanner />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <svg width="28" height="28" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="32" height="32" rx="3" stroke="#C9A227" strokeWidth="1.5" />
              <path d="M9 24L17 8L21 16H25L17 27L13 19H9" stroke="#3DBA6E" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div>
              <span className="name">{APP_NAME}</span>
              <span className="sub">{APP_TAGLINE}</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
            <NavForVertical vertical={vertical} />
            {isInternal && (
              <NavLink to="/users" className={({ isActive }) => (isActive ? "active" : "")}>
                Users
              </NavLink>
            )}
            {isPlatformAdmin && (
              <NavLink to="/platform" className={({ isActive }) => (isActive ? "active" : "")}>
                Organizations
              </NavLink>
            )}
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
              Settings
            </NavLink>
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-user">{user.fullName}</div>
            <div className="sidebar-role">{roleLabels[user.role] || user.role}</div>
            <button className="logout-btn" onClick={logout}>Log Out</button>
          </div>
        </aside>

        <main className="main-content">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.6rem" }}>
            <NotificationBell />
          </div>
          <Outlet />
        </main>
      </div>
    </>
  );
}
