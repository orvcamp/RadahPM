// src/components/DashboardLayout.jsx

import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { APP_NAME, APP_TAGLINE } from "../config.js";
import NotificationBell from "./NotificationBell.jsx";
import ImpersonationBanner from "./ImpersonationBanner.jsx";

const ROLE_LABELS = {
  admin: "Administrator",
  staff: "RADAH Staff",
  client: "Client / Owner",
  trade_partner: "Trade Partner",
};
// Same 4-tier role shape, relabeled per vertical (design doc Section 2) —
// the stored role value never changes, just what it's called on screen.
const ROLE_LABELS_FACILITIES = {
  admin: "Administrator",
  staff: "Facilities Staff",
  client: "Tenant",
  trade_partner: "Vendor",
};

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const isInternal = user.role === "admin" || user.role === "staff";
  const isPlatformAdmin = !!user.isPlatformAdmin;
  const isFacilities = user.orgVertical === "facilities";

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
          {isFacilities ? (
            <>
              <NavLink to="/properties" className={({ isActive }) => (isActive ? "active" : "")}>
                Properties
              </NavLink>
              <NavLink to="/vendors" className={({ isActive }) => (isActive ? "active" : "")}>
                Vendors
              </NavLink>
            </>
          ) : (
            <NavLink to="/projects" className={({ isActive }) => (isActive ? "active" : "")}>
              Projects
            </NavLink>
          )}
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
          <div className="sidebar-role">{(isFacilities ? ROLE_LABELS_FACILITIES : ROLE_LABELS)[user.role] || user.role}</div>
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
