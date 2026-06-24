// src/pages/UsersPage.jsx

import { useEffect, useState } from "react";
import { api } from "../api/client";

const ROLES = ["admin", "staff", "client", "trade_partner"];

function NewUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ fullName: "", email: "", role: "client", companyName: "", phone: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await api.post("/users", form);
      setResult(data);
      onCreated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Add User</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {result ? (
          <div>
            <div className="success-msg">
              Account created for <strong>{result.user.fullName}</strong>.
            </div>
            <div className="card">
              <p className="text-sm">Share this temporary password with them through a secure channel — it won't be shown again:</p>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", marginTop: "0.6rem", background: "var(--off-white)", padding: "0.6rem", borderRadius: "4px" }}>
                {result.temporaryPassword}
              </p>
            </div>
            <button className="btn btn-primary mt-2" style={{ width: "100%", justifyContent: "center" }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="error-msg">{error}</div>}
            <div className="field">
              <label>Full Name *</label>
              <input required value={form.fullName} onChange={(e) => update("fullName", e.target.value)} />
            </div>
            <div className="field">
              <label>Email *</label>
              <input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} />
            </div>
            <div className="field">
              <label>Role *</label>
              <select value={form.role} onChange={(e) => update("role", e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Company Name</label>
                <input value={form.companyName} onChange={(e) => update("companyName", e.target.value)} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
              {submitting ? "Creating..." : "Create Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [resetInfo, setResetInfo] = useState(null);

  function load() {
    setLoading(true);
    api.get("/users").then((d) => setUsers(d.users)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(u) {
    try {
      const path = u.isActive ? `/users/${u.id}/deactivate` : `/users/${u.id}/reactivate`;
      const data = await api.patch(path);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? data.user : x)));
    } catch (err) {
      alert(err.message);
    }
  }

  async function resetPassword(u) {
    if (!confirm(`Generate a new temporary password for ${u.fullName}? Their current password will stop working immediately.`)) return;
    try {
      const data = await api.post(`/users/${u.id}/reset-password`, {});
      setResetInfo({ user: u, password: data.temporaryPassword });
    } catch (err) {
      alert(err.message);
    }
  }

  const filtered = roleFilter === "all" ? users : users.filter((u) => u.role === roleFilter);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>Manage staff, client, and trade partner accounts.</p>
        </div>
        <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ Add User</button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="tab-row">
        <button className={`tab-btn ${roleFilter === "all" ? "active" : ""}`} onClick={() => setRoleFilter("all")}>All</button>
        {ROLES.map((r) => (
          <button key={r} className={`tab-btn ${roleFilter === r ? "active" : ""}`} onClick={() => setRoleFilter(r)}>
            {r.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-spinner" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.fullName}</strong></td>
                  <td>{u.email}</td>
                  <td><span className="role-badge">{u.role.replace("_", " ")}</span></td>
                  <td>{u.companyName || "—"}</td>
                  <td>{u.isActive ? <span className="badge badge-active">active</span> : <span className="badge badge-cancelled">inactive</span>}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(u)}>
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => resetPassword(u)}>
                        Reset Password
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewUserModal
          onClose={() => setShowNew(false)}
          onCreated={(user) => setUsers((prev) => [user, ...prev])}
        />
      )}

      {resetInfo && (
        <div className="modal-backdrop" onClick={() => setResetInfo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Password Reset</h3>
              <button className="modal-close" onClick={() => setResetInfo(null)}>&times;</button>
            </div>
            <div className="success-msg">
              New temporary password generated for <strong>{resetInfo.user.fullName}</strong>.
            </div>
            <div className="card">
              <p className="text-sm">Share this with them through a secure channel — it won't be shown again:</p>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", marginTop: "0.6rem", background: "var(--off-white)", padding: "0.6rem", borderRadius: "4px" }}>
                {resetInfo.password}
              </p>
            </div>
            <button className="btn btn-primary mt-2" style={{ width: "100%", justifyContent: "center" }} onClick={() => setResetInfo(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
