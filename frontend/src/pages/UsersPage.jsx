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
              {result.inviteEmailSent
                ? " An invite email with a set-password link was sent to them."
                : " No invite email was sent."}
            </div>
            {!result.inviteEmailSent && result.inviteEmailError && (
              <div className="error-msg">Invite email failed: {result.inviteEmailError}</div>
            )}
            <div className="card">
              <p className="text-sm">
                {result.inviteEmailSent
                  ? "Fallback only — if they don't receive the email, share this temporary password securely. It won't be shown again:"
                  : "Share this temporary password with them through a secure channel — it won't be shown again:"}
              </p>
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

function DeleteUserModal({ user, onClose, onDeleted }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get(`/users/${user.id}/deletion-preview`)
      .then((d) => setPreview(d))
      .catch((err) => setError(err.message));
  }, [user.id]);

  const counts = preview ? Object.entries(preview.willPermanentlyDelete).filter(([, n]) => n > 0) : [];
  const canDelete = confirmText.trim().toLowerCase() === user.fullName.toLowerCase();

  async function handleDelete() {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/users/${user.id}`);
      onDeleted(user.id);
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase", color: "var(--red, #B23B3B)" }}>Permanently Delete User</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {!preview ? (
          <div className="loading-spinner" />
        ) : (
          <>
            <p className="text-sm" style={{ marginBottom: "0.8rem" }}>
              This cannot be undone. <strong>{user.fullName}</strong> ({user.email}) will be permanently removed.
            </p>
            {counts.length > 0 ? (
              <div className="error-msg" style={{ marginBottom: "1rem" }}>
                <strong>This will also permanently delete:</strong>
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
                  {counts.map(([key, n]) => (
                    <li key={key}>{n} {key.replace(/([A-Z])/g, " $1").toLowerCase()}</li>
                  ))}
                </ul>
                <p style={{ marginTop: "0.5rem" }}>
                  If you want to keep this history, use <strong>Remove (free email)</strong> instead — it deactivates the account without deleting anything they created.
                </p>
              </div>
            ) : (
              <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>
                They have no time entries, approvals, comments, or project memberships on record — nothing else will be affected.
              </p>
            )}
            <div className="field">
              <label>Type <strong>{user.fullName}</strong> to confirm</label>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
            <button
              className="btn btn-danger"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={!canDelete || deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting..." : "Permanently Delete"}
            </button>
          </>
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
  const [deleteTarget, setDeleteTarget] = useState(null);

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

  async function removeUser(u) {
    if (!confirm(`Remove ${u.fullName} and free up "${u.email}" for reuse? Their history (time entries, approvals, etc.) is kept — only their account access and email change.`)) return;
    try {
      const data = await api.post(`/users/${u.id}/remove`, {});
      setUsers((prev) => prev.map((x) => (x.id === u.id ? data.user : x)));
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
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(u)}>
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => resetPassword(u)}>
                        Reset Password
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => removeUser(u)}>
                        Remove (free email)
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(u)}>
                        Delete Permanently
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

      {deleteTarget && (
        <DeleteUserModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id) => {
            setDeleteTarget(null);
            setUsers((prev) => prev.filter((u) => u.id !== id));
          }}
        />
      )}
    </div>
  );
}
