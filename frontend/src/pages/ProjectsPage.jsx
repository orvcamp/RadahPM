// src/pages/ProjectsPage.jsx

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_OPTIONS = ["planning", "active", "on_hold", "completed", "cancelled"];

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
          <p>{isInternal ? "All projects across RADAH's portfolio." : "Projects you have access to."}</p>
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
                  <td><strong>{p.name}</strong></td>
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
    </div>
  );
}
