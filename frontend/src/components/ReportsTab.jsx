// src/components/ReportsTab.jsx
//
// Read-only reports over existing project data: status summary, budget vs
// actual, RFI log, submittal log, daily log rollup. Each can be exported to
// PDF or Excel. Same visibility as Budget/Change Orders: admin/staff and
// project-member clients only — trade partners don't see cost data.

import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";

const REPORT_TYPES = [
  { key: "status-summary", label: "Status Summary" },
  { key: "budget-vs-actual", label: "Budget vs. Actual" },
  { key: "rfi-log", label: "RFI Log" },
  { key: "submittal-log", label: "Submittal Log" },
  { key: "daily-log-rollup", label: "Daily Log Rollup" },
];

function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const cardStyle = { marginBottom: "1rem" };
const statGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.8rem" };
const statBox = { padding: "0.8rem 1rem", background: "var(--paper, #f7f6f2)", borderRadius: 8, border: "1px solid var(--line)" };
const statLabel = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--steel)", marginBottom: "0.25rem" };
const statValue = { fontSize: "1.3rem", fontWeight: 700, color: "var(--navy, #0B1F3A)" };

function Stat({ label, value }) {
  return (
    <div style={statBox}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  );
}

// ---------- individual report bodies ----------

function StatusSummaryView({ data }) {
  return (
    <>
      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase", marginBottom: "0.7rem" }}>Tasks</h3>
        <div style={statGrid}>
          <Stat label="Total" value={data.tasks.total} />
          <Stat label="Completed" value={data.tasks.completed} />
          <Stat label="In Progress" value={data.tasks.inProgress} />
          <Stat label="Blocked" value={data.tasks.blocked} />
          <Stat label="Not Started" value={data.tasks.notStarted} />
        </div>
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase", marginBottom: "0.7rem" }}>Budget</h3>
        <div style={statGrid}>
          <Stat label="Budgeted" value={fmtMoney(data.budget.totals.budgetedCents)} />
          <Stat label="Committed" value={fmtMoney(data.budget.totals.committedCents)} />
          <Stat label="Actual" value={fmtMoney(data.budget.totals.actualCents)} />
          <Stat label="Remaining" value={fmtMoney(data.budget.totals.remainingCents)} />
        </div>
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase", marginBottom: "0.7rem" }}>Change Orders</h3>
        <div style={statGrid}>
          <Stat label="Draft" value={data.changeOrders.draft} />
          <Stat label="Submitted" value={data.changeOrders.submitted} />
          <Stat label="Approved" value={data.changeOrders.approved} />
          <Stat label="Rejected" value={data.changeOrders.rejected} />
          <Stat label="Net Approved Impact" value={fmtMoney(data.changeOrders.netApprovedCostImpactCents)} />
        </div>
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase", marginBottom: "0.7rem" }}>RFIs</h3>
        <div style={statGrid}>
          <Stat label="Open" value={data.rfis.open} />
          <Stat label="Answered" value={data.rfis.answered} />
          <Stat label="Closed" value={data.rfis.closed} />
          <Stat label="Total" value={data.rfis.total} />
        </div>
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase", marginBottom: "0.7rem" }}>Submittals</h3>
        <div style={statGrid}>
          <Stat label="Draft" value={data.submittals.draft} />
          <Stat label="Submitted" value={data.submittals.submitted} />
          <Stat label="Under Review" value={data.submittals.underReview} />
          <Stat label="Returned" value={data.submittals.returned} />
          <Stat label="Total" value={data.submittals.total} />
        </div>
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase", marginBottom: "0.7rem" }}>Daily Logs</h3>
        <div style={statGrid}>
          <Stat label="Total Logs" value={data.dailyLogs.total} />
          <Stat label="Most Recent" value={data.dailyLogs.lastLogDate ? new Date(data.dailyLogs.lastLogDate).toLocaleDateString() : "—"} />
        </div>
      </div>
    </>
  );
}

