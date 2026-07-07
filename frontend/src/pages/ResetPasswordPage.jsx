// src/pages/ResetPasswordPage.jsx

import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { APP_NAME } from "../config.js";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) return setError("Password must be at least 8 characters.");
    if (newPassword !== confirm) return setError("Passwords don't match.");
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="30" height="30" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="32" height="32" rx="3" stroke="#C9A227" strokeWidth="1.5" />
            <path d="M9 24L17 8L21 16H25L17 27L13 19H9" stroke="#3DBA6E" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span className="name">{APP_NAME}</span>
        </div>

        <h2>Set a New Password</h2>

        {!token ? (
          <>
            <div className="error-msg">This reset link is missing its token. Please use the link from your email, or request a new one.</div>
            <p className="auth-switch"><Link to="/forgot-password">Request a new link</Link></p>
          </>
        ) : done ? (
          <>
            <div className="success-msg">Your password has been reset. Redirecting you to sign in…</div>
            <p className="auth-switch"><Link to="/login">Go to sign in</Link></p>
          </>
        ) : (
          <>
            <p className="subtitle">Choose a new password for your account.</p>
            {error && <div className="error-msg">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="newPassword">New password</label>
                <input id="newPassword" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirm new password</label>
                <input id="confirm" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
                {submitting ? "Saving..." : "Reset Password"}
              </button>
            </form>
            <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
