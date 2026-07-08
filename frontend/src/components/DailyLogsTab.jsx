// src/components/DailyLogsTab.jsx
//
// Comprehensive construction daily log: site times, weather (with delay flag),
// structured manpower, work performed + next-day look-ahead, deliveries,
// visitors, inspections, safety, issues, notes, and attachments of any type
// (images render as thumbnails). Logs can be emailed to the project team.
//
// admin/staff: full access. trade_partner: create + edit their own.
// client: view only. Delete is admin-only (soft delete, recoverable).

import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const inputStyle = {
  width: "100%",
  border: "1.5px solid var(--line)",
  borderRadius: 6,
  padding: "0.55rem 0.8rem",
  fontSize: "0.88rem",
};
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };
const sectionStyle = { borderTop: "1px solid var(--line)", marginTop: "1.1rem", paddingTop: "0.9rem" };
const sectionTitle = { fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold, #C9A227)", fontWeight: 700, marginBottom: "0.6rem" };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Upload one attachment (any file type) to a log via the presigned-R2 flow.
async function uploadAttachment(projectId, logId, file) {
  const ct = file.type || "application/octet-stream";
  const { uploadUrl, storageKey } = await api.post(
    `/projects/${projectId}/daily-logs/${logId}/photos/upload-url`,
    { fileName: file.name, contentType: ct }
  );
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
  if (!put.ok) throw new Error("Attachment upload to storage failed.");
  const { photo } = await api.post(
    `/projects/${projectId}/daily-logs/${logId}/photos/confirm`,
    { storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size }
  );
  return photo;
}

const EMPTY_MANPOWER = { company: "", trade: "", workers: "", hours: "", notes: "" };

// ---------- create / edit modal ----------
function LogModal({ projectId, log, onClose, onSaved }) {
  const isEdit = Boolean(log);
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    logDate: log?.logDate ? String(log.logDate).slice(0, 10) : todayStr(),
    timeOnSite: log?.timeOnSite ? String(log.timeOnSite).slice(0, 5) : "",
    timeOffSite: log?.timeOffSite ? String(log.timeOffSite).slice(0, 5) : "",
    weather: log?.weather || "",
    temperature: log?.temperature || "",
    tempHigh: log?.tempHigh ?? "",
    tempLow: log?.tempLow ?? "",
    precipitation: log?.precipitation || "",
    wind: log?.wind || "",
    weatherDelay: log?.weatherDelay || false,
    workPerformed: log?.workPerformed || "",
    plannedWork: log?.plannedWork || "",
    crewCount: log?.crewCount ?? "",
    equipment: log?.equipment || "",
    deliveries: log?.deliveries || "",
    visitors: log?.visitors || "",
    inspections: log?.inspections || "",
    safetyIncidents: log?.safetyIncidents || "",
    safetyObservations: log?.safetyObservations || "",
    toolboxTalk: log?.toolboxTalk || "",
    delays: log?.delays || "",
    notes: log?.notes || "",
  });
  const [manpower, setManpower] = useState(log?.manpower?.length ? log.manpower.map((m) => ({ ...m, workers: m.workers ?? "", hours: m.hours ?? "" })) : [{ ...EMPTY_MANPOWER }]);
  const [existingAttachments, setExistingAttachments] = useState(log?.attachments || log?.photos || []);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setMp = (i, k, v) => setManpower((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addMpRow = () => setManpower((rows) => [...rows, { ...EMPTY_MANPOWER }]);
  const removeMpRow = (i) => setManpower((rows) => (rows.length === 1 ? [{ ...EMPTY_MANPOWER }] : rows.filter((_, idx) => idx !== i)));

  const totalWorkers = manpower.reduce((sum, r) => sum + (Number(r.workers) || 0), 0);

  function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    setPendingFiles((p) => [...p, ...files]);
  }
  async function detach(a) {
    if (!confirm(`Remove "${a.fileName}" from this log?`)) return;
    try {
      await api.delete(`/daily-log-photos/${a.id}`);
      setExistingAttachments((p) => p.filter((x) => x.id !== a.id));
    } catch (err) { alert(err.message); }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.logDate) return setError("Please choose a date.");
    setSaving(true);
    try {
      const cleanedManpower = manpower
        .filter((r) => (r.company || r.trade || r.workers || r.hours || r.notes))
        .map((r) => ({
          company: r.company || null,
          trade: r.trade || null,
          workers: r.workers === "" ? 0 : Number(r.workers),
          hours: r.hours === "" ? null : Number(r.hours),
          notes: r.notes || null,
        }));

      const payload = { ...form, manpower: cleanedManpower };

      let logId;
      if (isEdit) {
        await api.patch(`/daily-logs/${log.id}`, payload);
        logId = log.id;
      } else {
        const { log: created } = await api.post(`/projects/${projectId}/daily-logs`, payload);
        logId = created.id;
      }
      for (let i = 0; i < pendingFiles.length; i++) {
        setProgress(`Uploading attachment ${i + 1} of ${pendingFiles.length}…`);
        await uploadAttachment(projectId, logId, pendingFiles[i]);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setProgress("");
    }
  }

  const ta = { ...inputStyle, minHeight: 58, resize: "vertical" };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780, width: "94vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? "Edit Daily Log" : "New Daily Log"}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {progress && <div className="success-msg">{progress}</div>}

        <form onSubmit={submit}>
          {/* --- Day --- */}
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            <div style={{ width: 170 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.logDate} onChange={(e) => set("logDate", e.target.value)} style={inputStyle} />
            </div>
            <div style={{ width: 150 }}>
              <label style={labelStyle}>Time On Site</label>
              <input type="time" value={form.timeOnSite} onChange={(e) => set("timeOnSite", e.target.value)} style={inputStyle} />
            </div>
            <div style={{ width: 150 }}>
              <label style={labelStyle}>Time Off Site</label>
              <input type="time" value={form.timeOffSite} onChange={(e) => set("timeOffSite", e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* --- Weather --- */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Weather</div>
            <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={labelStyle}>Conditions</label>
                <input value={form.weather} onChange={(e) => set("weather", e.target.value)} style={inputStyle} placeholder="e.g. Overcast, light wind" />
              </div>
              <div style={{ width: 100 }}>
                <label style={labelStyle}>High °</label>
                <input type="number" value={form.tempHigh} onChange={(e) => set("tempHigh", e.target.value)} style={inputStyle} placeholder="78" />
              </div>
              <div style={{ width: 100 }}>
                <label style={labelStyle}>Low °</label>
                <input type="number" value={form.tempLow} onChange={(e) => set("tempLow", e.target.value)} style={inputStyle} placeholder="61" />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.7rem", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={labelStyle}>Precipitation</label>
                <input value={form.precipitation} onChange={(e) => set("precipitation", e.target.value)} style={inputStyle} placeholder="e.g. 0.2 in rain, AM" />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={labelStyle}>Wind</label>
                <input value={form.wind} onChange={(e) => set("wind", e.target.value)} style={inputStyle} placeholder="e.g. 10–15 mph NW" />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.86rem", marginTop: "1.1rem", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={!!form.weatherDelay} onChange={(e) => set("weatherDelay", e.target.checked)} />
                Weather delay
              </label>
            </div>
          </div>

          {/* --- Manpower --- */}
          <div style={sectionStyle}>
            <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
              <div style={sectionTitle}>Manpower {totalWorkers > 0 && <span style={{ color: "var(--steel)", fontWeight: 400 }}>· {totalWorkers} total</span>}</div>
              <button type="button" className="btn btn-outline btn-sm" onClick={addMpRow}>+ Add Row</button>
            </div>
            {manpower.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.45rem", flexWrap: "wrap", alignItems: "center" }}>
                <input value={r.company} onChange={(e) => setMp(i, "company", e.target.value)} style={{ ...inputStyle, flex: 2, minWidth: 130 }} placeholder="Company" />
                <input value={r.trade} onChange={(e) => setMp(i, "trade", e.target.value)} style={{ ...inputStyle, flex: 2, minWidth: 120 }} placeholder="Trade" />
                <input type="number" min="0" value={r.workers} onChange={(e) => setMp(i, "workers", e.target.value)} style={{ ...inputStyle, width: 90 }} placeholder="Workers" />
                <input type="number" min="0" step="0.25" value={r.hours} onChange={(e) => setMp(i, "hours", e.target.value)} style={{ ...inputStyle, width: 90 }} placeholder="Hours" />
                <button type="button" className="btn btn-outline btn-sm" onClick={() => removeMpRow(i)} title="Remove row">×</button>
              </div>
            ))}
            <div style={{ marginTop: "0.6rem", width: 160 }}>
              <label style={labelStyle}>Crew Count (total)</label>
              <input type="number" min="0" value={form.crewCount} onChange={(e) => set("crewCount", e.target.value)} style={inputStyle} placeholder={totalWorkers || "e.g. 6"} />
            </div>
          </div>

          {/* --- Work --- */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Work</div>
            <label style={labelStyle}>Work Performed Today</label>
            <textarea value={form.workPerformed} onChange={(e) => set("workPerformed", e.target.value)} style={{ ...ta, minHeight: 76 }} placeholder="What was completed on site today…" />
            <div style={{ marginTop: "0.7rem" }}>
              <label style={labelStyle}>Planned Work / Look-Ahead</label>
              <textarea value={form.plannedWork} onChange={(e) => set("plannedWork", e.target.value)} style={ta} placeholder="What's planned for tomorrow / the next few days…" />
            </div>
            <div style={{ marginTop: "0.7rem" }}>
              <label style={labelStyle}>Equipment On Site</label>
              <input value={form.equipment} onChange={(e) => set("equipment", e.target.value)} style={inputStyle} placeholder="e.g. Scissor lift, generator" />
            </div>
          </div>

          {/* --- Site activity --- */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Site Activity</div>
            <label style={labelStyle}>Deliveries Received</label>
            <textarea value={form.deliveries} onChange={(e) => set("deliveries", e.target.value)} style={ta} placeholder="Materials/equipment delivered, supplier, quantity…" />
            <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Visitors On Site</label>
                <textarea value={form.visitors} onChange={(e) => set("visitors", e.target.value)} style={ta} placeholder="Name, company, purpose…" />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Inspections</label>
                <textarea value={form.inspections} onChange={(e) => set("inspections", e.target.value)} style={ta} placeholder="Inspector, scope, result…" />
              </div>
            </div>
          </div>

          {/* --- Safety --- */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Safety</div>
            <label style={labelStyle}>Safety Incidents</label>
            <textarea value={form.safetyIncidents} onChange={(e) => set("safetyIncidents", e.target.value)} style={ta} placeholder="Injuries, near misses, property damage — or 'None'…" />
            <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Safety Observations</label>
                <textarea value={form.safetyObservations} onChange={(e) => set("safetyObservations", e.target.value)} style={ta} placeholder="Hazards spotted, corrections made…" />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Toolbox Talk / JHA</label>
                <textarea value={form.toolboxTalk} onChange={(e) => set("toolboxTalk", e.target.value)} style={ta} placeholder="Topic covered, who attended…" />
              </div>
            </div>
          </div>

          {/* --- Issues & notes --- */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Issues &amp; Notes</div>
            <label style={labelStyle}>Delays / Issues</label>
            <textarea value={form.delays} onChange={(e) => set("delays", e.target.value)} style={ta} placeholder="Blockers, RFIs pending, access issues…" />
            <div style={{ marginTop: "0.7rem" }}>
              <label style={labelStyle}>Notes</label>
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} style={ta} />
            </div>
          </div>

          {/* --- Attachments --- */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Attachments</div>
            {existingAttachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.6rem" }}>
                {existingAttachments.map((a) => (
                  <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "0.35rem", textAlign: "center", width: 108 }}>
                    {a.isImage && a.viewUrl ? (
                      <img src={a.viewUrl} alt={a.fileName} style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 4 }} />
                    ) : (
                      <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem" }}>📄</div>
                    )}
                    <div className="text-sm" style={{ fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.fileName}</div>
                    <button type="button" onClick={() => detach(a)} style={{ border: "none", background: "none", color: "var(--red)", cursor: "pointer", fontSize: "0.72rem" }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            {pendingFiles.length > 0 && <p className="text-sm text-steel" style={{ marginBottom: "0.5rem" }}>{pendingFiles.length} file(s) ready to upload on save.</p>}
            <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={pickFiles} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>+ Add Photos or Files</button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.3rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save Log" : "Create Log"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: "0.55rem" }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--steel)" }}>{label}</div>
      <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  );
}

// ---------- email modal ----------
function EmailLogModal({ projectId, log, onClose }) {
  const [recipients, setRecipients] = useState("");
  const [note, setNote] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get(`/projects/${projectId}/members`);
        if (!active) return;
        setRecipients((d.members || []).map((m) => m.email).filter(Boolean).join(", "));
      } catch { /* leave blank */ } finally {
        if (active) setLoadingTeam(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  async function send() {
    setError("");
    const list = recipients.split(/[,\n;]+/).map((e) => e.trim()).filter(Boolean);
    if (list.length === 0) return setError("Add at least one recipient email.");
    setSending(true);
    try {
      const r = await api.post(`/projects/${projectId}/daily-logs/${log.id}/email`, { recipients: list, note: note.trim() || null });
      setDone(r.message || "Email sent.");
    } catch (err) { setError(err.message); } finally { setSending(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Email Daily Log</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {done ? (
          <>
            <div className="success-msg">{done}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-gold" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>
              {new Date(log.logDate).toLocaleDateString()} · pre-filled with the project team — edit as needed.
            </p>
            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>Recipients (comma-separated)</label>
              <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} placeholder={loadingTeam ? "Loading team…" : "name@example.com"} />
            </div>
            <div style={{ marginBottom: "1.2rem" }}>
              <label style={labelStyle}>Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} placeholder="Add a short message at the top of the email…" />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn btn-gold" disabled={sending} onClick={send}>{sending ? "Sending…" : "Send Email"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DailyLogsTab({ projectId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [emailLog, setEmailLog] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get(`/projects/${projectId}/daily-logs`)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function remove(log) {
    if (!confirm(`Delete the daily log for ${new Date(log.logDate).toLocaleDateString()}?\n\nIt moves to Deleted Items and can be restored by an admin.`)) return;
    try { await api.delete(`/daily-logs/${log.id}`); await load(); }
    catch (err) { alert(err.message); }
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
          <p className="text-sm">{canCreate ? "Record site times, weather, manpower, work performed, and attachments." : "No field reports have been logged for this project yet."}</p>
        </div></div>
      ) : (
        logs.map((log) => {
          const times = [log.timeOnSite, log.timeOffSite].filter(Boolean).map((t) => String(t).slice(0, 5)).join(" – ");
          const weatherBits = [log.weather, log.temperature, [log.tempHigh, log.tempLow].filter((x) => x != null).join("/"), log.precipitation, log.wind].filter(Boolean).join(", ");
          const totalWorkers = (log.manpower || []).reduce((s, m) => s + (m.workers || 0), 0);
          const attachments = log.attachments || log.photos || [];
          return (
            <div key={log.id} className="card" style={{ marginBottom: "1rem" }}>
              <div className="flex-between" style={{ marginBottom: "0.8rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <h3 style={{ fontSize: "1rem" }}>
                    {new Date(log.logDate).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
                    {log.weatherDelay && <span className="badge badge-cancelled" style={{ marginLeft: "0.6rem" }}>Weather Delay</span>}
                  </h3>
                  <div className="text-sm text-steel">
                    {log.createdByName || "Unknown"}
                    {times && ` · on site ${times}`}
                    {weatherBits && ` · ${weatherBits}`}
                    {(totalWorkers > 0 || log.crewCount != null) && ` · ${totalWorkers || log.crewCount} crew`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEmailLog(log)}>Email</button>
                  {log.canEdit && <button className="btn btn-outline btn-sm" onClick={() => setModal(log)}>Edit</button>}
                  {user.role === "admin" && <button className="btn btn-danger btn-sm" onClick={() => remove(log)}>Delete</button>}
                </div>
              </div>

              {log.manpower && log.manpower.length > 0 && (
                <div style={{ marginBottom: "0.7rem" }}>
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--steel)", marginBottom: "0.25rem" }}>Manpower</div>
                  <table className="data-table" style={{ fontSize: "0.84rem" }}>
                    <thead><tr><th>Company</th><th>Trade</th><th>Workers</th><th>Hours</th></tr></thead>
                    <tbody>
                      {log.manpower.map((m) => (
                        <tr key={m.id}>
                          <td>{m.company || "—"}</td>
                          <td>{m.trade || "—"}</td>
                          <td>{m.workers}</td>
                          <td>{m.hours ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Field label="Work Performed" value={log.workPerformed} />
              <Field label="Planned Work / Look-Ahead" value={log.plannedWork} />
              <Field label="Equipment On Site" value={log.equipment} />
              <Field label="Deliveries Received" value={log.deliveries} />
              <Field label="Visitors On Site" value={log.visitors} />
              <Field label="Inspections" value={log.inspections} />
              <Field label="Safety Incidents" value={log.safetyIncidents} />
              <Field label="Safety Observations" value={log.safetyObservations} />
              <Field label="Toolbox Talk / JHA" value={log.toolboxTalk} />
              <Field label="Delays / Issues" value={log.delays} />
              <Field label="Notes" value={log.notes} />

              {attachments.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.6rem" }}>
                  {attachments.map((a) => (
                    <a key={a.id} href={a.viewUrl || "#"} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                      <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "0.35rem", textAlign: "center", width: 108 }}>
                        {a.isImage && a.viewUrl ? (
                          <img src={a.viewUrl} alt={a.fileName} style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 4 }} />
                        ) : (
                          <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem" }}>📄</div>
                        )}
                        <div style={{ fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.fileName}</div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {modal !== null && (
        <LogModal
          projectId={projectId}
          log={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {emailLog && (
        <EmailLogModal projectId={projectId} log={emailLog} onClose={() => setEmailLog(null)} />
      )}
    </div>
  );
}
