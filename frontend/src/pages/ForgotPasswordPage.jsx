// src/pages/ForgotPasswordPage.jsx

import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { APP_NAME } from "../config.js";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
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

        <h2>Reset Password</h2>

        {sent ? (
          <>
            <div className="success-msg">
              If an account exists for that email, a password reset link has been sent. Check your inbox
              (and spam). The link expires in 1 hour.
            </div>
            <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
          </>
        ) : (
          <>
            <p className="subtitle">Enter your email and we'll send you a link to set a new password.</p>
            {error && <div className="error-msg">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
                {submitting ? "Sending..." : "Send Reset Link"}
              </button>
            </form>
            <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
