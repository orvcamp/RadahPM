// src/components/DailyLogsTab.jsx
//
// Per-project daily field reports (cards, newest first).
//   admin/staff: full edit.  trade_partner: create + edit/delete OWN logs.
//   client: view only.
// Photos upload through the same presigned-R2 flow as Documents and also
// appear in the project's Documents library.

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = {
  width: "100%",
  border: "1.5px solid var(--line)",
  borderRadius: "6px",
  padding: "0.55rem 0.8rem",
  fontSize: "0.88rem",
};
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Upload one photo to a log via the presigned-R2 flow (same pattern as Documents).
async function uploadPhoto(projectId, logId, file) {
  const ct = file.type || "application/octet-stream";
  const { uploadUrl, storageKey } = await api.post(
    `/projects/${projectId}/daily-logs/${logId}/photos/upload-url`,
    { fileName: file.name, contentType: ct }
  );
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
  if (!put.ok) throw new Error("Photo upload to storage failed.");
  const { photo } = await api.post(
    `/projects/${projectId}/daily-logs/${logId}/photos/confirm`,
    { storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size }
  );
  return photo;
}

// ---------- create / edit modal ----------
function LogModal({ projectId, log, onClose, onSaved }) {
  const isEdit = Boolean(log);
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    logDate: log?.logDate ? String(log.logDate).slice(0, 10) : todayStr(),
    weather: log?.weather || "",
    temperature: log?.temperature || "",
    workPerformed: log?.workPerformed || "",
    crewCount: log?.crewCount ?? "",
    equipment: log?.equipment || "",
    delays: log?.delays || "",
    notes: log?.notes || "",
  });
  const [existingPhotos, setExistingPhotos] = useState(log?.photos || []);
  const [pendingFiles, setPendingFiles] = useState([]); // File[]
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  function onFilesPicked(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    setPendingFiles((prev) => [...prev, ...files]);
  }

  async function detachExisting(photo) {
    if (!confirm("Remove this photo from the log? (It stays in the project's Documents.)")) return;
    try {
      await api.delete(`/daily-log-photos/${photo.id}`);
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err) { alert(err.message); }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.logDate) return setError("Please choose a log date.");
    setSaving(true);
    try {
      const payload = {
        logDate: form.logDate,
        weather: form.weather.trim() || null,
        temperature: form.temperature.trim() || null,
        workPerformed: form.workPerformed.trim() || null,
        crewCount: form.crewCount === "" ? null : form.crewCount,
        equipment: form.equipment.trim() || null,
        delays: form.delays.trim() || null,
        notes: form.notes.trim() || null,
      };
      let logId;
      if (isEdit) {
        await api.patch(`/daily-logs/${log.id}`, payload);
        logId = log.id;
      } else {
        const { log: created } = await api.post(`/projects/${projectId}/daily-logs`, payload);
        logId = created.id;
      }
      // Upload any staged photos.
      for (let i = 0; i < pendingFiles.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${pendingFiles.length}…`);
        await uploadPhoto(projectId, logId, pendingFiles[i]);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setProgress("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? "Edit Daily Log" : "New Daily Log"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {progress && <div className="success-msg">{progress}</div>}
        <form onSubmit={submit}>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem" }}>
            <div style={{ width: 180 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.logDate} onChange={(e) => set("logDate", e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Weather</label>
              <input value={form.weather} onChange={(e) => set("weather", e.target.value)} style={inputStyle} placeholder="e.g. Sunny, light wind" />
            </div>
            <div style={{ width: 120 }}>
              <label style={labelStyle}>Temp</label>
              <input value={form.temperature} onChange={(e) => set("temperature", e.target.value)} style={inputStyle} placeholder="72°F" />
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Work Performed</label>
            <textarea value={form.workPerformed} onChange={(e) => set("workPerformed", e.target.value)} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="What was done on site today…" />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem" }}>
            <div style={{ width: 140 }}>
              <label style={labelStyle}>Crew / Manpower</label>
              <input type="number" min="0" value={form.crewCount} onChange={(e) => set("crewCount", e.target.value)} style={inputStyle} placeholder="e.g. 6" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Equipment On Site</label>
              <input value={form.equipment} onChange={(e) => set("equipment", e.target.value)} style={inputStyle} placeholder="e.g. Scissor lift, generator" />
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Delays / Issues</label>
            <textarea value={form.delays} onChange={(e) => set("delays", e.target.value)} style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} placeholder="Any delays, blockers, or issues…" />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} />
          </div>

          {/* Photos */}
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={labelStyle}>Photos</label>
            {existingPhotos.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.6rem" }}>
                {existingPhotos.map((p) => (
                  <div key={p.id} style={{ position: "relative" }}>
                    {p.viewUrl
                      ? <img src={p.viewUrl} alt={p.fileName} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                      : <div style={{ width: 64, height: 64, borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "var(--steel)" }}>file</div>}
                    <button type="button" onClick={() => detachExisting(p)} title="Remove" style={{ position: "absolute", top: -6, right: -6, background: "var(--red)", color: "white", border: "none", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: "0.7rem", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {pendingFiles.length > 0 && (
              <p className="text-sm text-steel" style={{ marginBottom: "0.5rem" }}>{pendingFiles.length} photo(s) ready to upload on save.</p>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFilesPicked} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>+ Add Photos</button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Create Log"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- one field on a log card ----------
function Field({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--steel)" }}>{label}</div>
      <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  );
}

export default function DailyLogsTab({ projectId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // null | {} | log

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/projects/${projectId}/daily-logs`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function remove(log) {
    if (!confirm(`Delete the daily log for ${new Date(log.logDate).toLocaleDateString()}?`)) return;
    try {
      await api.delete(`/daily-logs/${log.id}`);
      await load();
    } catch (err) { alert(err.message); }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { canCreate, logs } = data;

  return (
    <div>
      {canCreate && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span className="text-sm text-steel">Field reports for this project. {user.role === "trade_partner" && "You can edit the logs you author."}</span>
          <button className="btn btn-gold" onClick={() => setModal({})}>+ New Daily Log</button>
        </div>
      )}

      {logs.length === 0 ? (
        <div className="card"><div className="empty-state">
          <h3>No daily logs yet</h3>
          <p className="text-sm">{canCreate ? "Record site conditions, work performed, crew, and photos." : "No field reports have been logged for this project yet."}</p>
        </div></div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="card" style={{ marginBottom: "1rem" }}>
            <div className="flex-between" style={{ marginBottom: "0.8rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <h3 style={{ fontSize: "1rem" }}>{new Date(log.logDate).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</h3>
                <div className="text-sm text-steel">
                  {log.createdByName || "Unknown"}
                  {(log.weather || log.temperature) && ` · ${[log.weather, log.temperature].filter(Boolean).join(", ")}`}
                  {log.crewCount != null && ` · ${log.crewCount} crew`}
                </div>
              </div>
              {log.canEdit && (
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setModal(log)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(log)}>Delete</button>
                </div>
              )}
            </div>

            <Field label="Work Performed" value={log.workPerformed} />
            <Field label="Equipment On Site" value={log.equipment} />
            <Field label="Delays / Issues" value={log.delays} />
            <Field label="Notes" value={log.notes} />

            {log.photos && log.photos.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.6rem" }}>
                {log.photos.map((p) => (
                  p.viewUrl ? (
                    <a key={p.id} href={p.viewUrl} target="_blank" rel="noreferrer">
                      <img src={p.viewUrl} alt={p.fileName} style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                    </a>
                  ) : (
                    <div key={p.id} style={{ width: 88, height: 88, borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", color: "var(--steel)" }}>{p.fileName}</div>
                  )
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {modal !== null && (
        <LogModal
          projectId={projectId}
          log={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
