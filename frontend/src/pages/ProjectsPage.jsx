// src/pages/ProjectsPage.jsx

import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { stageLabel } from "../config.js";

const STATUS_OPTIONS = ["planning", "active", "on_hold", "completed", "cancelled"];

// Generated placeholder: initials + a stable color derived from the name.
const THUMB_COLORS = ["#1E3D2B", "#4C7A3D", "#C9A227", "#2E6F7E", "#8A5A2B", "#5A4B8A", "#B23B3B", "#2E9E5B"];
function initialsOf(name) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return THUMB_COLORS[h % THUMB_COLORS.length];
}

function ProjectThumb({ project, size = 40 }) {
  const style = { width: size, height: size, borderRadius: 8, flexShrink: 0, objectFit: "cover" };
  if (project.photoUrl) {
    return <img src={project.photoUrl} alt="" style={style} />;
  }
  return (
    <div style={{ ...style, background: colorFor(project.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.34, letterSpacing: "0.02em" }}>
      {initialsOf(project.name)}
    </div>
  );
}

function PhotoModal({ project, onClose, onChanged }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    setError(""); setBusy(true);
    try {
      const { uploadUrl, storageKey } = await api.post(`/projects/${project.id}/photo/upload-url`, { fileName: file.name, contentType: file.type });
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload to storage failed.");
      const { photoUrl } = await api.post(`/projects/${project.id}/photo/confirm`, { storageKey });
      onChanged(project.id, { photoKey: storageKey, photoUrl });
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  async function removePhoto() {
    setBusy(true); setError("");
    try {
      await api.delete(`/projects/${project.id}/photo`);
      onChanged(project.id, { photoKey: null, photoUrl: null });
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>Project Photo</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.2rem" }}>
          <ProjectThumb project={project} size={64} />
          <div className="text-sm text-steel">{project.name}</div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
          {project.photoKey && <button className="btn btn-outline btn-sm" disabled={busy} onClick={removePhoto}>Remove</button>}
          <button className="btn btn-gold" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Working…" : project.photoKey ? "Change Photo" : "Upload Photo"}</button>
        </div>
      </div>
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    clientOrgName: "",
    status: "planning",
    startDate: "",
    targetEndDate: "",
    location: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await api.post("/projects", form);
      onCreated(data.project);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Project</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Project Name *</label>
            <input required value={form.name} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={3} value={form.description} onChange={(e) => update("description", e.target.value)} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Client / Owner Org</label>
              <input value={form.clientOrgName} onChange={(e) => update("clientOrgName", e.target.value)} />
            </div>
            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => update("status", e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Start Date</label>
              <input type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} />
            </div>
            <div className="field">
              <label>Target Completion</label>
              <input type="date" value={form.targetEndDate} onChange={(e) => update("targetEndDate", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Location</label>
            <input value={form.location} onChange={(e) => update("location", e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Creating..." : "Create Project"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isInternal = user.role === "admin" || user.role === "staff";

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [photoProject, setPhotoProject] = useState(null);

  function applyPhotoChange(projectId, patch) {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...patch } : p)));
  }

  function loadProjects() {
    setLoading(true);
    api
      .get("/projects")
      .then((data) => setProjects(data.projects))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const filtered = statusFilter === "all" ? projects : projects.filter((p) => p.status === statusFilter);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p>{isInternal ? "All projects across your organization." : "Projects you have access to."}</p>
        </div>
        {isInternal && (
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New Project</button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="tab-row">
        <button className={`tab-btn ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>All</button>
        {STATUS_OPTIONS.map((s) => (
          <button key={s} className={`tab-btn ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-spinner" />
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No projects found</h3>
            <p className="text-sm">
              {isInternal ? "Create a project to get started, or adjust your filter above." : "Nothing matches this filter."}
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>Project</th>
                <th>Client / Owner</th>
                <th>Status</th>
                <th>Start</th>
                <th>Target Completion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                  <td onClick={isInternal ? (e) => { e.stopPropagation(); setPhotoProject(p); } : undefined}
                      style={isInternal ? { cursor: "pointer" } : undefined}
                      title={isInternal ? "Set project photo" : undefined}>
                    <ProjectThumb project={p} />
                  </td>
                  <td><strong>{p.name}</strong><div className="text-sm text-steel" style={{ marginTop: 2 }}>Stage: {stageLabel(p.stage)}</div></td>
                  <td>{p.clientOrgName || "—"}</td>
                  <td><span className={`badge badge-${p.status}`}>{p.status.replace("_", " ")}</span></td>
                  <td>{p.startDate ? new Date(p.startDate).toLocaleDateString() : "—"}</td>
                  <td>{p.targetEndDate ? new Date(p.targetEndDate).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(project) => {
            setShowNew(false);
            setProjects((prev) => [project, ...prev]);
            navigate(`/projects/${project.id}`);
          }}
        />
      )}

      {photoProject && (
        <PhotoModal
          project={photoProject}
          onClose={() => setPhotoProject(null)}
          onChanged={applyPhotoChange}
        />
      )}
    </div>
  );
}
