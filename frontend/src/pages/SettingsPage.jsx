// src/pages/SettingsPage.jsx

import { useState } from "react";
import { api, setToken } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function SettingsPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const data = await api.post("/auth/change-password", { currentPassword, newPassword });
      // The server revokes all existing tokens and issues a fresh one for this
      // session, so we keep the user signed in here while signing out elsewhere.
      if (data && data.token) setToken(data.token);
      setSuccess(data?.message || "Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Manage your account.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 480, marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase", marginBottom: "1rem" }}>Profile</h3>
        <div className="field">
          <label>Full Name</label>
          <input value={user.fullName} disabled />
        </div>
        <div className="field">
          <label>Email</label>
          <input value={user.email} disabled />
        </div>
        <div className="field">
          <label>Role</label>
          <input value={user.role.replace("_", " ")} disabled />
        </div>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase", marginBottom: "1rem" }}>Change Password</h3>
        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Current Password</label>
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>New Password</label>
            <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
