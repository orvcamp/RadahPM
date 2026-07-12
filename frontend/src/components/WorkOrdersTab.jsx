// src/components/WorkOrdersTab.jsx
//
// MangoDoe Facilities — Work Orders + Preventive Maintenance Schedules for
// a Property. Combined into one tab since they're tightly related (a PM
// schedule spawns a work order).

import { useEffect, useState } from "react";
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

function WorkOrderDetailModal({ workOrder, assets, onClose, onSaved, canManage }) {
  const [status, setStatus] = useState(workOrder.status);
  const [costCents, setCostCents] = useState((workOrder.costCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
            </div>
          </>
        ) : (
          <p className="text-sm" style={{ marginBottom: "1rem" }}>Status: <span className={`badge badge-${workOrder.status === "completed" ? "completed" : workOrder.status === "cancelled" ? "cancelled" : "active"}`}>{STATUS_LABELS[status]}</span></p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}

function NewPmScheduleModal({ propertyId, assets, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", assetId: "", frequencyType: "calendar", intervalDays: "90", nextDueDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Title is required.");
    if (!form.nextDueDate) return setError("A next due date is required.");
    setSaving(true);
    try {
      const data = await api.post(`/properties/${propertyId}/pm-schedules`, {
        ...form,
        assetId: form.assetId || null,
        intervalDays: form.intervalDays ? Number(form.intervalDays) : null,
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

export default function WorkOrdersTab({ propertyId }) {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [workOrders, setWorkOrders] = useState([]);
  const [pmSchedules, setPmSchedules] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewWO, setShowNewWO] = useState(false);
  const [showNewPM, setShowNewPM] = useState(false);
  const [detailWO, setDetailWO] = useState(null);
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/properties/${propertyId}/work-orders`),
      api.get(`/properties/${propertyId}/pm-schedules`),
      api.get(`/properties/${propertyId}/assets`),
    ])
      .then(([wo, pm, a]) => { setWorkOrders(wo.workOrders); setPmSchedules(pm.pmSchedules); setAssets(a.assets); })
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
                        <td><button className="btn btn-outline btn-sm" disabled={busyId === s.id} onClick={() => generateNow(s.id)}>{busyId === s.id ? "Generating…" : "Generate Now"}</button></td>
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
          onClose={() => setShowNewPM(false)}
          onCreated={(s) => { setShowNewPM(false); setPmSchedules((prev) => [...prev, s]); }}
        />
      )}
      {detailWO && (
        <WorkOrderDetailModal
          workOrder={detailWO}
          assets={assets}
          canManage={canManage}
          onClose={() => setDetailWO(null)}
          onSaved={(saved) => {
            setDetailWO(saved);
            setWorkOrders((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
          }}
        />
      )}
    </div>
  );
}
