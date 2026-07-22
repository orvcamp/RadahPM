// src/components/WorkOrdersTab.jsx
//
// MangoDoe Facilities — Work Orders + Preventive Maintenance Schedules for
// a Property. Combined into one tab since they're tightly related (a PM
// schedule spawns a work order).

import { useEffect, useState, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

const PRIORITY_COLORS = { low: "#6b7280", normal: "#2E6F7E", high: "#C9A227", urgent: "#B23B3B" };
const STATUS_LABELS = { open: "Open", assigned: "Assigned", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" };

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : "—"; }

function NewWorkOrderModal({ propertyId, assets, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", assetId: "", priority: "normal", scheduledDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("A short title is required.");
    setSaving(true);
    try {
      const data = await api.post(`/properties/${propertyId}/work-orders`, { ...form, assetId: form.assetId || null });
      onCreated(data.workOrder);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Work Order</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Title *</label>
            <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. AC not cooling — 3rd floor" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Asset (optional)</label>
              <select value={form.assetId} onChange={(e) => setForm((f) => ({ ...f, assetId: e.target.value }))}>
                <option value="">Not tied to a specific asset</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Scheduled Date</label>
            <input type="date" value={form.scheduledDate} onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Submitting..." : "Submit Work Order"}
          </button>
        </form>
      </div>
    </div>
  );
}

function WorkOrderAttachments({ workOrderId }) {
  const [attachments, setAttachments] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    api
      .get(`/work-orders/${workOrderId}/attachments`)
      .then((data) => setAttachments(data.attachments))
      .catch((err) => setError(err.message || "Couldn't load attachments."));
  }, [workOrderId]);

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setError("");
    setUploading(true);
    try {
      setUploadProgress("Preparing upload...");
      const { uploadUrl, storageKey } = await api.post(`/work-orders/${workOrderId}/attachments/upload-url`, {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });
      setUploadProgress(`Uploading ${file.name}...`);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed. Please try again.");
      setUploadProgress("Finishing up...");
      const { attachment } = await api.post(`/work-orders/${workOrderId}/attachments/confirm`, {
        storageKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      setAttachments((prev) => [attachment, ...(prev || [])]);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={labelStyle}>Photos & Documents</label>
      {error && <div className="error-msg">{error}</div>}
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={handleFileSelected} />
      {attachments === null ? (
        <div className="loading-spinner" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.6rem" }}>
          {attachments.length === 0 && <p className="text-sm text-steel">No files attached yet.</p>}
          {attachments.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.45rem 0.6rem",
                border: "1px solid var(--line)",
                borderRadius: 6,
                fontSize: "0.85rem",
              }}
            >
              <span>
                {a.fileName}
                {a.uploadedByPortalAccount && <span className="badge badge-active" style={{ marginLeft: 6 }}>from owner</span>}
              </span>
              {a.downloadUrl && (
                <a className="btn btn-outline btn-sm" href={a.downloadUrl} target="_blank" rel="noreferrer">
                  View
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-outline btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? uploadProgress || "Uploading..." : "+ Add Photo or Document"}
      </button>
    </div>
  );
}

function WorkOrderDetailModal({ workOrder, assets, staff, vendors, onClose, onSaved, canManage }) {
  const [status, setStatus] = useState(workOrder.status);
  const [costCents, setCostCents] = useState((workOrder.costCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assignedTo, setAssignedTo] = useState(
    workOrder.assignedToUserId ? `user:${workOrder.assignedToUserId}` : workOrder.assignedToVendorId ? `vendor:${workOrder.assignedToVendorId}` : ""
  );

  async function save(patch) {
    setBusy(true);
    setError("");
    try {
      const data = await api.patch(`/work-orders/${workOrder.id}`, patch);
      onSaved(data.workOrder);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleAssignChange(e) {
    const val = e.target.value;
    setAssignedTo(val);
    const [type, id] = val ? val.split(":") : [null, null];
    save({
      assignedToUserId: type === "user" ? id : null,
      assignedToVendorId: type === "vendor" ? id : null,
    });
  }

  const asset = assets.find((a) => a.id === workOrder.assetId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Work Order</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <p style={{ fontWeight: 700, marginBottom: "0.2rem" }}>{workOrder.title}</p>
        {workOrder.description && <p className="text-sm text-steel" style={{ marginBottom: "0.8rem" }}>{workOrder.description}</p>}
        {asset && <p className="text-sm text-steel" style={{ marginBottom: "0.8rem" }}>Asset: <strong>{asset.name}</strong></p>}

        {canManage ? (
          <>
            <div className="form-grid" style={{ marginBottom: "1rem" }}>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={status} onChange={(e) => { setStatus(e.target.value); save({ status: e.target.value }); }} style={inputStyle}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Cost ($)</label>
                <input
                  value={costCents}
                  onChange={(e) => setCostCents(e.target.value)}
                  onBlur={() => save({ costCents: Math.round(parseFloat(costCents || "0") * 100) })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Assigned To</label>
                <select value={assignedTo} onChange={handleAssignChange} style={inputStyle}>
                  <optgroup label="Unassigned">
                    <option value="">Unassigned</option>
                  </optgroup>
                  <optgroup label="Staff">
                    {staff.map((s) => <option key={`user:${s.id}`} value={`user:${s.id}`}>{s.fullName}</option>)}
                  </optgroup>
                  <optgroup label="Vendors">
                    {vendors.map((v) => <option key={`vendor:${v.id}`} value={`vendor:${v.id}`}>{v.name}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm" style={{ marginBottom: "1rem" }}>Status: <span className={`badge badge-${workOrder.status === "completed" ? "completed" : workOrder.status === "cancelled" ? "cancelled" : "active"}`}>{STATUS_LABELS[status]}</span></p>
        )}

        <WorkOrderAttachments workOrderId={workOrder.id} />

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}

function NewPmScheduleModal({ propertyId, assets, staff, vendors, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", assetId: "", frequencyType: "calendar", intervalDays: "90", nextDueDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [defaultAssignedTo, setDefaultAssignedTo] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Title is required.");
    if (!form.nextDueDate) return setError("A next due date is required.");
    setSaving(true);
    try {
      const [assignType, assignId] = defaultAssignedTo ? defaultAssignedTo.split(":") : [null, null];
      const data = await api.post(`/properties/${propertyId}/pm-schedules`, {
        ...form,
        assetId: form.assetId || null,
        intervalDays: form.intervalDays ? Number(form.intervalDays) : null,
        defaultAssignedToUserId: assignType === "user" ? assignId : null,
        defaultAssignedToVendorId: assignType === "vendor" ? assignId : null,
      });
      onCreated(data.pmSchedule);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New PM Schedule</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Title *</label>
            <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Quarterly HVAC filter change" />
          </div>
          <div className="field">
            <label>Asset (optional)</label>
            <select value={form.assetId} onChange={(e) => setForm((f) => ({ ...f, assetId: e.target.value }))}>
              <option value="">Applies to the property generally</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Default Assigned To</label>
            <select value={defaultAssignedTo} onChange={(e) => setDefaultAssignedTo(e.target.value)}>
              <optgroup label="Unassigned">
                <option value="">Unassigned</option>
              </optgroup>
              <optgroup label="Staff">
                {staff.map((s) => <option key={`user:${s.id}`} value={`user:${s.id}`}>{s.fullName}</option>)}
              </optgroup>
              <optgroup label="Vendors">
                {vendors.map((v) => <option key={`vendor:${v.id}`} value={`vendor:${v.id}`}>{v.name}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Repeats Every (days)</label>
              <input type="number" min="1" value={form.intervalDays} onChange={(e) => setForm((f) => ({ ...f, intervalDays: e.target.value }))} />
            </div>
            <div className="field">
              <label>Next Due Date *</label>
              <input required type="date" value={form.nextDueDate} onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))} />
            </div>
          </div>
          <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>
            No automatic scheduler is wired up yet — use "Generate Now" on a due schedule below to create its next work order manually. The due date advances automatically each time.
          </p>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Creating..." : "Create Schedule"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AssignPmScheduleModal({ schedule, staff, vendors, onClose, onSaved }) {
  const [assignedTo, setAssignedTo] = useState(
    schedule.defaultAssignedToUserId ? `user:${schedule.defaultAssignedToUserId}` : schedule.defaultAssignedToVendorId ? `vendor:${schedule.defaultAssignedToVendorId}` : ""
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    const [type, id] = assignedTo ? assignedTo.split(":") : [null, null];
    try {
      const data = await api.patch(`/pm-schedules/${schedule.id}`, {
        defaultAssignedToUserId: type === "user" ? id : null,
        defaultAssignedToVendorId: type === "vendor" ? id : null,
      });
      onSaved(data.pmSchedule);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Assign PM Schedule</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <p style={{ fontWeight: 700, marginBottom: "0.8rem" }}>{schedule.title}</p>
        <div className="field">
          <label>Assigned To</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <optgroup label="Unassigned">
              <option value="">Unassigned</option>
            </optgroup>
            <optgroup label="Staff">
              {staff.map((s) => <option key={`user:${s.id}`} value={`user:${s.id}`}>{s.fullName}</option>)}
            </optgroup>
            <optgroup label="Vendors">
              {vendors.map((v) => <option key={`vendor:${v.id}`} value={`vendor:${v.id}`}>{v.name}</option>)}
            </optgroup>
          </select>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1rem" }}>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

export default function WorkOrdersTab({ propertyId }) {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [workOrders, setWorkOrders] = useState([]);
  const [pmSchedules, setPmSchedules] = useState([]);
  const [assets, setAssets] = useState([]);
  const [staff, setStaff] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewWO, setShowNewWO] = useState(false);
  const [showNewPM, setShowNewPM] = useState(false);
  const [detailWO, setDetailWO] = useState(null);
  const [assignPM, setAssignPM] = useState(null);
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/properties/${propertyId}/work-orders`),
      api.get(`/properties/${propertyId}/pm-schedules`),
      api.get(`/properties/${propertyId}/assets`),
      canManage ? api.get("/users").catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
      canManage ? api.get("/vendors").catch(() => ({ vendors: [] })) : Promise.resolve({ vendors: [] }),
    ])
      .then(([wo, pm, a, u, v]) => {
        setWorkOrders(wo.workOrders); setPmSchedules(pm.pmSchedules); setAssets(a.assets);
        setStaff((u.users || []).filter((usr) => usr.role === "admin" || usr.role === "staff"));
        setVendors(v.vendors || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [propertyId]);

  async function generateNow(scheduleId) {
    setBusyId(scheduleId);
    try {
      const data = await api.post(`/pm-schedules/${scheduleId}/generate`, {});
      setWorkOrders((prev) => [data.workOrder, ...prev]);
      // Reload schedules to pick up the advanced next_due_date.
      const pm = await api.get(`/properties/${propertyId}/pm-schedules`);
      setPmSchedules(pm.pmSchedules);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}

      <div className="flex-between" style={{ marginBottom: "0.8rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Work Orders</h3>
        <button className="btn btn-gold btn-sm" onClick={() => setShowNewWO(true)}>+ New Work Order</button>
      </div>

      {workOrders.length === 0 ? (
        <div className="card" style={{ marginBottom: "1.5rem" }}><div className="empty-state"><h3>No work orders yet</h3></div></div>
      ) : (
        <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
          <table className="data-table">
            <thead><tr><th>Title</th><th>Priority</th><th>Status</th><th>Scheduled</th><th>Cost</th></tr></thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr key={wo.id} className="clickable" onClick={() => setDetailWO(wo)}>
                  <td><strong>{wo.title}</strong></td>
                  <td><span style={{ color: PRIORITY_COLORS[wo.priority], fontWeight: 600, textTransform: "uppercase", fontSize: "0.75rem" }}>{wo.priority}</span></td>
                  <td><span className={`badge badge-${wo.status === "completed" ? "completed" : wo.status === "cancelled" ? "cancelled" : "active"}`}>{STATUS_LABELS[wo.status]}</span></td>
                  <td>{fmtDate(wo.scheduledDate)}</td>
                  <td>{wo.costCents ? `$${(wo.costCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <>
          <div className="flex-between" style={{ marginBottom: "0.8rem" }}>
            <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Preventive Maintenance Schedules</h3>
            <button className="btn btn-outline btn-sm" onClick={() => setShowNewPM(true)}>+ New PM Schedule</button>
          </div>
          {pmSchedules.length === 0 ? (
            <div className="card"><div className="empty-state"><h3>No PM schedules yet</h3><p className="text-sm">Set up recurring maintenance so work orders don't rely on someone remembering.</p></div></div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <table className="data-table">
                <thead><tr><th>Title</th><th>Repeats</th><th>Next Due</th><th></th></tr></thead>
                <tbody>
                  {pmSchedules.map((s) => {
                    const due = new Date(s.nextDueDate) <= new Date();
                    return (
                      <tr key={s.id}>
                        <td><strong>{s.title}</strong></td>
                        <td>{s.intervalDays ? `every ${s.intervalDays} days` : "—"}</td>
                        <td>{fmtDate(s.nextDueDate)} {due && <span className="badge badge-on_hold" style={{ marginLeft: 6 }}>due</span>}</td>
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => setAssignPM(s)} style={{ marginRight: 6 }}>Assign</button>
                          <button className="btn btn-outline btn-sm" disabled={busyId === s.id} onClick={() => generateNow(s.id)}>{busyId === s.id ? "Generating…" : "Generate Now"}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showNewWO && (
        <NewWorkOrderModal
          propertyId={propertyId}
          assets={assets}
          onClose={() => setShowNewWO(false)}
          onCreated={(wo) => { setShowNewWO(false); setWorkOrders((prev) => [wo, ...prev]); }}
        />
      )}
      {showNewPM && (
        <NewPmScheduleModal
          propertyId={propertyId}
          assets={assets}
          staff={staff}
          vendors={vendors}
          onClose={() => setShowNewPM(false)}
          onCreated={(s) => { setShowNewPM(false); setPmSchedules((prev) => [...prev, s]); }}
        />
      )}
      {detailWO && (
        <WorkOrderDetailModal
          workOrder={detailWO}
          assets={assets}
          staff={staff}
          vendors={vendors}
          canManage={canManage}
          onClose={() => setDetailWO(null)}
          onSaved={(saved) => {
            setDetailWO(saved);
            setWorkOrders((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
          }}
        />
      )}
      {assignPM && (
        <AssignPmScheduleModal
          schedule={assignPM}
          staff={staff}
          vendors={vendors}
          onClose={() => setAssignPM(null)}
          onSaved={(saved) => {
            setAssignPM(null);
            setPmSchedules((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
          }}
        />
      )}
    </div>
  );
}
