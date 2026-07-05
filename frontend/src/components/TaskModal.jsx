// src/components/TaskModal.jsx

import { useState } from "react";
import { api } from "../api/client";

const STATUS_OPTIONS = ["not_started", "in_progress", "blocked", "completed"];

export default function TaskModal({ projectId, phases, members, task, onClose, onSaved }) {
  const isEdit = Boolean(task);
  const [form, setForm] = useState({
    title: task?.title || "",
    description: task?.description || "",
    phaseId: task?.phaseId || "",
    status: task?.status || "not_started",
    isMilestone: task?.isMilestone || false,
    startDate: task?.startDate ? task.startDate.slice(0, 10) : "",
    dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : "",
    assignedTo: task?.assignedTo || "",
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

    const payload = {
      ...form,
      phaseId: form.phaseId || null,
      assignedTo: form.assignedTo || null,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
    };

    try {
      if (isEdit) {
        const data = await api.patch(`/tasks/${task.id}`, payload);
        onSaved(data.task);
      } else {
        const data = await api.post(`/projects/${projectId}/tasks`, payload);
        onSaved(data.task);
      }
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
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>
            {isEdit ? "Edit Task" : "New Task"}
          </h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Title *</label>
            <input required value={form.title} onChange={(e) => update("title", e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={2} value={form.description} onChange={(e) => update("description", e.target.value)} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Phase</label>
              <select value={form.phaseId} onChange={(e) => update("phaseId", e.target.value)}>
                <option value="">Unphased</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
              <label>Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => update("dueDate", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Assign To</label>
            <select value={form.assignedTo} onChange={(e) => update("assignedTo", e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.fullName} ({m.platformRole})</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: "0.6rem" }}>
            <input
              type="checkbox"
              id="isMilestone"
              checked={form.isMilestone}
              onChange={(e) => update("isMilestone", e.target.checked)}
              style={{ width: "auto" }}
            />
            <label htmlFor="isMilestone" style={{ textTransform: "none", fontWeight: 500 }}>This is a milestone</label>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Task"}
          </button>
        </form>
      </div>
    </div>
  );
}
