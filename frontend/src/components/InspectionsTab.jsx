// src/components/InspectionsTab.jsx
//
// MangoDoe Facilities — Inspections & Compliance for a Property.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : "—"; }

const RESULT_LABELS = { pass: "Pass", fail: "Fail", na: "N/A" };
const RESULT_COLORS = { pass: "#2E9E5B", fail: "#B23B3B", na: "#6b7280" };

function NewInspectionModal({ propertyId, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError("Title is required.");
    setSaving(true);
    try {
      const items = itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
      const data = await api.post(`/properties/${propertyId}/inspections`, { title, scheduledDate: scheduledDate || null, items });
      onCreated(data.inspection);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Inspection</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Title *</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Fire & Life Safety Inspection" />
          </div>
          <div className="field">
            <label>Scheduled Date</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Checklist Items (one per line)</label>
            <textarea rows={6} value={itemsText} onChange={(e) => setItemsText(e.target.value)} placeholder={"Fire extinguishers charged\nExit signs illuminated\nSprinkler heads unobstructed"} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Creating..." : "Create Inspection"}
          </button>
        </form>
      </div>
    </div>
  );
}

function InspectionDetailModal({ inspectionId, onClose, onStatusChanged, canManage }) {
  const [inspection, setInspection] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newItemText, setNewItemText] = useState("");

  function load() {
    setLoading(true);
    api.get(`/inspections/${inspectionId}`)
      .then((d) => { setInspection(d.inspection); setItems(d.items); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [inspectionId]);

  async function setResult(item, result) {
    try {
      const d = await api.patch(`/inspection-items/${item.id}`, { result });
      setItems((prev) => prev.map((it) => (it.id === item.id ? d.item : it)));
    } catch (err) { alert(err.message); }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItemText.trim()) return;
    try {
      const d = await api.post(`/inspections/${inspectionId}/items`, { description: newItemText.trim() });
      setItems((prev) => [...prev, d.item]);
      setNewItemText("");
    } catch (err) { alert(err.message); }
  }

  async function markComplete() {
    try {
      const d = await api.patch(`/inspections/${inspectionId}`, { status: "completed" });
      setInspection(d.inspection);
      onStatusChanged(d.inspection);
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Inspection</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {loading || !inspection ? <div className="loading-spinner" /> : (
          <>
            <div className="flex-between" style={{ marginBottom: "1rem" }}>
              <div>
                <p style={{ fontWeight: 700 }}>{inspection.title}</p>
                <p className="text-sm text-steel">Scheduled: {fmtDate(inspection.scheduledDate)}</p>
              </div>
              <span className={`badge badge-${inspection.status === "completed" ? "completed" : inspection.status === "cancelled" ? "cancelled" : "active"}`}>{inspection.status.replace("_", " ")}</span>
            </div>

            <div className="card" style={{ padding: 0, marginBottom: "1rem", maxHeight: 320, overflowY: "auto" }}>
              <table className="data-table">
                <thead><tr><th>Item</th><th>Result</th><th>Notes</th></tr></thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.description}</td>
                      <td>
                        {canManage ? (
                          <select value={it.result || ""} onChange={(e) => setResult(it, e.target.value || null)} style={{ border: "1px solid var(--line)", borderRadius: 4, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}>
                            <option value="">—</option>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                            <option value="na">N/A</option>
                          </select>
                        ) : it.result ? (
                          <span style={{ color: RESULT_COLORS[it.result], fontWeight: 600 }}>{RESULT_LABELS[it.result]}</span>
                        ) : "—"}
                      </td>
                      <td className="text-sm text-steel">{it.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canManage && (
              <>
                <form onSubmit={addItem} style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem" }}>
                  <input
                    placeholder="Add a checklist item…"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.5rem 0.7rem", fontSize: "0.85rem" }}
                  />
                  <button className="btn btn-outline btn-sm">+ Add</button>
                </form>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
                  {inspection.status !== "completed" && (
                    <button className="btn btn-gold" onClick={markComplete}>Mark Completed</button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function InspectionsTab({ propertyId }) {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState(null);

  function load() {
    setLoading(true);
    api.get(`/properties/${propertyId}/inspections`)
      .then((d) => setInspections(d.inspections))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [propertyId]);

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span />
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New Inspection</button>
        </div>
      )}

      {inspections.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No inspections yet</h3><p className="text-sm">Set up a checklist-based inspection — fire/life-safety, ADA, health code — to track pass/fail results over time.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Title</th><th>Scheduled</th><th>Status</th></tr></thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setDetailId(i.id)}>
                  <td><strong>{i.title}</strong></td>
                  <td>{fmtDate(i.scheduledDate)}</td>
                  <td><span className={`badge badge-${i.status === "completed" ? "completed" : i.status === "cancelled" ? "cancelled" : "active"}`}>{i.status.replace("_", " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewInspectionModal
          propertyId={propertyId}
          onClose={() => setShowNew(false)}
          onCreated={(insp) => { setShowNew(false); setInspections((prev) => [insp, ...prev]); }}
        />
      )}
      {detailId && (
        <InspectionDetailModal
          inspectionId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onStatusChanged={(updated) => setInspections((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
        />
      )}
    </div>
  );
}
