// src/components/VendorContractsTab.jsx
//
// MangoDoe Facilities — Vendor Contracts for a Property. Vendors themselves
// are managed org-wide on the Vendors page; this tab links an existing
// vendor to this property with a contract.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : "—"; }
function fmtMoney(cents) {
  if (cents === null || cents === undefined) return "—";
  return "$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
}
function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const days = (new Date(dateStr) - new Date()) / 86400000;
  return days >= 0 && days <= 60;
}
function isExpired(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function NewContractModal({ propertyId, vendors, onClose, onCreated }) {
  const [form, setForm] = useState({ vendorId: "", title: "", startDate: "", endDate: "", valueCents: "", renewalReminderDays: "30" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.vendorId) return setError("Choose a vendor.");
    if (!form.title.trim()) return setError("Title is required.");
    setSaving(true);
    try {
      const data = await api.post(`/properties/${propertyId}/vendor-contracts`, {
        ...form,
        valueCents: form.valueCents ? Math.round(parseFloat(form.valueCents) * 100) : null,
        renewalReminderDays: form.renewalReminderDays ? Number(form.renewalReminderDays) : null,
      });
      onCreated(data.contract);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Vendor Contract</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {vendors.length === 0 ? (
          <div className="text-sm text-steel" style={{ padding: "0.7rem 0.9rem", background: "var(--paper, #f7f6f2)", borderRadius: 6, border: "1px solid var(--line)" }}>
            No vendors yet. Add one on the <Link to="/vendors">Vendors</Link> page first.
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label>Vendor *</label>
              <select required value={form.vendorId} onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}>
                <option value="">Select a vendor...</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.trade ? ` — ${v.trade}` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Contract Title *</label>
              <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Annual HVAC Service Agreement" />
            </div>
            <div className="form-grid">
              <div className="field"><label>Start Date</label><input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="field"><label>End Date</label><input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="form-grid">
              <div className="field"><label>Contract Value ($)</label><input value={form.valueCents} onChange={(e) => setForm((f) => ({ ...f, valueCents: e.target.value }))} placeholder="0.00" /></div>
              <div className="field"><label>Renewal Reminder (days before)</label><input type="number" min="0" value={form.renewalReminderDays} onChange={(e) => setForm((f) => ({ ...f, renewalReminderDays: e.target.value }))} /></div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
              {saving ? "Saving..." : "Add Contract"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function VendorContractsTab({ propertyId }) {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [contracts, setContracts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/properties/${propertyId}/vendor-contracts`),
      api.get("/vendors"),
    ])
      .then(([c, v]) => { setContracts(c.contracts); setVendors(v.vendors); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [propertyId]);

  async function removeContract(contract) {
    if (!confirm(`Remove "${contract.title}"?`)) return;
    try {
      await api.delete(`/vendor-contracts/${contract.id}`);
      setContracts((prev) => prev.filter((c) => c.id !== contract.id));
    } catch (err) {
      alert(err.message);
    }
  }

  function vendorName(id) {
    const v = vendors.find((v) => v.id === id);
    return v ? v.name : "—";
  }

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span />
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New Contract</button>
        </div>
      )}

      {contracts.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No vendor contracts yet</h3><p className="text-sm">Link a vendor from your org's directory to this property with a service contract.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Vendor</th><th>Contract</th><th>Term</th><th>Value</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><strong>{vendorName(c.vendorId)}</strong></td>
                  <td>{c.title}</td>
                  <td>
                    {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                    {isExpired(c.endDate) && <span className="badge badge-cancelled" style={{ marginLeft: 6 }}>expired</span>}
                    {!isExpired(c.endDate) && isExpiringSoon(c.endDate) && <span className="badge badge-on_hold" style={{ marginLeft: 6 }}>renewing soon</span>}
                  </td>
                  <td>{fmtMoney(c.valueCents)}</td>
                  {canManage && <td><button className="btn btn-danger btn-sm" onClick={() => removeContract(c)}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewContractModal
          propertyId={propertyId}
          vendors={vendors}
          onClose={() => setShowNew(false)}
          onCreated={(c) => { setShowNew(false); setContracts((prev) => [c, ...prev]); }}
        />
      )}
    </div>
  );
}
