// src/components/ApprovalsTab.jsx
//
// MangoDoe Projects — Approvals. Any project member can request one; only
// the assigned approver (or a manager) can decide it. Matches
// routes/approvals.js exactly: pending only while editable, decided is
// final (no re-deciding — create a new request instead, same as Change
// Orders don't get un-approved).

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString() : "—";
}

function NewApprovalModal({ projectId, members, onClose, onCreated }) {
  const [form, setForm] = useState({ type: "general", title: "", description: "", approverId: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Title is required.");
    setSaving(true);
    try {
      const data = await api.post(`/projects/${projectId}/approvals`, { ...form, approverId: form.approverId || null });
      onCreated(data.approval);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Request Approval</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} placeholder="e.g. Approve homepage copy draft" />
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={labelStyle}>Details</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={labelStyle}>Send to (optional)</label>
            <select value={form.approverId} onChange={(e) => setForm((f) => ({ ...f, approverId: e.target.value }))} style={inputStyle}>
              <option value="">Unassigned — any manager can decide</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-gold" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Sending..." : "Send for Approval"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ApprovalDetailModal({ approval, canDecide, onClose, onDecided }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision) {
    setBusy(true);
    setError("");
    try {
      const data = await api.post(`/approvals/${approval.id}/decide`, { decision, note: note || null });
      onDecided(data.approval);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Approval Request</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <p style={{ fontWeight: 700, marginBottom: "0.2rem" }}>{approval.title}</p>
        {approval.description && <p className="text-sm text-steel" style={{ marginBottom: "0.8rem" }}>{approval.description}</p>}
        <p className="text-sm text-steel" style={{ marginBottom: "0.8rem" }}>Requested by {approval.requestedByName}{approval.approverName ? ` · sent to ${approval.approverName}` : ""}</p>

        {approval.status === "pending" ? (
          canDecide ? (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <label style={labelStyle}>Decision note (optional)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <button className="btn btn-danger" disabled={busy} onClick={() => decide("rejected")}>Reject</button>
                <button className="btn btn-gold" disabled={busy} onClick={() => decide("approved")}>Approve</button>
              </div>
            </>
          ) : (
            <p className="text-sm"><span className="badge badge-on_hold">pending</span> Waiting on {approval.approverName || "a manager"}.</p>
          )
        ) : (
          <>
            <p className="text-sm" style={{ marginBottom: "0.5rem" }}>
              <span className={`badge badge-${approval.status === "approved" ? "active" : "cancelled"}`}>{approval.status}</span>
              {" "}on {fmtDateTime(approval.decidedAt)}
            </p>
            {approval.decisionNote && <p className="text-sm text-steel">"{approval.decisionNote}"</p>}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.2rem" }}>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsTab({ projectId }) {
  const { user } = useAuth();
  const isManager = user.role === "admin" || user.role === "staff";
  const [approvals, setApprovals] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/projects/${projectId}/approvals`),
      api.get(`/projects/${projectId}/members`).catch(() => ({ members: [] })),
    ])
      .then(([a, m]) => { setApprovals(a.approvals); setMembers(m.members || []); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [projectId]);

  function canDecide(a) {
    return isManager || a.approverId === user.id;
  }

  const filtered = statusFilter === "all" ? approvals : approvals.filter((a) => a.status === statusFilter);
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}

      <div className="flex-between" style={{ marginBottom: "1rem" }}>
        <div className="tab-row" style={{ marginBottom: 0, borderBottom: "none" }}>
          <button className={`tab-btn ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>All</button>
          <button className={`tab-btn ${statusFilter === "pending" ? "active" : ""}`} onClick={() => setStatusFilter("pending")}>Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}</button>
          <button className={`tab-btn ${statusFilter === "approved" ? "active" : ""}`} onClick={() => setStatusFilter("approved")}>Approved</button>
          <button className={`tab-btn ${statusFilter === "rejected" ? "active" : ""}`} onClick={() => setStatusFilter("rejected")}>Rejected</button>
        </div>
        <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ Request Approval</button>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No approval requests</h3><p className="text-sm">Ask a teammate to sign off on something — a deliverable, a budget request, whatever needs a decision on record.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Title</th><th>Requested By</th><th>Approver</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setDetail(a)}>
                  <td><strong>{a.title}</strong></td>
                  <td>{a.requestedByName}</td>
                  <td>{a.approverName || <span className="text-steel">Unassigned</span>}</td>
                  <td><span className={`badge badge-${a.status === "approved" ? "active" : a.status === "rejected" ? "cancelled" : "on_hold"}`}>{a.status}</span></td>
                  <td>{fmtDateTime(a.decidedAt || a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewApprovalModal
          projectId={projectId}
          members={members}
          onClose={() => setShowNew(false)}
          onCreated={(a) => { setShowNew(false); setApprovals((prev) => [a, ...prev]); }}
        />
      )}
      {detail && (
        <ApprovalDetailModal
          approval={detail}
          canDecide={canDecide(detail)}
          onClose={() => setDetail(null)}
          onDecided={(updated) => {
            setDetail(updated);
            setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          }}
        />
      )}
    </div>
  );
}
