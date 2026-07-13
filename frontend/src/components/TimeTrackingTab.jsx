// src/components/TimeTrackingTab.jsx
//
// MangoDoe Projects — Time Tracking. Everyone logs their own hours; only
// admin/staff can edit or delete someone else's entry (matches the backend
// guard in routes/timeentries.js exactly). Full project log is visible to
// everyone on the project — utilization visibility is a feature here, same
// reasoning Daily Logs uses for clients.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

function fmtHours(minutes) {
  return (minutes / 60).toFixed(2);
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

function LogTimeModal({ projectId, tasks, entry, onClose, onSaved }) {
  const [form, setForm] = useState({
    taskId: entry?.taskId || "",
    hours: entry ? (entry.minutes / 60).toString() : "",
    billable: entry ? entry.billable : true,
    entryDate: entry?.entryDate ? entry.entryDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    note: entry?.note || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const hrs = parseFloat(form.hours);
    if (!Number.isFinite(hrs) || hrs <= 0) return setError("Enter hours as a positive number (e.g. 1.5).");
    setSaving(true);
    try {
      const body = {
        taskId: form.taskId || null,
        minutes: Math.round(hrs * 60),
        billable: form.billable,
        entryDate: form.entryDate,
        note: form.note || null,
      };
      const data = entry
        ? await api.patch(`/time-entries/${entry.id}`, body)
        : await api.post(`/projects/${projectId}/time-entries`, body);
      onSaved(data.entry);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{entry ? "Edit Time Entry" : "Log Time"}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", marginBottom: "0.9rem" }}>
            <div>
              <label style={labelStyle}>Hours</label>
              <input value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} style={inputStyle} placeholder="1.5" />
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={labelStyle}>Task (optional)</label>
            <select value={form.taskId} onChange={(e) => setForm((f) => ({ ...f, taskId: e.target.value }))} style={inputStyle}>
              <option value="">Not tied to a specific task</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.billable} onChange={(e) => setForm((f) => ({ ...f, billable: e.target.checked }))} />
              Billable
            </label>
          </div>
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={labelStyle}>Note (optional)</label>
            <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} />
          </div>
          <button type="submit" className="btn btn-gold" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Saving..." : entry ? "Save Changes" : "Log Time"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function TimeTrackingTab({ projectId }) {
  const { user } = useAuth();
  const canManageAll = user.role === "admin" || user.role === "staff";
  const [entries, setEntries] = useState([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [billableMinutes, setBillableMinutes] = useState(0);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalEntry, setModalEntry] = useState(undefined); // undefined = closed, null = new, object = edit
  const [filterMine, setFilterMine] = useState(false);

  function load() {
    setLoading(true);
    const qs = filterMine ? `?userId=${user.id}` : "";
    Promise.all([
      api.get(`/projects/${projectId}/time-entries${qs}`),
      api.get(`/projects/${projectId}/tasks`).catch(() => ({ tasks: [] })),
    ])
      .then(([te, t]) => {
        setEntries(te.entries);
        setTotalMinutes(te.totalMinutes);
        setBillableMinutes(te.billableMinutes);
        setTasks(t.tasks || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [projectId, filterMine]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeEntry(entry) {
    if (!confirm("Remove this time entry?")) return;
    try {
      await api.delete(`/time-entries/${entry.id}`);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      alert(err.message);
    }
  }

  function canEdit(entry) {
    return canManageAll || entry.userId === user.id;
  }

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}

      <div className="stat-row" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: "1rem" }}>
        <div className="stat-card">
          <span className="num">{fmtHours(totalMinutes)}</span>
          <span className="label">Total Hours{filterMine ? " (Mine)" : ""}</span>
        </div>
        <div className="stat-card">
          <span className="num">{fmtHours(billableMinutes)}</span>
          <span className="label">Billable Hours</span>
        </div>
      </div>

      <div className="flex-between" style={{ marginBottom: "1rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={filterMine} onChange={(e) => setFilterMine(e.target.checked)} />
          Show only my entries
        </label>
        <button className="btn btn-gold" onClick={() => setModalEntry(null)}>+ Log Time</button>
      </div>

      {entries.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No time logged yet</h3><p className="text-sm">Log hours against this project, optionally tied to a specific task.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Person</th><th>Task</th><th>Hours</th><th>Billable</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {entries.map((e) => {
                const task = tasks.find((t) => t.id === e.taskId);
                return (
                  <tr key={e.id}>
                    <td>{fmtDate(e.entryDate)}</td>
                    <td>{e.userName || "—"}</td>
                    <td>{task ? task.title : "—"}</td>
                    <td><strong>{fmtHours(e.minutes)}</strong></td>
                    <td>{e.billable ? <span className="badge badge-active">billable</span> : <span className="text-sm text-steel">non-billable</span>}</td>
                    <td className="text-sm text-steel">{e.note || "—"}</td>
                    <td>
                      {canEdit(e) && (
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button className="btn btn-outline btn-sm" onClick={() => setModalEntry(e)}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => removeEntry(e)}>Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalEntry !== undefined && (
        <LogTimeModal
          projectId={projectId}
          tasks={tasks}
          entry={modalEntry}
          onClose={() => setModalEntry(undefined)}
          onSaved={(saved) => {
            setModalEntry(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}
