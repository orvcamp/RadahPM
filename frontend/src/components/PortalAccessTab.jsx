// src/components/PortalAccessTab.jsx
//
// MangoDoe Facilities — staff-facing management of who has Property Owner
// Portal access to this property. Modeled directly on
// VendorContractsTab.jsx's list + "New X" modal shape.
//
// Granting access find-or-creates a portal_accounts row server-side (see
// backend/routes/portalAccess.js) — if the email is brand new, the
// response includes a one-time temp password that's shown once, here,
// and never again. There's no email-delivery step yet (see the backend
// deploy notes' "no forgot-password flow" gap) — staff hand this to the
// owner directly out of band.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

function GrantAccessModal({ propertyId, onClose, onGranted }) {
  const [form, setForm] = useState({ email: "", fullName: "", phone: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // holds { grant, tempPassword } after a successful grant

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.fullName.trim()) {
      return setError("Email and full name are required.");
    }
    setSaving(true);
    try {
      const data = await api.post(`/properties/${propertyId}/portal-access`, form);
      setResult(data);
      onGranted(data.grant);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // After a successful grant, swap the form for a one-time credentials
  // display instead of just closing — the temp password can't be
  // retrieved again once this modal closes.
  if (result) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Access Granted</h3>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          {result.tempPassword ? (
            <>
              <p className="text-sm" style={{ marginBottom: "0.8rem" }}>
                A new portal account was created for <strong>{result.grant.email}</strong>. Share this temporary
                password with them directly — it won't be shown again.
              </p>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--paper, #f7f6f2)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "0.8rem 1rem",
                  fontSize: "1rem",
                  marginBottom: "1rem",
                  wordBreak: "break-all",
                }}
              >
                {result.tempPassword}
              </div>
              <p className="text-sm text-steel">
                Portal login: <strong>{result.grant.email}</strong> at your portal sign-in page.
              </p>
            </>
          ) : (
            <p className="text-sm">
              <strong>{result.grant.email}</strong> already had a portal account — this property was just added to
              their existing access. No new password to share.
            </p>
          )}
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "1rem" }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Grant Portal Access</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Owner Email *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="owner@example.com"
            />
          </div>
          <div className="field">
            <label>Full Name *</label>
            <input required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>
            If this email already has portal access to another property, this just adds this property to their
            existing login — they won't get a second account.
          </p>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Granting..." : "Grant Access"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PortalAccessTab({ propertyId }) {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  function load() {
    setLoading(true);
    api
      .get(`/properties/${propertyId}/portal-access`)
      .then((data) => setGrants(data.grants))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, [propertyId]);

  async function revoke(grant) {
    if (!confirm(`Revoke ${grant.fullName}'s portal access to this property?`)) return;
    try {
      await api.delete(`/portal-access/${grant.id}`);
      setGrants((prev) => prev.filter((g) => g.id !== grant.id));
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span />
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ Grant Access</button>
        </div>
      )}

      {grants.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No portal access granted yet</h3>
            <p className="text-sm">Give the property owner a login to view documents, service history, and warranty status.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Granted</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td><strong>{g.fullName}</strong></td>
                  <td>{g.email}</td>
                  <td>{g.phone || "—"}</td>
                  <td>{fmtDate(g.createdAt)}</td>
                  {canManage && (
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => revoke(g)}>Revoke</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <GrantAccessModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onGranted={(grant) => setGrants((prev) => [grant, ...prev])}
        />
      )}
    </div>
  );
}
