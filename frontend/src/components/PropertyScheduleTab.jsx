// src/components/PropertyScheduleTab.jsx
//
// MangoDoe Facilities — Schedule tab. Deliberately NOT a reuse of
// Construction's ProjectScheduleCard/ScheduleActivitiesCard — those are
// about uploading and importing an external CPM schedule file (P6, MS
// Project), a workflow that has no equivalent in facilities operations.
// What a facilities manager actually means by "what's on the schedule" is
// a unified, date-sorted view across the three things that already carry
// dates on a Property: PM Schedules (next_due_date), Work Orders
// (scheduledDate), and Inspections (scheduledDate) — none of which had a
// single place to see them together, chronologically, before this.

import { useEffect, useState } from "react";
import { api } from "../api/client";

function daysUntil(dateStr) {
  const diff = (new Date(dateStr) - new Date(new Date().toDateString())) / 86400000;
  return Math.round(diff);
}
function urgency(dateStr, isDone) {
  if (isDone) return "done";
  const d = daysUntil(dateStr);
  if (d < 0) return "overdue";
  if (d <= 7) return "soon";
  return "later";
}
const URGENCY_BADGE = { overdue: "badge-cancelled", soon: "badge-on_hold", later: "badge-active", done: "badge-completed" };
const URGENCY_LABEL = { overdue: "overdue", soon: "this week", later: "upcoming", done: "done" };

export default function PropertyScheduleTab({ propertyId, onNavigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // all | overdue | soon

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      api.get(`/properties/${propertyId}/pm-schedules`).catch(() => ({ pmSchedules: [] })),
      api.get(`/properties/${propertyId}/work-orders`).catch(() => ({ workOrders: [] })),
      api.get(`/properties/${propertyId}/inspections`).catch(() => ({ inspections: [] })),
    ])
      .then(([pm, wo, insp]) => {
        const merged = [
          ...(pm.pmSchedules || [])
            .filter((s) => s.isActive !== false && s.nextDueDate)
            .map((s) => ({ id: s.id, kind: "PM Schedule", title: s.title, date: s.nextDueDate, done: false, tab: "workorders" })),
          ...(wo.workOrders || [])
            .filter((w) => w.scheduledDate)
            .map((w) => ({ id: w.id, kind: "Work Order", title: w.title, date: w.scheduledDate, done: w.status === "completed" || w.status === "cancelled", tab: "workorders" })),
          ...(insp.inspections || [])
            .filter((i) => i.scheduledDate)
            .map((i) => ({ id: i.id, kind: "Inspection", title: i.title, date: i.scheduledDate, done: i.status === "completed" || i.status === "cancelled", tab: "inspections" })),
        ];
        merged.sort((a, b) => new Date(a.date) - new Date(b.date));
        setItems(merged);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  if (loading) return <div className="loading-spinner" />;

  const withUrgency = items.map((it) => ({ ...it, urgency: urgency(it.date, it.done) }));
  const overdueCount = withUrgency.filter((it) => it.urgency === "overdue").length;
  const soonCount = withUrgency.filter((it) => it.urgency === "soon").length;
  const filtered = filter === "all" ? withUrgency : withUrgency.filter((it) => it.urgency === filter);

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}

      <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1rem" }}>
        <div className="stat-card"><span className="num">{overdueCount}</span><span className="label">Overdue</span></div>
        <div className="stat-card"><span className="num">{soonCount}</span><span className="label">Due This Week</span></div>
        <div className="stat-card"><span className="num">{items.length}</span><span className="label">Total Scheduled</span></div>
      </div>

      <div className="tab-row">
        <button className={`tab-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All</button>
        <button className={`tab-btn ${filter === "overdue" ? "active" : ""}`} onClick={() => setFilter("overdue")}>Overdue</button>
        <button className={`tab-btn ${filter === "soon" ? "active" : ""}`} onClick={() => setFilter("soon")}>Due This Week</button>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>Nothing scheduled</h3>
            <p className="text-sm">
              PM Schedules, Work Orders with a scheduled date, and Inspections with a scheduled date all show up here, sorted chronologically — set one up from the Work Orders or Inspections tab.
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={`${it.kind}-${it.id}`} className={onNavigate ? "clickable" : undefined} onClick={() => onNavigate && onNavigate(it.tab)}>
                  <td>{new Date(it.date).toLocaleDateString()}</td>
                  <td>{it.kind}</td>
                  <td><strong>{it.title}</strong></td>
                  <td><span className={`badge ${URGENCY_BADGE[it.urgency]}`}>{URGENCY_LABEL[it.urgency]}</span></td>
                  <td className="text-sm text-steel">{onNavigate ? `View in ${it.kind === "Inspection" ? "Inspections" : "Work Orders"} →` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
