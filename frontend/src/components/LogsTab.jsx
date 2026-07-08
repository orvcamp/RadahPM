// src/components/LogsTab.jsx
//
// Project logs & registers. Nine PM-owned registers share one table and one UI:
// Action, Issue, Decision, Risk, Assumption, Constraint, Opportunity,
// Open Items, and Lessons Learned.
//
// Risk and Opportunity add Likelihood / Impact. Everything else hides them.
// admin/staff manage entries; every member can view; delete is admin-only
// (soft, recoverable from Deleted Items).

import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

const STATUS_LABEL = { open: "Open", in_progress: "In Progress", closed: "Closed" };
const STATUS_BADGE = { open: "badge-in_progress", in_progress: "badge-active", closed: "badge-not_started" };
const PRIORITY_COLOR = { low: "var(--steel)", medium: "var(--navy, #0B1F3A)", high: "#C77700", critical: "var(--red, #B23B3B)" };
const SCORE_OPTIONS = ["Low", "Medium", "High"];

function isOverdue(e) {
  if (e.status === "closed" || !e.dueDate) return false;
  const d = new Date(e.dueDate); d.setHours(23, 59, 59, 999);
  return d < new Date();
}

// ---------- create / edit ----------
function EntryModal({ projectId, logType, typeMeta, members, statuses, priorities, entry, onClose, onSaved }) {
  const isEdit = Boolean(entry);
  const scored = !!typeMeta?.scored;
  const [form, setForm] = useState({
    title: entry?.title || "",
    description: entry?.description || "",
    priority: entry?.priority || "medium",
    ownerId: entry?.ownerId || "",
    dueDate: entry?.dueDate ? String(entry.dueDate).slice(0, 10) : "",
    likelihood: entry?.likelihood || "",
    impact: entry?.impact || "",
    category: entry?.category || "",
    resolution: entry?.resolution || "",
    status: entry?.status || "open",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Please enter a title.");
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        ownerId: form.ownerId || null,
        dueDate: form.dueDate || null,
        likelihood: scored ? form.likelihood || null : null,
        impact: scored ? form.impact || null : null,
        category: form.category.trim() || null,
      };
      if (isEdit) {
        await api.patch(`/logs/${entry.id}`, { ...payload, resolution: form.resolution.trim() || null, status: form.status });
      } else {
        await api.post(`/projects/${projectId}/logs`, { ...payload, logType });
      }
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); }
  }

  const ta = { ...inputStyle, minHeight: 70, resize: "vertical" };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>
            {isEdit ? `Edit ${typeMeta?.singular} #${entry.entryNumber}` : `New ${typeMeta?.singular || "Entry"}`}
          </h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={labelStyle}>Title</label>
            <input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} style={inputStyle} placeholder="Short, specific summary" />
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} style={ta} />
          </div>

          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>Owner</label>
              <select value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>
            <div style={{ width: 150 }}>
              <label style={labelStyle}>Priority</label>
              <select value={form.priority} onChange={(e) => set("priority", e.target.value)} style={inputStyle}>
                {priorities.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ width: 170 }}>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} style={inputStyle} />
            </div>
          </div>

          {scored && (
            <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={labelStyle}>Likelihood</label>
                <select value={form.likelihood} onChange={(e) => set("likelihood", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {SCORE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={labelStyle}>Impact</label>
                <select value={form.impact} onChange={(e) => set("impact", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {SCORE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}

          <div style={{ marginBottom: "0.9rem" }}>
            <label style={labelStyle}>Category (optional)</label>
            <input value={form.category} onChange={(e) => set("category", e.target.value)} style={inputStyle} placeholder="e.g. Schedule, Cost, Safety" />
          </div>

          {isEdit && (
            <>
              <div style={{ display: "flex", gap: "0.8rem", marginBottom: "0.9rem" }}>
                <div style={{ width: 190 }}>
                  <label style={labelStyle}>Status</label>
                  <select value={form.status} onChange={(e) => set("status", e.target.value)} style={inputStyle}>
                    {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: "1.2rem" }}>
                <label style={labelStyle}>Resolution / Outcome</label>
                <textarea value={form.resolution} onChange={(e) => set("resolution", e.target.value)} style={ta} placeholder="What was decided, mitigated, or learned…" />
              </div>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LogsTab({ projectId }) {
  const { user } = useAuth();
  const [logType, setLogType] = useState("action");
  const [statusFilter, setStatusFilter] = useState("open_only");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setData(await api.get(`/projects/${projectId}/logs?type=${logType}`));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId, logType]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(entry, status) {
    setBusyId(entry.id);
    try { await api.patch(`/logs/${entry.id}`, { status }); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }
  async function remove(entry) {
    if (!confirm(`Delete entry #${entry.entryNumber} "${entry.title}"?\n\nIt moves to Deleted Items and can be restored.`)) return;
    setBusyId(entry.id);
    try { await api.delete(`/logs/${entry.id}`); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }

  if (loading && !data) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { entries, types, counts, statuses, priorities, canManage, canDelete, members } = data;
  const typeMeta = types.find((t) => t.key === logType);
  const scored = !!typeMeta?.scored;
  const visible = statusFilter === "open_only" ? entries.filter((e) => e.status !== "closed") : entries;

  return (
    <div>
      {/* register selector */}
      <div className="card" style={{ marginBottom: "1rem", padding: "0.8rem 1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {types.map((t) => {
            const c = counts[t.key];
            const active = t.key === logType;
            return (
              <button
                key={t.key}
                onClick={() => setLogType(t.key)}
                className={`btn btn-sm ${active ? "btn-gold" : "btn-outline"}`}
                title={c ? `${c.open} open of ${c.total}` : "No entries yet"}
              >
                {t.label}
                {c && c.open > 0 && (
                  <span style={{ marginLeft: 6, fontSize: "0.7rem", opacity: 0.85 }}>({c.open})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-between" style={{ marginBottom: "0.9rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <span className="text-sm text-steel">{typeMeta?.label}</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.35rem 0.6rem", fontSize: "0.8rem" }}>
            <option value="open_only">Open items</option>
            <option value="all">All items</option>
          </select>
        </div>
        {canManage && <button className="btn btn-gold" onClick={() => setModal({})}>+ New {typeMeta?.singular}</button>}
      </div>

      {visible.length === 0 ? (
        <div className="card"><div className="empty-state">
          <h3>Nothing in the {typeMeta?.label.toLowerCase()}</h3>
          <p className="text-sm">
            {canManage
              ? `Add an entry to start tracking. Entries are numbered per register.`
              : "No entries have been recorded yet."}
          </p>
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Owner</th>
                {scored && <th>L / I</th>}
                <th>Priority</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const busy = busyId === e.id;
                const overdue = isOverdue(e);
                return (
                  <tr key={e.id}>
                    <td><strong>#{e.entryNumber}</strong></td>
                    <td>
                      <strong>{e.title}</strong>
                      {e.description && <div className="text-sm text-steel" style={{ maxWidth: 340 }}>{e.description}</div>}
                      {e.category && <div className="text-sm text-steel" style={{ fontSize: "0.72rem" }}>{e.category}</div>}
                      {e.status === "closed" && e.resolution && (
                        <div className="text-sm" style={{ maxWidth: 340, marginTop: 3 }}>
                          <span className="text-steel">Outcome:</span> {e.resolution}
                        </div>
                      )}
                    </td>
                    <td>{e.ownerName || "—"}</td>
                    {scored && <td style={{ whiteSpace: "nowrap" }}>{e.likelihood || "—"} / {e.impact || "—"}</td>}
                    <td style={{ color: PRIORITY_COLOR[e.priority], fontWeight: e.priority === "critical" || e.priority === "high" ? 700 : 400 }}>
                      {e.priority[0].toUpperCase() + e.priority.slice(1)}
                    </td>
                    <td style={{ color: overdue ? "var(--red)" : "inherit", whiteSpace: "nowrap" }}>
                      {e.dueDate ? new Date(e.dueDate).toLocaleDateString() : "—"}
                      {overdue && <div style={{ fontSize: "0.7rem", color: "var(--red)", fontWeight: 700 }}>OVERDUE</div>}
                    </td>
                    <td><span className={`badge ${STATUS_BADGE[e.status]}`}>{STATUS_LABEL[e.status]}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {canManage && e.status === "open" && (
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setStatus(e, "in_progress")}>Start</button>
                        )}
                        {canManage && e.status !== "closed" && (
                          <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => setStatus(e, "closed")}>Close</button>
                        )}
                        {canManage && e.status === "closed" && (
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setStatus(e, "open")}>Reopen</button>
                        )}
                        {canManage && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setModal(e)}>Edit</button>}
                        {canDelete && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => remove(e)}>Delete</button>}
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
        <EntryModal
          projectId={projectId}
          logType={logType}
          typeMeta={typeMeta}
          members={members}
          statuses={statuses}
          priorities={priorities}
          entry={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
