// src/pages/RegisterPage.jsx
//
// Self-registration is disabled under multi-tenancy — accounts are created
// inside an organization by an admin. This page now just explains that and
// points back to sign-in.

import { Link } from "react-router-dom";

export default function RegisterPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Invitation Required</h1>
        <p className="auth-subtitle">
          Accounts on this platform are created by your organization's administrator.
          If you need access, please reach out to them for an invitation.
        </p>
        <p className="auth-switch" style={{ marginTop: "1.2rem" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
