// src/pages/VendorsPage.jsx
//
// MangoDoe Facilities — org-wide Vendor directory. Vendors are org-scoped
// (a vendor can serve more than one property), so this is a top-level page,
// not nested under a property — matching the backend's design.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : "—"; }
function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const days = (new Date(dateStr) - new Date()) / 86400000;
  return days >= 0 && days <= 60;
}
function isExpired(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function VendorModal({ vendor, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: vendor?.name || "",
    trade: vendor?.trade || "",
    contactName: vendor?.contactName || "",
    phone: vendor?.phone || "",
    email: vendor?.email || "",
    insuranceExpiresAt: vendor?.insuranceExpiresAt ? vendor.insuranceExpiresAt.slice(0, 10) : "",
    notes: vendor?.notes || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Vendor name is required.");
    setSaving(true);
    try {
      const data = vendor ? await api.patch(`/vendors/${vendor.id}`, form) : await api.post("/vendors", form);
      onSaved(data.vendor);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{vendor ? "Edit Vendor" : "New Vendor"}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label>Vendor Name *</label><input required value={form.name} onChange={(e) => update("name", e.target.value)} /></div>
            <div className="field"><label>Trade</label><input value={form.trade} onChange={(e) => update("trade", e.target.value)} placeholder="e.g. HVAC, Electrical, Landscaping" /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Contact Name</label><input value={form.contactName} onChange={(e) => update("contactName", e.target.value)} /></div>
            <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => update("phone", e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} /></div>
            <div className="field"><label>Insurance Expires</label><input type="date" value={form.insuranceExpiresAt} onChange={(e) => update("insuranceExpiresAt", e.target.value)} /></div>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Saving..." : vendor ? "Save Changes" : "Add Vendor"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function VendorsPage() {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalVendor, setModalVendor] = useState(undefined);

  function load() {
    setLoading(true);
    api.get("/vendors")
      .then((d) => setVendors(d.vendors))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function removeVendor(vendor) {
    if (!confirm(`Remove "${vendor.name}"? Existing contracts referencing them will remain, but you won't be able to link them to new ones.`)) return;
    try {
      await api.delete(`/vendors/${vendor.id}`);
      setVendors((prev) => prev.filter((v) => v.id !== vendor.id));
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Vendors</h1>
          <p>Your organization's vendor directory — link a vendor to a property's contracts from the property's Vendor Contracts tab.</p>
        </div>
        {canManage && <button className="btn btn-gold" onClick={() => setModalVendor(null)}>+ New Vendor</button>}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {loading ? (
        <div className="loading-spinner" />
      ) : vendors.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No vendors yet</h3><p className="text-sm">Add a vendor to start linking service contracts to properties.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Vendor</th><th>Trade</th><th>Contact</th><th>Insurance</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td><strong>{v.name}</strong></td>
                  <td>{v.trade || "—"}</td>
                  <td>
                    {v.contactName || "—"}
                    {(v.phone || v.email) && <div className="text-sm text-steel">{[v.phone, v.email].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td>
                    {fmtDate(v.insuranceExpiresAt)}
                    {isExpired(v.insuranceExpiresAt) && <span className="badge badge-cancelled" style={{ marginLeft: 6 }}>expired</span>}
                    {!isExpired(v.insuranceExpiresAt) && isExpiringSoon(v.insuranceExpiresAt) && <span className="badge badge-on_hold" style={{ marginLeft: 6 }}>expiring soon</span>}
                  </td>
                  {canManage && (
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button className="btn btn-outline btn-sm" onClick={() => setModalVendor(v)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeVendor(v)}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalVendor !== undefined && (
        <VendorModal
          vendor={modalVendor}
          onClose={() => setModalVendor(undefined)}
          onSaved={(saved) => {
            setModalVendor(undefined);
            setVendors((prev) => {
              const exists = prev.some((v) => v.id === saved.id);
              return exists ? prev.map((v) => (v.id === saved.id ? saved : v)) : [saved, ...prev];
            });
          }}
        />
      )}
    </div>
  );
}