function BudgetVsActualView({ data }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th style={{ textAlign: "right" }}>Budgeted</th>
            <th style={{ textAlign: "right" }}>Committed</th>
            <th style={{ textAlign: "right" }}>Actual</th>
            <th style={{ textAlign: "right" }}>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {data.categories.map((c) => (
            <tr key={c.id || "uncategorized"}>
              <td><strong>{c.name}</strong></td>
              <td style={{ textAlign: "right" }}>{fmtMoney(c.budgetedCents)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(c.committedCents)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(c.actualCents)}</td>
              <td style={{ textAlign: "right", color: c.remainingCents < 0 ? "var(--red)" : "inherit" }}>{fmtMoney(c.remainingCents)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "var(--paper, #f7f6f2)" }}>
            <td>TOTAL</td>
            <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.budgetedCents)}</td>
            <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.committedCents)}</td>
            <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.actualCents)}</td>
            <td style={{ textAlign: "right", color: data.totals.remainingCents < 0 ? "var(--red)" : "inherit" }}>{fmtMoney(data.totals.remainingCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const RFI_STATUS_BADGE = { open: "badge-in_progress", answered: "badge-active", closed: "badge-completed" };

function RfiLogView({ data }) {
  if (data.length === 0) return <div className="card"><div className="empty-state"><h3>No RFIs yet</h3></div></div>;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="data-table">
        <thead>
          <tr><th>#</th><th>Subject</th><th>Status</th><th>Due</th><th>Assigned To</th><th>Answered By</th></tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.rfiNumber}>
              <td><strong>#{r.rfiNumber}</strong></td>
              <td>{r.subject}</td>
              <td><span className={`badge ${RFI_STATUS_BADGE[r.status] || ""}`}>{r.status}</span></td>
              <td>{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</td>
              <td>{r.assignedToName || "—"}</td>
              <td>{r.answeredByName || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SUBMITTAL_STATUS_BADGE = { draft: "badge-not_started", submitted: "badge-in_progress", under_review: "badge-in_progress", returned: "badge-completed" };

function SubmittalLogView({ data }) {
  if (data.length === 0) return <div className="card"><div className="empty-state"><h3>No submittals yet</h3></div></div>;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="data-table">
        <thead>
          <tr><th>#</th><th>Title</th><th>Spec Section</th><th>Status</th><th>Disposition</th><th>Due</th></tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={`${s.submittalNumber}.${s.revision}`}>
              <td><strong>{s.submittalNumber}{s.revision ? `.${s.revision}` : ""}</strong></td>
              <td>{s.title}</td>
              <td>{s.specSection || "—"}</td>
              <td><span className={`badge ${SUBMITTAL_STATUS_BADGE[s.status] || ""}`}>{s.status.replace("_", " ")}</span></td>
              <td>{s.disposition ? s.disposition.replace(/_/g, " ") : "—"}</td>
              <td>{s.dueDate ? new Date(s.dueDate).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyLogRollupView({ data, from, to, setFrom, setTo, onFilter }) {
  return (
    <>
      <div className="card" style={cardStyle}>
        <div className="flex-between" style={{ marginBottom: "0.8rem", flexWrap: "wrap", gap: "0.6rem" }}>
          <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase" }}>Date Range</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.4rem 0.6rem", fontSize: "0.85rem" }} />
            <span className="text-sm text-steel">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.4rem 0.6rem", fontSize: "0.85rem" }} />
            <button className="btn btn-outline btn-sm" onClick={onFilter}>Apply</button>
          </div>
        </div>
        <div style={statGrid}>
          <Stat label="Logs in Range" value={data.totals.logCount} />
          <Stat label="Weather Delay Days" value={data.totals.weatherDelayDays} />
          <Stat label="Safety Incident Days" value={data.totals.safetyIncidentDays} />
          <Stat label="Total Manpower" value={data.totals.totalManpowerWorkers} />
        </div>
      </div>

      {data.manpowerByTrade.length > 0 && (
        <div className="card" style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead><tr><th>Trade</th><th style={{ textAlign: "right" }}>Total Workers</th><th style={{ textAlign: "right" }}>Total Hours</th></tr></thead>
            <tbody>
              {data.manpowerByTrade.map((t) => (
                <tr key={t.trade}>
                  <td><strong>{t.trade}</strong></td>
                  <td style={{ textAlign: "right" }}>{t.totalWorkers}</td>
                  <td style={{ textAlign: "right" }}>{t.totalHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.logs.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No daily logs in this range</h3></div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Weather</th><th>Crew</th><th>Wx Delay</th><th>Work Performed</th></tr>
            </thead>
            <tbody>
              {data.logs.map((l, i) => (
                <tr key={i}>
                  <td>{new Date(l.logDate).toLocaleDateString()}</td>
                  <td>{l.weather || "—"}</td>
                  <td>{l.crewCount ?? "—"}</td>
                  <td>{l.weatherDelay ? "Yes" : "No"}</td>
                  <td style={{ maxWidth: 340 }}>{l.workPerformed || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- main tab ----------

export default function ReportsTab({ projectId }) {
  const [reportType, setReportType] = useState("status-summary");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(null); // "pdf" | "xlsx" | null
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = reportType === "daily-log-rollup"
        ? `?${[from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&")}`
        : "";
      const d = await api.get(`/projects/${projectId}/reports/${reportType}${qs}`);
      setPayload(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, reportType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function exportReport(format) {
    setExporting(format);
    try {
      const qs = new URLSearchParams({ type: reportType, format });
      if (reportType === "daily-log-rollup") {
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
      }
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
      const token = localStorage.getItem("radah_pm_token");
      const res = await fetch(`${API_URL}/projects/${projectId}/reports/export?${qs.toString()}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const fileName = match ? match[1] : `report.${format}`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <div className="tab-row" style={{ marginBottom: 0, borderBottom: "none" }}>
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt.key}
              className={`tab-btn ${reportType === rt.key ? "active" : ""}`}
              onClick={() => setReportType(rt.key)}
            >
              {rt.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-outline btn-sm" disabled={exporting !== null || loading} onClick={() => exportReport("pdf")}>
            {exporting === "pdf" ? "Exporting…" : "Export PDF"}
          </button>
          <button className="btn btn-outline btn-sm" disabled={exporting !== null || loading} onClick={() => exportReport("xlsx")}>
            {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      </div>

      {loading && <div className="loading-spinner" />}
      {error && <div className="error-msg">{error}</div>}

      {!loading && !error && payload && payload.reportType === reportType && (
        <>
          {reportType === "status-summary" && <StatusSummaryView data={payload.data} />}
          {reportType === "budget-vs-actual" && <BudgetVsActualView data={payload.data} />}
          {reportType === "rfi-log" && <RfiLogView data={payload.data} />}
          {reportType === "submittal-log" && <SubmittalLogView data={payload.data} />}
          {reportType === "daily-log-rollup" && (
            <DailyLogRollupView data={payload.data} from={from} to={to} setFrom={setFrom} setTo={setTo} onFilter={load} />
          )}
        </>
      )}
    </div>
  );
}
