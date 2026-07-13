// src/components/ProjectScheduleCard.jsx
//
// The project's issued schedule, held as uploaded files with revision history.
// This isn't a scheduling engine — schedules are built in P6 / MS Project and
// issued here so the whole team knows which revision is current.
//
// Any project member can view/download. admin/staff upload new revisions.

import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectScheduleCard({ projectId, onView }) {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [schedules, setSchedules] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/projects/${projectId}/schedules`);
      setSchedules(d.schedules);
      setCanManage(d.canManage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setError("");
    setUploading(true);
    try {
      const ct = file.type || "application/octet-stream";
      const { uploadUrl, storageKey } = await api.post(`/projects/${projectId}/schedules/upload-url`, { fileName: file.name, contentType: ct });
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
      if (!put.ok) throw new Error("Upload to storage failed.");
      await api.post(`/projects/${projectId}/schedules/confirm`, {
        storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size, notes: notes.trim() || null,
      });
      setNotes("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function download(s) {
    try {
      const { downloadUrl } = await api.get(`/documents/${s.documentId}/download-url`);
      window.open(downloadUrl, "_blank");
    } catch (err) { alert(err.message); }
  }

  async function remove(s) {
    if (!confirm(`Remove schedule Rev ${s.revision} (${s.fileName})?`)) return;
    try { await api.delete(`/project-schedules/${s.id}`); await load(); }
    catch (err) { alert(err.message); }
  }

  const current = schedules[0] || null;
  const history = schedules.slice(1);

  return (
    <div className="card" style={{ marginBottom: "1.4rem" }}>
      <div className="flex-between" style={{ marginBottom: "0.8rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Project Schedule</h3>
          <p className="text-sm text-steel" style={{ marginTop: 2 }}>
            {user.orgVertical === "projects"
              ? "The current schedule or timeline document (spreadsheet, PDF, or any file). Newest revision is current."
              : "The issued schedule (from P6, MS Project, or a PDF). Newest revision is current."}
          </p>
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Revision note (optional)"
              style={{ border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.7rem", fontSize: "0.84rem", minWidth: 190 }}
            />
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onFile} />
            <button className="btn btn-gold" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : current ? "+ Upload New Revision" : "+ Upload Schedule"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading ? (
        <div className="loading-spinner" />
      ) : !current ? (
        <div className="empty-state" style={{ padding: "1.6rem 1rem" }}>
          <h3>No schedule uploaded</h3>
          <p className="text-sm">
            {canManage
              ? "Upload the current schedule so the whole team can find it."
              : "No schedule has been issued for this project yet."}
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", padding: "0.8rem 0.9rem", border: "1px solid var(--line)", borderLeft: "4px solid var(--green-deep, #2E9E5B)", borderRadius: 6, flexWrap: "wrap" }}>
            <span className="badge badge-active">Current · Rev {current.revision}</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong style={{ cursor: "pointer" }} onClick={() => onView && onView(current)}>{current.fileName}</strong>
              <div className="text-sm text-steel">
                {formatSize(current.sizeBytes)}
                {current.uploadedByName ? ` · ${current.uploadedByName}` : ""}
                {current.createdAt ? ` · ${new Date(current.createdAt).toLocaleDateString()}` : ""}
              </div>
              {current.notes && <div className="text-sm" style={{ marginTop: 2 }}>{current.notes}</div>}
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {onView && <button className="btn btn-gold btn-sm" onClick={() => onView(current)}>View</button>}
              <button className="btn btn-outline btn-sm" onClick={() => download(current)}>Download</button>
              {canManage && <button className="btn btn-danger btn-sm" onClick={() => remove(current)}>Delete</button>}
            </div>
          </div>

          {history.length > 0 && (
            <div style={{ marginTop: "0.8rem" }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowHistory((s) => !s)}>
                {showHistory ? "Hide" : "Show"} revision history ({history.length})
              </button>
              {showHistory && (
                <table className="data-table" style={{ marginTop: "0.7rem" }}>
                  <thead>
                    <tr><th>Rev</th><th>File</th><th>Uploaded By</th><th>Date</th><th></th></tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr key={s.id}>
                        <td>Rev {s.revision}</td>
                        <td>
                          <strong style={{ cursor: "pointer" }} onClick={() => onView && onView(s)}>{s.fileName}</strong>
                          {s.notes && <div className="text-sm text-steel">{s.notes}</div>}
                        </td>
                        <td>{s.uploadedByName || "—"}</td>
                        <td>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                            {onView && <button className="btn btn-outline btn-sm" onClick={() => onView(s)}>View</button>}
                            <button className="btn btn-outline btn-sm" onClick={() => download(s)}>Download</button>
                            {canManage && <button className="btn btn-danger btn-sm" onClick={() => remove(s)}>Delete</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
