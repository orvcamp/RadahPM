// src/App.jsx

import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { usePortalAuth } from "./context/PortalAuthContext.jsx";

import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import DashboardLayout from "./components/DashboardLayout.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ProjectsPage from "./pages/ProjectsPage.jsx";
import ProjectDetailPage from "./pages/ProjectDetailPage.jsx";
import PropertiesPage from "./pages/PropertiesPage.jsx";
import PropertyDetailPage from "./pages/PropertyDetailPage.jsx";
import VendorsPage from "./pages/VendorsPage.jsx";
import ProtectPage from "./pages/ProtectPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import PlatformAdminPage from "./pages/PlatformAdminPage.jsx";
import PortalLoginPage from "./pages/PortalLoginPage.jsx";
import PortalLayout from "./components/PortalLayout.jsx";
import PortalDashboardPage from "./pages/PortalDashboardPage.jsx";
import PortalPropertyPage from "./pages/PortalPropertyPage.jsx";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-page">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// Same shape as ProtectedRoute, checking the separate portal session
// instead — a staff `user` being logged in doesn't grant portal access,
// and vice versa, since these are unrelated identities (see
// PortalAuthContext.jsx).
function PortalProtectedRoute({ children }) {
  const { account, loading } = usePortalAuth();

  if (loading) {
    return (
      <div className="center-page">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!account) {
    return <Navigate to="/portal/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/:id" element={<PropertyDetailPage />} />
        <Route path="vendors" element={<VendorsPage />} />
        <Route path="protect" element={<ProtectPage />} />
        <Route
          path="users"
          element={
            <ProtectedRoute roles={["admin", "staff"]}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="platform" element={<PlatformAdminPage />} />
      </Route>

      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route
        path="/portal"
        element={
          <PortalProtectedRoute>
            <PortalLayout />
          </PortalProtectedRoute>
        }
      >
        <Route index element={<PortalDashboardPage />} />
        <Route path="properties/:id" element={<PortalPropertyPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
