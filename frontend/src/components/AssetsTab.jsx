// src/components/AssetsTab.jsx
//
// MangoDoe Facilities — Assets (equipment registry) for a Property.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
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

function AssetModal({ propertyId, asset, onClose, onSaved }) {
  const [form, setForm] = useState({
    category: asset?.category || "",
    name: asset?.name || "",
    make: asset?.make || "",
    model: asset?.model || "",
    serialNumber: asset?.serialNumber || "",
    installDate: asset?.installDate ? asset.installDate.slice(0, 10) : "",
    warrantyExpiresAt: asset?.warrantyExpiresAt ? asset.warrantyExpiresAt.slice(0, 10) : "",
    locationDetail: asset?.locationDetail || "",
    notes: asset?.notes || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Asset name is required.");
    setSaving(true);
    try {
      const data = asset
        ? await api.patch(`/assets/${asset.id}`, form)
        : await api.post(`/properties/${propertyId}/assets`, form);
      onSaved(data.asset);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{asset ? "Edit Asset" : "New Asset"}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>Asset Name *</label>
              <input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Rooftop AHU-3" />
            </div>
            <div className="field">
              <label>Category</label>
              <input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="e.g. HVAC, Elevator, Generator" />
            </div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Make</label><input value={form.make} onChange={(e) => update("make", e.target.value)} /></div>
            <div className="field"><label>Model</label><input value={form.model} onChange={(e) => update("model", e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Serial Number</label><input value={form.serialNumber} onChange={(e) => update("serialNumber", e.target.value)} /></div>
            <div className="field"><label>Location</label><input value={form.locationDetail} onChange={(e) => update("locationDetail", e.target.value)} placeholder="e.g. Roof, Mechanical Room B" /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Install Date</label><input type="date" value={form.installDate} onChange={(e) => update("installDate", e.target.value)} /></div>
            <div className="field"><label>Warranty Expires</label><input type="date" value={form.warrantyExpiresAt} onChange={(e) => update("warrantyExpiresAt", e.target.value)} /></div>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Saving..." : asset ? "Save Changes" : "Add Asset"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AssetsTab({ propertyId }) {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalAsset, setModalAsset] = useState(undefined); // undefined = closed, null = new, object = edit

  function load() {
    setLoading(true);
    api.get(`/properties/${propertyId}/assets`)
      .then((d) => setAssets(d.assets))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [propertyId]);

  async function removeAsset(asset) {
    if (!confirm(`Remove "${asset.name}"?`)) return;
    try {
      await api.delete(`/assets/${asset.id}`);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
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
          <button className="btn btn-gold" onClick={() => setModalAsset(null)}>+ New Asset</button>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No assets yet</h3><p className="text-sm">Register equipment — HVAC units, elevators, generators — to track warranties and tie work orders and PM schedules to specific units.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Category</th>
                <th>Make / Model</th>
                <th>Location</th>
                <th>Warranty</th>
                <th>Status</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong>{a.serialNumber && <div className="text-sm text-steel">S/N {a.serialNumber}</div>}</td>
                  <td>{a.category || "—"}</td>
                  <td>{[a.make, a.model].filter(Boolean).join(" / ") || "—"}</td>
                  <td>{a.locationDetail || "—"}</td>
                  <td>
                    {fmtDate(a.warrantyExpiresAt)}
                    {isExpired(a.warrantyExpiresAt) && <span className="badge badge-cancelled" style={{ marginLeft: 6 }}>expired</span>}
                    {!isExpired(a.warrantyExpiresAt) && isExpiringSoon(a.warrantyExpiresAt) && <span className="badge badge-on_hold" style={{ marginLeft: 6 }}>expiring soon</span>}
                  </td>
                  <td><span className={`badge badge-${a.status === "active" ? "active" : a.status === "retired" ? "cancelled" : "on_hold"}`}>{a.status}</span></td>
                  {canManage && (
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button className="btn btn-outline btn-sm" onClick={() => setModalAsset(a)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeAsset(a)}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAsset !== undefined && (
        <AssetModal
          propertyId={propertyId}
          asset={modalAsset}
          onClose={() => setModalAsset(undefined)}
          onSaved={(saved) => {
            setModalAsset(undefined);
            setAssets((prev) => {
              const exists = prev.some((a) => a.id === saved.id);
              return exists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev];
            });
          }}
        />
      )}
    </div>
  );
}
