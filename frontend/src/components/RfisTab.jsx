// src/components/RfisTab.jsx
//
// Per-project RFIs. open -> answered -> closed (reopen allowed).
// admin/staff or trade-partner members raise; admin/staff or client members
// answer/close. Overdue open RFIs are flagged. Attachments reuse R2/Documents.

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_BADGE = { open: "badge-in_progress", answered: "badge-active", closed: "badge-not_started" };
const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

function isOverdue(rfi) {
  if (rfi.status !== "open" || !rfi.dueDate) return false;
  const due = new Date(rfi.dueDate); due.setHours(23, 59, 59, 999);
  return due < new Date();
}

// ---------- create / edit modal ----------
function RfiModal({ projectId, members, rfi, onClose, onSaved }) {
  const isEdit = Boolean(rfi);
  const [form, setForm] = useState({
    subject: rfi?.subject || "",
    question: rfi?.question || "",
    dueDate: rfi?.dueDate ? String(rfi.dueDate).slice(0, 10) : "",
    assignedTo: rfi?.assignedTo || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.subject.trim()) return setError("Please enter a subject.");
    setSaving(true);
    try {
      const payload = {
        subject: form.subject.trim(),
        question: form.question.trim() || null,
        dueDate: form.dueDate || null,
        assignedTo: form.assignedTo || null,
      };
      if (isEdit) await api.patch(`/rfis/${rfi.id}`, payload);
      else await api.post(`/projects/${projectId}/rfis`, payload);
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? `Edit RFI #${rfi.rfiNumber}` : "New RFI"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Subject</label>
            <input autoFocus value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} style={inputStyle} placeholder="e.g. Conflict between structural and MEP at grid C4" />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Question</label>
            <textarea value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} placeholder="Describe the question or clarification needed…" />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1.4rem" }}>
            <div style={{ width: 180 }}>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Assign To</label>
              <select value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))} style={inputStyle}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Create RFI"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- answer modal ----------
function AnswerModal({ rfi, onClose, onSaved }) {
  const [answer, setAnswer] = useState(rfi.answer || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!answer.trim()) return setError("Please enter an answer.");
    setSaving(true);
    try {
      await api.post(`/rfis/${rfi.id}/transition`, { action: "answer", answer: answer.trim() });
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Answer RFI #{rfi.rfiNumber}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="text-sm text-steel" style={{ marginBottom: "0.4rem" }}><strong>{rfi.subject}</strong></p>
        {rfi.question && <p className="text-sm" style={{ marginBottom: "1rem", whiteSpace: "pre-wrap" }}>{rfi.question}</p>}
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <label style={labelStyle}>Answer</label>
          <textarea autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ ...inputStyle, minHeight: 100, resize: "vertical", marginBottom: "1.2rem" }} placeholder="Provide the official response…" />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : "Submit Answer"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- attachments modal ----------
function AttachmentsModal({ projectId, rfi, onClose, onChanged }) {
  const fileRef = useRef(null);
  const [attachments, setAttachments] = useState(rfi.attachments || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function download(a) {
    try { const { downloadUrl } = await api.get(`/documents/${a.documentId}/download-url`); window.open(downloadUrl, "_blank"); }
    catch (err) { alert(err.message); }
  }
  async function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ""; setError(""); setUploading(true);
    try {
      const ct = file.type || "application/octet-stream";
      const { uploadUrl, storageKey } = await api.post(`/projects/${projectId}/rfis/${rfi.id}/attachments/upload-url`, { fileName: file.name, contentType: ct });
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
      if (!put.ok) throw new Error("Upload to storage failed.");
      const { attachment } = await api.post(`/projects/${projectId}/rfis/${rfi.id}/attachments/confirm`, { storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size });
      setAttachments((p) => [...p, attachment]); onChanged && onChanged();
    } catch (err) { setError(err.message); } finally { setUploading(false); }
  }
  async function remove(a) {
    if (!confirm(`Remove "${a.fileName}"?`)) return;
    try { await api.delete(`/rfi-documents/${a.id}`); setAttachments((p) => p.filter((x) => x.id !== a.id)); onChanged && onChanged(); }
    catch (err) { alert(err.message); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>RFI #{rfi.rfiNumber} — Attachments</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {attachments.length === 0 ? <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>No attachments yet.</p> : (
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
        <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onFile} />
        <button className="btn btn-outline btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? "Uploading…" : "+ Add File"}</button>
      </div>
    </div>
  );
}

