// src/components/ScheduleActivitiesCard.jsx
//
// Read-only mirror of the imported schedule.
//
// Two views:
//   • 3-Week Lookahead (default) — activities in flight or starting within the
//     next 21 days. This is the view superintendents actually use each week.
//   • Full Schedule — everything, indented by WBS outline level.
//
// Bars are positioned against the schedule's own date range. This is NOT a CPM
// engine: no critical path, no float. Schedules are built in P6 / MS Project
// and mirrored here.

import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import ScheduleImportModal from "./ScheduleImportModal.jsx";

const DAY = 86400000;
const d = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`) : null);
const fmt = (iso) => (iso ? d(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

export default function ScheduleActivitiesCard({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("lookahead");
  const [importOpen, setImportOpen] = useState(false);
  const [hideSummaries, setHideSummaries] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get(`/projects/${projectId}/schedule-activities`)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function clearAll() {
    if (!confirm("Remove all imported schedule activities from this project?\n\nUploaded schedule files are not affected.")) return;
    try { await api.delete(`/projects/${projectId}/schedule-activities`); await load(); }
    catch (err) { alert(err.message); }
  }

  const all = data?.activities || [];

  // 3-week lookahead: anything overlapping [today, today + 21 days].
  const { rows, windowStart, windowEnd } = useMemo(() => {
    const base = hideSummaries ? all.filter((a) => !a.isSummary) : all;
    if (view === "all") {
      const starts = base.map((a) => d(a.startDate)).filter(Boolean);
      const ends = base.map((a) => d(a.finishDate)).filter(Boolean);
      return {
        rows: base,
        windowStart: starts.length ? new Date(Math.min(...starts)) : null,
        windowEnd: ends.length ? new Date(Math.max(...ends)) : null,
      };
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(today.getTime() + 21 * DAY);
    const rows = base.filter((a) => {
      const s = d(a.startDate), f = d(a.finishDate);
      if (!s || !f) return false;
      return f >= today && s <= end;   // overlaps the window
    });
    return { rows, windowStart: today, windowEnd: end };
  }, [all, view, hideSummaries]);

  const span = windowStart && windowEnd ? Math.max(1, (windowEnd - windowStart) / DAY) : 1;
  const pos = (a) => {
    const s = d(a.startDate), f = d(a.finishDate);
    if (!s || !f || !windowStart) return null;
    const left = Math.max(0, ((s - windowStart) / DAY / span) * 100);
    const right = Math.min(100, ((f - windowStart) / DAY / span) * 100);
    return { left, width: Math.max(1.2, right - left) };
  };

  if (loading) return <div className="card" style={{ marginBottom: "1.4rem" }}><div className="loading-spinner" /></div>;

  const canManage = data?.canManage;

  return (
    <div className="card" style={{ marginBottom: "1.4rem" }}>
      <div className="flex-between" style={{ marginBottom: "0.8rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Schedule Activities</h3>
          <p className="text-sm text-steel" style={{ marginTop: 2 }}>
            {all.length > 0
              ? <>Mirrored from your scheduling tool{data.importedByName ? ` · imported by ${data.importedByName}` : ""}{data.importedAt ? ` · ${new Date(data.importedAt).toLocaleDateString()}` : ""}</>
              : "Import a schedule to see activities and a 3-week lookahead."}
          </p>
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {all.length > 0 && <button className="btn btn-outline btn-sm" onClick={clearAll}>Clear</button>}
            <button className="btn btn-gold" onClick={() => setImportOpen(true)}>{all.length > 0 ? "Re-import Schedule" : "Import Schedule"}</button>
          </div>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {all.length === 0 ? (
        <div className="empty-state" style={{ padding: "1.6rem 1rem" }}>
          <h3>No activities imported</h3>
          <p className="text-sm">
            Export from MS Project (File → Save As → XML) or export a spreadsheet from P6, then import it here.
            The schedule stays read-only — MangoDoe doesn't calculate a critical path.
          </p>
        </div>
      ) : (
        <>
          <div className="flex-between" style={{ marginBottom: "0.7rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button className={`btn btn-sm ${view === "lookahead" ? "btn-gold" : "btn-outline"}`} onClick={() => setView("lookahead")}>3-Week Lookahead</button>
              <button className={`btn btn-sm ${view === "all" ? "btn-gold" : "btn-outline"}`} onClick={() => setView("all")}>Full Schedule</button>
            </div>
            <label className="text-sm text-steel" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input type="checkbox" checked={hideSummaries} onChange={(e) => setHideSummaries(e.target.checked)} />
              Hide summary rows
            </label>
          </div>

          {view === "lookahead" && (
            <p className="text-sm text-steel" style={{ fontSize: "0.75rem", marginBottom: "0.6rem" }}>
              {windowStart.toLocaleDateString()} – {windowEnd.toLocaleDateString()} · {rows.length} activit{rows.length === 1 ? "y" : "ies"} in flight or starting
            </p>
          )}

          {rows.length === 0 ? (
            <div className="empty-state" style={{ padding: "1.2rem" }}>
              <h3>Nothing in the next three weeks</h3>
              <p className="text-sm">Switch to Full Schedule to see everything.</p>
            </div>
          ) : (
            <div style={{ maxHeight: "58vh", overflow: "auto" }}>
              <table className="data-table" style={{ fontSize: "0.82rem" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 220 }}>Activity</th>
                    <th style={{ whiteSpace: "nowrap" }}>Start</th>
                    <th style={{ whiteSpace: "nowrap" }}>Finish</th>
                    <th>Days</th>
                    <th>%</th>
                    <th style={{ width: "38%" }}>Timeline</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const p = pos(a);
                    const done = a.percentComplete >= 100;
                    return (
                      <tr key={a.id}>
                        <td style={{ paddingLeft: view === "all" && a.outlineLevel ? (a.outlineLevel - 1) * 14 : 0 }}>
                          <span style={{ fontWeight: a.isSummary ? 700 : 400 }}>
                            {a.isMilestone ? "◆ " : ""}{a.name}
                          </span>
                          {a.wbs && <div className="text-steel" style={{ fontSize: "0.7rem" }}>{a.wbs}</div>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmt(a.startDate)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmt(a.finishDate)}</td>
                        <td>{a.durationDays ?? "—"}</td>
                        <td style={{ color: done ? "var(--green-deep, #2E9E5B)" : "inherit", fontWeight: done ? 700 : 400 }}>{a.percentComplete}%</td>
                        <td>
                          <div style={{ position: "relative", height: 14, background: "var(--paper, #f7f6f2)", borderRadius: 7, border: "1px solid var(--line)" }}>
                            {p && (
                              <div
                                title={`${fmt(a.startDate)} – ${fmt(a.finishDate)} · ${a.percentComplete}%`}
                                style={{
                                  position: "absolute", left: `${p.left}%`, width: `${p.width}%`, top: 1, bottom: 1,
                                  borderRadius: 6,
                                  background: a.isMilestone ? "var(--navy, #0B1F3A)" : "var(--line, #E2E1DA)",
                                  overflow: "hidden",
                                }}
                              >
                                <div style={{ width: `${a.percentComplete}%`, height: "100%", background: done ? "var(--green-deep, #2E9E5B)" : "var(--gold, #C9A227)" }} />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {importOpen && (
        <ScheduleImportModal
          projectId={projectId}
          existingCount={all.length}
          onClose={() => setImportOpen(false)}
          onImported={() => load()}
        />
      )}
    </div>
  );
}
