// src/components/SubmittalsTab.jsx
//
// Per-project submittals. draft -> submitted -> under_review -> returned
// (with disposition). Returned submittals can spawn a revision.
// admin/staff or trade-partner members create/submit/revise; admin/staff or
// client members review/return. Attachments reuse R2/Documents.

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

const DISP_LABEL = {
  approved: "Approved",
  approved_as_noted: "Approved as Noted",
  revise_resubmit: "Revise & Resubmit",
  rejected: "Rejected",
};
const STATUS_LABEL = { draft: "Draft", submitted: "Submitted", under_review: "Under Review", returned: "Returned" };

function statusBadgeClass(s) {
  if (s.status === "returned") {
    if (s.disposition === "approved" || s.disposition === "approved_as_noted") return "badge-active";
    if (s.disposition === "rejected") return "badge-cancelled";
    return "badge-in_progress"; // revise & resubmit
  }
  if (s.status === "draft") return "badge-not_started";
  return "badge-in_progress"; // submitted / under_review
}
function statusText(s) {
  if (s.status === "returned") return DISP_LABEL[s.disposition] || "Returned";
  return STATUS_LABEL[s.status] || s.status;
}
function isOverdue(s) {
  if (!(s.status === "submitted" || s.status === "under_review") || !s.dueDate) return false;
  const due = new Date(s.dueDate); due.setHours(23, 59, 59, 999);
  return due < new Date();
}

async function uploadAttachment(projectId, subId, file) {
  const ct = file.type || "application/octet-stream";
  const { uploadUrl, storageKey } = await api.post(`/projects/${projectId}/submittals/${subId}/attachments/upload-url`, { fileName: file.name, contentType: ct });
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
  if (!put.ok) throw new Error("Attachment upload to storage failed.");
  await api.post(`/projects/${projectId}/submittals/${subId}/attachments/confirm`, { storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size });
}

// ---------- create / edit modal ----------
function SubmittalModal({ projectId, members, submittal, onClose, onSaved }) {
  const isEdit = Boolean(submittal);
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    title: submittal?.title || "",
    specSection: submittal?.specSection || "",
    description: submittal?.description || "",
    dueDate: submittal?.dueDate ? String(submittal.dueDate).slice(0, 10) : "",
    ballInCourt: submittal?.ballInCourt || "",
  });
  const [existing, setExisting] = useState(submittal?.attachments || []);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");

  function pick(e) { const f = Array.from(e.target.files || []); e.target.value = ""; setPending((p) => [...p, ...f]); }
  async function detach(a) {
    if (!confirm(`Remove "${a.fileName}"?`)) return;
    try { await api.delete(`/submittal-documents/${a.id}`); setExisting((p) => p.filter((x) => x.id !== a.id)); } catch (err) { alert(err.message); }
  }
  async function submit(e) {
    e.preventDefault(); setError("");
    if (!form.title.trim()) return setError("Please enter a title.");
    setSaving(true);
    try {
      const payload = { title: form.title.trim(), specSection: form.specSection.trim() || null, description: form.description.trim() || null, dueDate: form.dueDate || null, ballInCourt: form.ballInCourt || null };
      let id;
      if (isEdit) { await api.patch(`/submittals/${submittal.id}`, payload); id = submittal.id; }
      else { const { submittal: created } = await api.post(`/projects/${projectId}/submittals`, payload); id = created.id; }
      for (let i = 0; i < pending.length; i++) { setProgress(`Uploading attachment ${i + 1} of ${pending.length}…`); await uploadAttachment(projectId, id, pending[i]); }
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); setProgress(""); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? `Edit Submittal #${submittal.submittalNumber}${submittal.revision ? ` Rev ${submittal.revision}` : ""}` : "New Submittal"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {progress && <div className="success-msg">{progress}</div>}
        <form onSubmit={submit}>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Title</label>
              <input autoFocus value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} placeholder="e.g. Structural steel shop drawings" />
            </div>
            <div style={{ width: 160 }}>
              <label style={labelStyle}>Spec Section</label>
              <input value={form.specSection} onChange={(e) => setForm((f) => ({ ...f, specSection: e.target.value }))} style={inputStyle} placeholder="e.g. 05 12 00" />
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="What's being submitted…" />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem" }}>
            <div style={{ width: 180 }}>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Ball In Court</label>
              <select value={form.ballInCourt} onChange={(e) => setForm((f) => ({ ...f, ballInCourt: e.target.value }))} style={inputStyle}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: "1.4rem" }}>
            <label style={labelStyle}>Attachments (the submittal package)</label>
            {existing.length > 0 && existing.map((a) => (
              <div key={a.id} className="flex-between" style={{ padding: "0.3rem 0", fontSize: "0.84rem" }}>
                <span>{a.fileName}</span>
                <button type="button" onClick={() => detach(a)} style={{ border: "none", background: "none", color: "var(--red)", cursor: "pointer" }}>Remove</button>
              </div>
            ))}
            {pending.length > 0 && <p className="text-sm text-steel" style={{ marginBottom: "0.5rem" }}>{pending.length} file(s) ready to upload on save.</p>}
            <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={pick} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>+ Add Files</button>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- return (disposition) modal ----------