export default function RfisTab({ projectId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);       // create/edit
  const [answerModal, setAnswerModal] = useState(null);
  const [attachModal, setAttachModal] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get(`/projects/${projectId}/rfis`)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function transition(rfi, action, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(rfi.id);
    try { await api.post(`/rfis/${rfi.id}/transition`, { action }); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }
  async function remove(rfi) {
    if (!confirm(`Delete RFI #${rfi.rfiNumber}?`)) return;
    setBusyId(rfi.id);
    try { await api.delete(`/rfis/${rfi.id}`); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { rfis, canRaise, canAnswer, members } = data;

  return (
    <div>
      {canRaise && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span className="text-sm text-steel">Requests for information on this project.</span>
          <button className="btn btn-gold" onClick={() => setModal({})}>+ New RFI</button>
        </div>
      )}

      {rfis.length === 0 ? (
        <div className="card"><div className="empty-state">
          <h3>No RFIs yet</h3>
          <p className="text-sm">{canRaise ? "Raise one to formally ask for clarification." : "No RFIs have been raised for this project yet."}</p>
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr><th>RFI #</th><th>Subject</th><th>Assigned To</th><th>Due</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rfis.map((rfi) => {
                const busy = busyId === rfi.id;
                const overdue = isOverdue(rfi);
                return (
                  <tr key={rfi.id}>
                    <td><strong>#{rfi.rfiNumber}</strong></td>
                    <td>
                      <strong>{rfi.subject}</strong>
                      {rfi.question && <div className="text-sm text-steel" style={{ maxWidth: 340 }}>{rfi.question}</div>}
                      {rfi.answer && <div className="text-sm" style={{ maxWidth: 340, marginTop: 4 }}><span className="text-steel">Answer:</span> {rfi.answer}{rfi.answeredByName ? ` — ${rfi.answeredByName}` : ""}</div>}
                    </td>
                    <td>{rfi.assignedToName || "—"}</td>
                    <td style={{ color: overdue ? "var(--red)" : "inherit", whiteSpace: "nowrap" }}>
                      {rfi.dueDate ? new Date(rfi.dueDate).toLocaleDateString() : "—"}
                      {overdue && <div style={{ fontSize: "0.7rem", color: "var(--red)", fontWeight: 700 }}>OVERDUE</div>}
                    </td>
                    <td><span className={`badge ${STATUS_BADGE[rfi.status] || ""}`}>{rfi.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setAttachModal(rfi)}>📎{rfi.attachments && rfi.attachments.length ? ` (${rfi.attachments.length})` : ""}</button>
                        {canAnswer && rfi.status === "open" && <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => setAnswerModal(rfi)}>Answer</button>}
                        {canAnswer && rfi.status !== "closed" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition(rfi, "close", `Close RFI #${rfi.rfiNumber}?`)}>Close</button>}
                        {canAnswer && rfi.status !== "open" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition(rfi, "reopen")}>Reopen</button>}
                        {(user.role === "admin" || user.role === "staff" || canRaise) && rfi.status !== "closed" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setModal(rfi)}>Edit</button>}
                        {(user.role === "admin" || user.role === "staff") && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => remove(rfi)}>Delete</button>}
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
        <RfiModal projectId={projectId} members={members} rfi={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {answerModal !== null && (
        <AnswerModal rfi={answerModal} onClose={() => setAnswerModal(null)} onSaved={() => { setAnswerModal(null); load(); }} />
      )}
      {attachModal !== null && (
        <AttachmentsModal projectId={projectId} rfi={attachModal} onClose={() => setAttachModal(null)} onChanged={() => load()} />
      )}
    </div>
  );
}
