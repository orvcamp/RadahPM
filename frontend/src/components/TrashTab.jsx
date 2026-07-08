// src/components/TrashTab.jsx
//
// Deleted Items ("recycle bin") for a project — admin only.
// Deleting a document, daily log, RFI, submittal, or change order moves it
// here instead of destroying it. Restore puts it back. Permanent delete is the
// only irreversible action.

import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";

export default function TrashTab({ projectId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/projects/${projectId}/trash`);
      setItems(d.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function restore(item) {
    setBusyId(item.id); setNotice("");
    try {
      const r = await api.post(`/trash/${item.type}/${item.id}/restore`, {});
      setNotice(r.message);
      await load();
    } catch (err) { alert(err.message); } finally { setBusyId(null); }
  }

  async function purge(item) {
    if (!confirm(`Permanently delete "${item.title}"?\n\nThis CANNOT be undone. The record — and for documents the stored file — will be destroyed.`)) return;
    setBusyId(item.id); setNotice("");
    try {
      const r = await api.delete(`/trash/${item.type}/${item.id}`);
      setNotice(r.message);
      await load();
    } catch (err) { alert(err.message); } finally { setBusyId(null); }
  }

  if (loading) return <div className="loading-spinner" />;

  return (
    <div className="card">
      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Deleted Items</h3>
        <p className="text-sm text-steel" style={{ marginTop: 2 }}>
          Deleted documents, daily logs, RFIs, submittals, and change orders land here instead of being destroyed.
          Restore puts an item back. Permanent delete cannot be undone.
        </p>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {notice && <div className="success-msg">{notice}</div>}

      {items.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing deleted</h3>
          <p className="text-sm">Deleted records will appear here so you can restore them.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Type</th><th>Item</th><th>Deleted By</th><th>Deleted</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const busy = busyId === item.id;
              return (
                <tr key={`${item.type}-${item.id}`}>
                  <td><span className="badge badge-not_started">{item.typeLabel}</span></td>
                  <td><strong>{item.title}</strong></td>
                  <td>{item.deletedByName || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{item.deletedAt ? new Date(item.deletedAt).toLocaleString() : "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                      <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => restore(item)}>Restore</button>
                      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => purge(item)}>Delete Forever</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