function ReturnModal({ submittal, dispositions, onClose, onSaved }) {
  const [disposition, setDisposition] = useState("approved");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault(); setSaving(true); setError("");
    try { await api.post(`/submittals/${submittal.id}/transition`, { action: "return", disposition, reviewNotes: notes.trim() || null }); onSaved(); }
    catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Return Submittal #{submittal.submittalNumber}{submittal.revision ? ` Rev ${submittal.revision}` : ""}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Disposition</label>
            <select value={disposition} onChange={(e) => setDisposition(e.target.value)} style={inputStyle}>
              {dispositions.map((d) => <option key={d} value={d}>{DISP_LABEL[d] || d}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={labelStyle}>Review Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} placeholder="Comments, markups referenced, conditions of approval…" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : "Return with Disposition"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- attachments modal ----------
function AttachmentsModal({ projectId, submittal, onClose, onChanged }) {
  const fileRef = useRef(null);
  const [attachments, setAttachments] = useState(submittal.attachments || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function download(a) { try { const { downloadUrl } = await api.get(`/documents/${a.documentId}/download-url`); window.open(downloadUrl, "_blank"); } catch (err) { alert(err.message); } }
  async function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ""; setError(""); setUploading(true);
    try { await uploadAttachment(projectId, submittal.id, file); onChanged && onChanged(); onClose(); }
    catch (err) { setError(err.message); setUploading(false); }
  }
  async function remove(a) { if (!confirm(`Remove "${a.fileName}"?`)) return; try { await api.delete(`/submittal-documents/${a.id}`); setAttachments((p) => p.filter((x) => x.id !== a.id)); onChanged && onChanged(); } catch (err) { alert(err.message); } }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>Submittal #{submittal.submittalNumber} — Attachments</h3>
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

export default function SubmittalsTab({ projectId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [returnModal, setReturnModal] = useState(null);
  const [attachModal, setAttachModal] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get(`/projects/${projectId}/submittals`)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function transition(sub, action, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(sub.id);
    try { await api.post(`/submittals/${sub.id}/transition`, { action }); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }
  async function revise(sub) {
    if (!confirm(`Create a new revision of #${sub.submittalNumber}? It starts as a draft (Rev ${sub.revision + 1}).`)) return;
    setBusyId(sub.id);
    try { await api.post(`/submittals/${sub.id}/revise`, {}); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }
  async function remove(sub) {
    if (!confirm(`Delete submittal #${sub.submittalNumber} Rev ${sub.revision}?`)) return;
    setBusyId(sub.id);
    try { await api.delete(`/submittals/${sub.id}`); await load(); }
    catch (err) { alert(err.message); } finally { setBusyId(null); }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { submittals, canSubmit, canReview, dispositions, members } = data;
  const isStaff = user.role === "admin" || user.role === "staff";

  return (
    <div>
      {canSubmit && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span className="text-sm text-steel">Submittal register for this project.</span>
          <button className="btn btn-gold" onClick={() => setModal({})}>+ New Submittal</button>
        </div>
      )}

      {submittals.length === 0 ? (
        <div className="card"><div className="empty-state">
          <h3>No submittals yet</h3>
          <p className="text-sm">{canSubmit ? "Create one to submit a package for review." : "No submittals have been created for this project yet."}</p>
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr><th>No.</th><th>Title / Spec</th><th>Ball In Court</th><th>Due</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {submittals.map((s) => {
                const busy = busyId === s.id;
                const overdue = isOverdue(s);
                return (
                  <tr key={s.id}>
                    <td style={{ whiteSpace: "nowrap" }}><strong>#{s.submittalNumber}</strong>{s.revision ? <span className="text-steel"> Rev {s.revision}</span> : ""}</td>
                    <td>
                      <strong>{s.title}</strong>
                      {s.specSection && <div className="text-sm text-steel">Spec {s.specSection}</div>}
                      {s.status === "returned" && s.reviewNotes && <div className="text-sm" style={{ maxWidth: 320, marginTop: 4 }}><span className="text-steel">Notes:</span> {s.reviewNotes}{s.reviewedByName ? ` — ${s.reviewedByName}` : ""}</div>}
                    </td>
                    <td>{s.ballInCourtName || "—"}</td>
                    <td style={{ color: overdue ? "var(--red)" : "inherit", whiteSpace: "nowrap" }}>
                      {s.dueDate ? new Date(s.dueDate).toLocaleDateString() : "—"}
                      {overdue && <div style={{ fontSize: "0.7rem", color: "var(--red)", fontWeight: 700 }}>OVERDUE</div>}
                    </td>
                    <td><span className={`badge ${statusBadgeClass(s)}`}>{statusText(s)}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setAttachModal(s)}>📎{s.attachments && s.attachments.length ? ` (${s.attachments.length})` : ""}</button>
                        {canSubmit && s.status === "draft" && <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => transition(s, "submit")}>Submit</button>}
                        {canReview && s.status === "submitted" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition(s, "start_review")}>Start Review</button>}
                        {canReview && (s.status === "submitted" || s.status === "under_review") && <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => setReturnModal(s)}>Return</button>}
                        {canReview && s.status === "returned" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition(s, "reopen")}>Reopen</button>}
                        {canSubmit && s.status === "returned" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => revise(s)}>Revise</button>}
                        {canSubmit && s.status !== "returned" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setModal(s)}>Edit</button>}
                        {user.role === "admin" && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => remove(s)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && <SubmittalModal projectId={projectId} members={members} submittal={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {returnModal !== null && <ReturnModal submittal={returnModal} dispositions={dispositions} onClose={() => setReturnModal(null)} onSaved={() => { setReturnModal(null); load(); }} />}
      {attachModal !== null && <AttachmentsModal projectId={projectId} submittal={attachModal} onClose={() => setAttachModal(null)} onChanged={() => load()} />}
    </div>
  );
}
