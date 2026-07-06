// src/components/ChangeOrdersTab.jsx
//
// Per-project change orders: draft -> submitted -> approved/rejected.
// admin/staff manage everything; clients (project members) can approve or
// reject SUBMITTED change orders. Approving creates a budget line in the
// Budget tab (visible there). trade_partner never sees this tab.

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtSigned(cents) {
  const n = Number(cents) || 0;
  const abs = Math.abs(n) / 100;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "+$") + s;
}
function parseSignedCents(str) {
  const t = String(str).trim();
  const neg = t.startsWith("-");
  const cleaned = t.replace(/[^0-9.]/g, "");
  if (cleaned === "") return 0;
  const n = Math.round(parseFloat(cleaned) * 100);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}
function centsToInput(cents) {
  const n = Number(cents) || 0;
  return (n < 0 ? "-" : "") + (Math.abs(n) / 100).toFixed(2);
}

const STATUS_BADGE = {
  draft: "badge-not_started",
  submitted: "badge-in_progress",
  approved: "badge-active",
  rejected: "badge-cancelled",
};

const inputStyle = {
  width: "100%",
  border: "1.5px solid var(--line)",
  borderRadius: "6px",
  padding: "0.55rem 0.8rem",
  fontSize: "0.88rem",
};
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

// ---------- create / edit modal ----------
function ChangeOrderModal({ projectId, categories, changeOrder, onClose, onSaved }) {
  const isEdit = Boolean(changeOrder);
  const lockedMoney = isEdit && changeOrder.status === "approved";
  const [form, setForm] = useState({
    title: changeOrder?.title || "",
    description: changeOrder?.description || "",
    costImpact: changeOrder ? centsToInput(changeOrder.costImpactCents) : "",
    categoryId: changeOrder?.categoryId || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Please enter a title.");
    if (!form.categoryId) return setError("Please choose a target budget category.");
    const cents = parseSignedCents(form.costImpact || "0");
    if (Number.isNaN(cents)) return setError("Enter a valid cost impact (use a leading “-” for a credit).");
    setSaving(true);
    try {
      if (isEdit) {
        const payload = { title: form.title.trim(), description: form.description.trim() || null };
        if (!lockedMoney) {
          payload.costImpactCents = cents;
          payload.categoryId = form.categoryId;
        }
        await api.patch(`/change-orders/${changeOrder.id}`, payload);
      } else {
        await api.post(`/projects/${projectId}/change-orders`, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          costImpactCents: cents,
          categoryId: form.categoryId,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? `Edit CO #${changeOrder.coNumber}` : "New Change Order"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Title</label>
            <input autoFocus value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} placeholder="e.g. Added RFID readers at dock 4" />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="Scope of the change, reason, references..." />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1.2rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Cost Impact ($)</label>
              <input value={form.costImpact} disabled={lockedMoney} onChange={(e) => setForm((f) => ({ ...f, costImpact: e.target.value }))} style={{ ...inputStyle, background: lockedMoney ? "rgba(0,0,0,0.04)" : "white" }} placeholder="0.00 (use - for a credit)" inputMode="text" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Target Category</label>
              <select value={form.categoryId} disabled={lockedMoney} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} style={{ ...inputStyle, background: lockedMoney ? "rgba(0,0,0,0.04)" : "white" }}>
                <option value="">Select...</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          {lockedMoney && <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>This change order is approved. Revert it to Submitted to change the amount or category.</p>}
          {categories.length === 0 && <p className="text-sm" style={{ color: "var(--red)", marginBottom: "1rem" }}>This project has no budget categories yet. Set up the Budget tab first so change orders have a category to target.</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving || categories.length === 0}>{saving ? "Saving..." : isEdit ? "Save" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- attachments modal ----------
function AttachmentsModal({ projectId, changeOrder, canAttach, onClose, onChanged }) {
  const fileRef = useRef(null);
  const [attachments, setAttachments] = useState(changeOrder.attachments || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function download(a) {
    try {
      const { downloadUrl } = await api.get(`/documents/${a.documentId}/download-url`);
      window.open(downloadUrl, "_blank");
    } catch (err) { alert(err.message); }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setError("");
    setUploading(true);
    try {
      const ct = file.type || "application/octet-stream";
      const { uploadUrl, storageKey } = await api.post(
        `/projects/${projectId}/change-orders/${changeOrder.id}/attachments/upload-url`,
        { fileName: file.name, contentType: ct }
      );
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
      if (!put.ok) throw new Error("Upload to storage failed.");
      const { attachment } = await api.post(
        `/projects/${projectId}/change-orders/${changeOrder.id}/attachments/confirm`,
        { storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size }
      );
      setAttachments((prev) => [...prev, attachment]);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(a) {
    if (!confirm(`Remove "${a.fileName}"?`)) return;
    try {
      await api.delete(`/change-order-documents/${a.id}`);
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
      onChanged && onChanged();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>CO #{changeOrder.coNumber} — Attachments</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {attachments.length === 0 ? (
          <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>No attachments yet.</p>
        ) : (
          <div style={{ marginBottom: "1rem" }}>
            {attachments.map((a) => (
              <div key={a.id} className="flex-between" style={{ padding: "0.45rem 0", borderBottom: "1px solid var(--line)", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.86rem" }}>{a.fileName}</span>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn btn-outline btn-sm" onClick={() => download(a)}>Download</button>
                  {a.canDelete && <button className="btn btn-danger btn-sm" onClick={() => remove(a)}>×</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {canAttach && (
          <>
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onFile} />
            <button className="btn btn-outline btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : "+ Add File"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ChangeOrdersTab({ projectId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // null | {} | changeOrder
  const [attachModal, setAttachModal] = useState(null); // null | changeOrder
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/projects/${projectId}/change-orders`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function transition(co, action, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(co.id);
    try {
      await api.post(`/change-orders/${co.id}/transition`, { action });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(co) {
    if (!confirm(`Delete CO #${co.coNumber}? ${co.status === "approved" ? "Its budget line will remain for history." : ""}`)) return;
    setBusyId(co.id);
    try {
      await api.delete(`/change-orders/${co.id}`);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { canManage, categories, changeOrders, canAttach } = data;
  const isClient = user.role === "client";

  return (
    <div>
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span className="text-sm text-steel">Approving a change order adds its cost impact to the Budget tab as a new line.</span>
          <button className="btn btn-gold" onClick={() => setModal({})}>+ New Change Order</button>
        </div>
      )}

      {changeOrders.length === 0 ? (
        <div className="card"><div className="empty-state">
          <h3>No change orders yet</h3>
          <p className="text-sm">{canManage ? "Create one to track a scope or cost change." : "There are no change orders for this project yet."}</p>
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>CO #</th>
                <th>Title</th>
                <th>Category</th>
                <th style={{ textAlign: "right" }}>Cost Impact</th>
                <th>Status</th>
                <th>Decision</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {changeOrders.map((co) => {
                const busy = busyId === co.id;
                const canDecide = co.status === "submitted" && (canManage || isClient);
                return (
                  <tr key={co.id}>
                    <td><strong>#{co.coNumber}</strong></td>
                    <td>
                      <strong>{co.title}</strong>
                      {co.description && <div className="text-sm text-steel" style={{ maxWidth: 320 }}>{co.description}</div>}
                    </td>
                    <td>{co.categoryName || "—"}</td>
                    <td style={{ textAlign: "right", color: co.costImpactCents < 0 ? "var(--green-deep, #2E9E5B)" : "inherit", fontWeight: 600 }}>{fmtSigned(co.costImpactCents)}</td>
                    <td><span className={`badge ${STATUS_BADGE[co.status] || ""}`}>{co.status}</span></td>
                    <td className="text-sm text-steel">
                      {co.status === "approved" && `Approved${co.decidedByName ? ` by ${co.decidedByName}` : ""}`}
                      {co.status === "rejected" && `Rejected${co.decidedByName ? ` by ${co.decidedByName}` : ""}`}
                      {co.status === "submitted" && `Submitted${co.submittedByName ? ` by ${co.submittedByName}` : ""}`}
                      {co.status === "draft" && "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setAttachModal(co)}>
                          📎 Files{co.attachments && co.attachments.length ? ` (${co.attachments.length})` : ""}
                        </button>
                        {canDecide && (
                          <>
                            <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => transition(co, "approve")}>Approve</button>
                            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => transition(co, "reject", `Reject CO #${co.coNumber}?`)}>Reject</button>
                          </>
                        )}
                        {canManage && co.status === "draft" && (
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition(co, "submit")}>Submit</button>
                        )}
                        {canManage && co.status === "approved" && (
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition(co, "revert", `Revert CO #${co.coNumber} to Submitted? Its budget line will be flagged and zeroed, not deleted.`)}>Revert</button>
                        )}
                        {canManage && co.status !== "rejected" && (
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setModal(co)}>Edit</button>
                        )}
                        {canManage && (
                          <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => remove(co)}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <ChangeOrderModal
          projectId={projectId}
          categories={categories}
          changeOrder={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {attachModal !== null && (
        <AttachmentsModal
          projectId={projectId}
          changeOrder={attachModal}
          canAttach={canAttach}
          onClose={() => setAttachModal(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}
