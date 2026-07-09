// src/pages/ProjectDetailPage.jsx

import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import GanttChart from "../components/GanttChart.jsx";
import TaskModal from "../components/TaskModal.jsx";
import DocumentsTab from "../components/DocumentsTab.jsx";
import BudgetTab from "../components/BudgetTab.jsx";
import ChangeOrdersTab from "../components/ChangeOrdersTab.jsx";
import BillingTab from "../components/BillingTab.jsx";
import DailyLogsTab from "../components/DailyLogsTab.jsx";
import RfisTab from "../components/RfisTab.jsx";
import SubmittalsTab from "../components/SubmittalsTab.jsx";
import ProjectScheduleCard from "../components/ProjectScheduleCard.jsx";
import ScheduleActivitiesCard from "../components/ScheduleActivitiesCard.jsx";
import TrashTab from "../components/TrashTab.jsx";
import LogsTab from "../components/LogsTab.jsx";
import ReportsTab from "../components/ReportsTab.jsx";
import DocumentViewerModal from "../components/DocumentViewerModal.jsx";
import { STAGES, stageIndex, TAB_GROUPS, TAB_LABELS, isStageRelevant } from "../config.js";

// Horizontal lifecycle stage tracker. Admin/staff can advance/step back.
function StageStepper({ project, canEdit, onChange }) {
  const idx = stageIndex(project.stage);
  const [busy, setBusy] = useState(false);
  async function setStage(key) {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api.patch(`/projects/${project.id}/stage`, { stage: key });
      onChange(d.project);
    } catch (err) { alert(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ marginBottom: "1.4rem", padding: "1rem 1.1rem" }}>
      <div className="flex-between" style={{ marginBottom: "0.7rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <span className="text-sm text-steel" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>Project Stage</span>
        {canEdit && (
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button className="btn btn-outline btn-sm" disabled={busy || idx === 0} onClick={() => setStage(STAGES[idx - 1].key)}>← Back</button>
            <button className="btn btn-gold btn-sm" disabled={busy || idx >= STAGES.length - 1} onClick={() => setStage(STAGES[idx + 1].key)}>Advance →</button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, overflowX: "auto" }}>
        {STAGES.map((s, i) => {
          const done = i < idx, current = i === idx;
          const dot = done ? "var(--green-deep, #2E9E5B)" : current ? "var(--gold, #C9A227)" : "var(--line, #E2E1DA)";
          const txt = current ? "var(--navy, #0B1F3A)" : done ? "var(--green-deep, #2E9E5B)" : "var(--steel, #6b7280)";
          return (
            <div key={s.key} style={{ flex: 1, minWidth: 92, textAlign: "center", position: "relative", cursor: canEdit ? "pointer" : "default" }}
                 onClick={canEdit ? () => setStage(s.key) : undefined} title={canEdit ? `Set stage: ${s.label}` : s.label}>
              {i > 0 && <div style={{ position: "absolute", left: "-50%", top: 9, width: "100%", height: 2, background: i <= idx ? "var(--green-deep, #2E9E5B)" : "var(--line, #E2E1DA)" }} />}
              <div style={{ position: "relative", width: 20, height: 20, borderRadius: "50%", background: dot, margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                {done ? "✓" : current ? "●" : ""}
              </div>
              <div style={{ fontSize: "0.72rem", fontWeight: current ? 700 : 400, color: txt, lineHeight: 1.2 }}>{s.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
    <>
      {users.length === 0 && (
        <div className="text-sm text-steel" style={{ marginBottom: "0.8rem", padding: "0.7rem 0.9rem", background: "var(--paper, #f7f6f2)", borderRadius: 6, border: "1px solid var(--line)" }}>
          No client or trade-partner users exist yet. Create them on the <strong>Users</strong> page first — internal staff already have access to every project, so only external members are added here.
        </div>
      )}
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
        <button className="btn btn-outline btn-sm" disabled={adding || !userId}>{adding ? "Adding..." : "+ Add to Project"}</button>
      </form>
    </>
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
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "timeline";
  const [tab, setTab] = useState(initialTab);
  const [modules, setModules] = useState(null); // enabled capability modules for this org

  useEffect(() => {
    api.get("/my-modules").then((d) => setModules(d.modules)).catch(() => setModules(null));
  }, []);
  // default-show a module unless we know it's disabled
  const modOn = (key) => !modules || modules[key] !== false;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [taskModal, setTaskModal] = useState(null); // null | {} (new) | task (edit)
  const [viewSchedule, setViewSchedule] = useState(null); // schedule doc being previewed

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

      <StageStepper project={project} canEdit={isInternal} onChange={(p) => setProject(p)} />

      {(() => {
        // A tab is visible if its module is on and the role allows it.
        const tabVisible = (key) => {
          if (key === "documents") return modOn("documents");
          if (key === "budget") return user.role !== "trade_partner" && modOn("budget");
          if (key === "changeorders") return user.role !== "trade_partner" && modOn("changeorders");
          if (key === "billing") return user.role !== "trade_partner" && modOn("billing");
          if (key === "dailylogs") return modOn("dailylogs");
          if (key === "rfis") return modOn("rfis");
          if (key === "submittals") return modOn("submittals");
          if (key === "logs") return modOn("logs");
          if (key === "reports") return user.role !== "trade_partner" && modOn("reports");
          if (key === "trash") return user.role === "admin";
          return true; // timeline, tasks, phases, team
        };
        return (
          <div style={{ marginBottom: "1.4rem" }}>
            {TAB_GROUPS.map((group) => {
              const visible = group.tabs.filter(tabVisible);
              if (visible.length === 0) return null;
              return (
                <div key={group.key} style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--steel, #6b7280)", minWidth: 74 }}>
                    {group.label}
                  </span>
                  <div className="tab-row" style={{ marginBottom: 0, borderBottom: "none", flex: 1 }}>
                    {visible.map((key) => {
                      const relevant = isStageRelevant(project.stage, key);
                      return (
                        <button
                          key={key}
                          className={`tab-btn ${tab === key ? "active" : ""}`}
                          onClick={() => setTab(key)}
                          title={relevant ? `Relevant at the current stage` : undefined}
                        >
                          {TAB_LABELS[key]}
                          {relevant && (
                            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--gold, #C9A227)", marginLeft: 6, verticalAlign: "middle" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <p className="text-sm text-steel" style={{ marginTop: "0.4rem", fontSize: "0.74rem" }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--gold, #C9A227)", marginRight: 5, verticalAlign: "middle" }} />
              Most relevant at the current stage. Everything stays accessible.
            </p>
          </div>
        );
      })()}

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
        <>
          <ProjectScheduleCard projectId={id} onView={(s) => setViewSchedule({ id: s.documentId, fileName: s.fileName, contentType: s.contentType })} />

          <ScheduleActivitiesCard projectId={id} />
          <div className="card">
            <h3 style={{ fontSize: "1rem", textTransform: "uppercase", marginBottom: "0.3rem" }}>Phases</h3>
            <p className="text-sm text-steel" style={{ marginBottom: "0.9rem" }}>
              High-level buckets used to group tasks on the timeline (e.g. Sitework, Framing, Finishes).
              These are not a CPM schedule — the issued schedule lives above.
            </p>
            {isInternal && <AddPhaseInline projectId={id} onAdded={(p) => setPhases((prev) => [...prev, p])} />}
            {phases.length === 0 ? (
              <div className="empty-state"><h3>No phases yet</h3><p className="text-sm">Add phases to group tasks on the timeline. This is separate from the project <strong>Stage</strong> tracker above, which shows where the whole job is right now.</p></div>
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
        </>
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

      {tab === "documents" && modOn("documents") && <DocumentsTab projectId={id} />}

      {tab === "budget" && user.role !== "trade_partner" && modOn("budget") && <BudgetTab projectId={id} />}

      {tab === "changeorders" && user.role !== "trade_partner" && modOn("changeorders") && <ChangeOrdersTab projectId={id} />}

      {tab === "billing" && user.role !== "trade_partner" && modOn("billing") && <BillingTab projectId={id} />}

      {tab === "dailylogs" && modOn("dailylogs") && <DailyLogsTab projectId={id} />}

      {tab === "rfis" && modOn("rfis") && <RfisTab projectId={id} />}

      {tab === "submittals" && modOn("submittals") && <SubmittalsTab projectId={id} />}

      {tab === "logs" && modOn("logs") && <LogsTab projectId={id} />}

      {tab === "reports" && user.role !== "trade_partner" && modOn("reports") && <ReportsTab projectId={id} />}

      {tab === "trash" && user.role === "admin" && <TrashTab projectId={id} />}

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

      {viewSchedule && (
        <DocumentViewerModal doc={viewSchedule} onClose={() => setViewSchedule(null)} />
      )}
    </div>
  );
}
