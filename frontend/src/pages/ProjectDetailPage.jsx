// src/pages/ProjectDetailPage.jsx

import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import GanttChart from "../components/GanttChart.jsx";
import TaskModal from "../components/TaskModal.jsx";
import DocumentsTab from "../components/DocumentsTab.jsx";
import BudgetTab from "../components/BudgetTab.jsx";

function AddPhaseInline({ projectId, onAdded }) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const data = await api.post(`/projects/${projectId}/phases`, { name: name.trim() });
      onAdded(data.phase);
      setName("");
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem" }}>
      <input
        placeholder="New phase name (e.g. Design, Permitting, Construction)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" }}
      />
      <button className="btn btn-outline btn-sm" disabled={adding}>{adding ? "Adding..." : "+ Add Phase"}</button>
    </form>
  );
}

function AddMemberInline({ projectId, onAdded }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState("");
  const [membershipRole, setMembershipRole] = useState("viewer");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get("/users").then((d) => setUsers(d.users.filter((u) => u.role === "client" || u.role === "trade_partner")));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!userId) return;
    setAdding(true);
    try {
      const data = await api.post(`/projects/${projectId}/members`, { userId, membershipRole });
      const user = users.find((u) => u.id === userId);
      onAdded({
        membershipId: data.membership.id,
        membershipRole: data.membership.membership_role,
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        platformRole: user.role,
        companyName: user.companyName,
      });
      setUserId("");
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
      <select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ flex: 1, minWidth: 200, border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" }}>
        <option value="">Select a client or trade partner...</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.fullName} — {u.email} ({u.role})</option>
        ))}
      </select>
      <select value={membershipRole} onChange={(e) => setMembershipRole(e.target.value)} style={{ border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" }}>
        <option value="owner_contact">Owner Contact</option>
        <option value="project_manager">Project Manager</option>
        <option value="trade_partner">Trade Partner</option>
        <option value="viewer">Viewer</option>
      </select>
      <button className="btn btn-outline btn-sm" disabled={adding}>{adding ? "Adding..." : "+ Add to Project"}</button>
    </form>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isInternal = user.role === "admin" || user.role === "staff";

  const [project, setProject] = useState(null);
  const [phases, setPhases] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState("timeline");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [taskModal, setTaskModal] = useState(null); // null | {} (new) | task (edit)

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [projectRes, phasesRes, tasksRes, membersRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/phases`),
        api.get(`/projects/${id}/tasks`),
        api.get(`/projects/${id}/members`),
      ]);
      setProject(projectRes.project);
      setPhases(phasesRes.phases);
      setTasks(tasksRes.tasks);
      setMembers(membersRes.members);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleStatusChange(task, newStatus) {
    try {
      const data = await api.patch(`/tasks/${task.id}`, { status: newStatus });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteTask(taskId) {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!project) return null;

  const canEditTasks = isInternal;
  const canUpdateOwnTask = (task) => user.role === "trade_partner" && task.assignedTo === user.id;

  return (
    <div>
      <div className="breadcrumb"><Link to="/projects">Projects</Link> / {project.name}</div>
      <div className="page-header">
        <div>
          <h1>{project.name}</h1>
          <p>{project.clientOrgName || "—"} {project.location ? `· ${project.location}` : ""}</p>
        </div>
        <span className={`badge badge-${project.status}`} style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>
          {project.status.replace("_", " ")}
        </span>
      </div>

      {project.description && <p className="text-steel mt-1" style={{ marginBottom: "1.4rem" }}>{project.description}</p>}

      <div className="tab-row">
        <button className={`tab-btn ${tab === "timeline" ? "active" : ""}`} onClick={() => setTab("timeline")}>Timeline</button>
        <button className={`tab-btn ${tab === "tasks" ? "active" : ""}`} onClick={() => setTab("tasks")}>Tasks</button>
        <button className={`tab-btn ${tab === "phases" ? "active" : ""}`} onClick={() => setTab("phases")}>Phases</button>
        <button className={`tab-btn ${tab === "team" ? "active" : ""}`} onClick={() => setTab("team")}>Team</button>
        <button className={`tab-btn ${tab === "documents" ? "active" : ""}`} onClick={() => setTab("documents")}>Documents</button>
        {user.role !== "trade_partner" && (
          <button className={`tab-btn ${tab === "budget" ? "active" : ""}`} onClick={() => setTab("budget")}>Budget</button>
        )}
      </div>

      {tab === "timeline" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <GanttChart phases={phases} tasks={tasks} />
        </div>
      )}

      {tab === "tasks" && (
        <div>
          {canEditTasks && (
            <div className="flex-between" style={{ marginBottom: "1rem" }}>
              <span />
              <button className="btn btn-gold" onClick={() => setTaskModal({})}>+ New Task</button>
            </div>
          )}
          {tasks.length === 0 ? (
            <div className="card"><div className="empty-state"><h3>No tasks yet</h3></div></div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Assigned To</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const editable = canEditTasks || canUpdateOwnTask(task);
                    return (
                      <tr key={task.id}>
                        <td>
                          <strong>{task.title}</strong>
                          {task.isMilestone && <span className="badge" style={{ background: "rgba(201,162,39,0.15)", color: "#8a6c14", marginLeft: "0.5rem" }}>milestone</span>}
                        </td>
                        <td>{task.assignedToName || "Unassigned"}</td>
                        <td>
                          {editable ? (
                            <select
                              value={task.status}
                              onChange={(e) => handleStatusChange(task, e.target.value)}
                              style={{ border: "1px solid var(--line)", borderRadius: "4px", padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                            >
                              <option value="not_started">not started</option>
                              <option value="in_progress">in progress</option>
                              <option value="blocked">blocked</option>
                              <option value="completed">completed</option>
                            </select>
                          ) : (
                            <span className={`badge badge-${task.status}`}>{task.status.replace("_", " ")}</span>
                          )}
                        </td>
                        <td>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}</td>
                        <td>
                          {canEditTasks && (
                            <div style={{ display: "flex", gap: "0.4rem" }}>
                              <button className="btn btn-outline btn-sm" onClick={() => setTaskModal(task)}>Edit</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTask(task.id)}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "phases" && (
        <div className="card">
          {isInternal && <AddPhaseInline projectId={id} onAdded={(p) => setPhases((prev) => [...prev, p])} />}
          {phases.length === 0 ? (
            <div className="empty-state"><h3>No phases defined</h3><p className="text-sm">Phases group tasks into stages like Design, Permitting, or Construction.</p></div>
          ) : (
            <ul style={{ listStyle: "none" }}>
              {phases.map((p) => (
                <li key={p.id} style={{ padding: "0.7rem 0", borderBottom: "1px solid var(--line)" }}>
                  <strong>{p.name}</strong>
                  {(p.startDate || p.endDate) && (
                    <span className="text-steel text-sm" style={{ marginLeft: "0.6rem" }}>
                      {p.startDate ? new Date(p.startDate).toLocaleDateString() : "?"} – {p.endDate ? new Date(p.endDate).toLocaleDateString() : "?"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "team" && (
        <div className="card">
          {isInternal && <AddMemberInline projectId={id} onAdded={(m) => setMembers((prev) => [...prev, m])} />}
          {members.length === 0 ? (
            <div className="empty-state"><h3>No team members added</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Role</th><th>Company</th><th>Project Role</th></tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.membershipId}>
                    <td><strong>{m.fullName}</strong><div className="text-sm text-steel">{m.email}</div></td>
                    <td><span className="role-badge">{m.platformRole.replace("_", " ")}</span></td>
                    <td>{m.companyName || "—"}</td>
                    <td>{m.membershipRole.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "documents" && <DocumentsTab projectId={id} />}

      {tab === "budget" && user.role !== "trade_partner" && <BudgetTab projectId={id} />}

      {taskModal !== null && (
        <TaskModal
          projectId={id}
          phases={phases}
          members={members}
          task={taskModal.id ? taskModal : null}
          onClose={() => setTaskModal(null)}
          onSaved={(savedTask) => {
            setTaskModal(null);
            setTasks((prev) => {
              const exists = prev.some((t) => t.id === savedTask.id);
              return exists ? prev.map((t) => (t.id === savedTask.id ? savedTask : t)) : [...prev, savedTask];
            });
          }}
        />
      )}
    </div>
  );
}
