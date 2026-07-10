// backend/routes/reports.js
//
// Read-only reporting across a project's existing data. No new tables — this
// module aggregates budget, change orders, RFIs, submittals, tasks, and daily
// logs into report views, and can export any of them as PDF or Excel.
//
// Report types:
//   status-summary    — project snapshot: tasks, budget, change orders, RFIs,
//                        submittals, daily log activity in one view
//   budget-vs-actual  — budgeted / committed / actual / remaining by category
//   rfi-log           — every RFI, for a printable register
//   submittal-log     — every submittal (all revisions), for a printable register
//   daily-log-rollup  — daily log activity over a date range, with a
//                        manpower-by-trade breakdown
//
// Visibility mirrors Budget / Change Orders: admin/staff full access,
// client (project member) read-only, trade_partner has no access at all —
// reports surface cost data trade partners should never see.

const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { userCanAccessProject } = require("./projects");
const { requireModule } = require("../orgModules");

const router = express.Router();

// --- org-isolation guard (Phase 3 A2) ---
function guardProject(req, res, next) {
  if (req.user.role === "trade_partner") {
    return res.status(403).json({ error: "You do not have access to reports." });
  }
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}

// ---------- money helpers ----------
function centsOf(v) {
  return v === null || v === undefined ? 0 : Number(v);
}
function dollars(cents) {
  const n = centsOf(cents);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dollarsNum(cents) {
  return Math.round(centsOf(cents)) / 100;
}

// ============================================================
// DATA BUILDERS — shared by the on-screen endpoints and export
// ============================================================

async function getProjectHeader(projectId) {
  const r = await pool.query(
    `SELECT id, name, client_org_name, status, stage, start_date, target_end_date, location
       FROM projects WHERE id = $1`,
    [projectId]
  );
  const p = r.rows[0];
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    clientOrgName: p.client_org_name,
    status: p.status,
    stage: p.stage,
    startDate: p.start_date,
    targetEndDate: p.target_end_date,
    location: p.location,
  };
}

async function getBudgetVsActual(projectId) {
  const [catsRes, linesRes] = await Promise.all([
    pool.query(
      "SELECT id, name, sort_order FROM budget_categories WHERE project_id = $1 ORDER BY sort_order ASC, name ASC",
      [projectId]
    ),
    pool.query(
      `SELECT l.category_id, l.budgeted_amount_cents,
              COALESCE(cm.committed, 0) AS committed_cents,
              COALESCE(ex.actual, 0) AS actual_cents
         FROM budget_lines l
         LEFT JOIN (
           SELECT budget_line_id, SUM(committed_amount_cents) AS committed
             FROM budget_commitments
            WHERE status = 'open' AND budget_line_id IS NOT NULL
            GROUP BY budget_line_id
         ) cm ON cm.budget_line_id = l.id
         LEFT JOIN (
           SELECT budget_line_id, SUM(amount_cents) AS actual
             FROM budget_expenses
            WHERE budget_line_id IS NOT NULL
            GROUP BY budget_line_id
         ) ex ON ex.budget_line_id = l.id
        WHERE l.project_id = $1`,
      [projectId]
    ),
  ]);

  const byCategory = {};
  for (const c of catsRes.rows) {
    byCategory[c.id] = { id: c.id, name: c.name, budgetedCents: 0, committedCents: 0, actualCents: 0 };
  }
  let uncategorized = null;
  for (const l of linesRes.rows) {
    let bucket = l.category_id ? byCategory[l.category_id] : null;
    if (!bucket) {
      if (!uncategorized) uncategorized = { id: null, name: "Uncategorized", budgetedCents: 0, committedCents: 0, actualCents: 0 };
      bucket = uncategorized;
    }
    bucket.budgetedCents += centsOf(l.budgeted_amount_cents);
    bucket.committedCents += centsOf(l.committed_cents);
    bucket.actualCents += centsOf(l.actual_cents);
  }
  const categories = Object.values(byCategory);
  if (uncategorized) categories.push(uncategorized);
  for (const c of categories) c.remainingCents = c.budgetedCents - c.committedCents - c.actualCents;

  const totals = categories.reduce(
    (acc, c) => {
      acc.budgetedCents += c.budgetedCents;
      acc.committedCents += c.committedCents;
      acc.actualCents += c.actualCents;
      return acc;
    },
    { budgetedCents: 0, committedCents: 0, actualCents: 0 }
  );
  totals.remainingCents = totals.budgetedCents - totals.committedCents - totals.actualCents;

  return { categories, totals };
}

async function getStatusSummary(projectId) {
  const [taskRes, coRes, rfiRes, subRes, logRes, budget] = await Promise.all([
    pool.query("SELECT status FROM tasks WHERE project_id = $1", [projectId]),
    pool.query(
      "SELECT status, cost_impact_cents FROM change_orders WHERE project_id = $1 AND deleted_at IS NULL",
      [projectId]
    ),
    pool.query("SELECT status FROM rfis WHERE project_id = $1 AND deleted_at IS NULL", [projectId]),
    pool.query("SELECT status FROM submittals WHERE project_id = $1 AND deleted_at IS NULL", [projectId]),
    pool.query(
      "SELECT log_date FROM daily_logs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY log_date DESC LIMIT 1",
      [projectId]
    ),
    getBudgetVsActual(projectId),
  ]);
  const logCountRes = await pool.query(
    "SELECT COUNT(*)::int AS n FROM daily_logs WHERE project_id = $1 AND deleted_at IS NULL",
    [projectId]
  );

  const tasks = { total: taskRes.rows.length, notStarted: 0, inProgress: 0, blocked: 0, completed: 0 };
  for (const t of taskRes.rows) {
    if (t.status === "not_started") tasks.notStarted++;
    else if (t.status === "in_progress") tasks.inProgress++;
    else if (t.status === "blocked") tasks.blocked++;
    else if (t.status === "completed") tasks.completed++;
  }

  const changeOrders = { draft: 0, submitted: 0, approved: 0, rejected: 0, netApprovedCostImpactCents: 0 };
  for (const co of coRes.rows) {
    if (co.status === "draft") changeOrders.draft++;
    else if (co.status === "submitted") changeOrders.submitted++;
    else if (co.status === "approved") { changeOrders.approved++; changeOrders.netApprovedCostImpactCents += centsOf(co.cost_impact_cents); }
    else if (co.status === "rejected") changeOrders.rejected++;
  }

  const rfis = { open: 0, answered: 0, closed: 0, total: rfiRes.rows.length };
  for (const r of rfiRes.rows) {
    if (r.status === "open") rfis.open++;
    else if (r.status === "answered") rfis.answered++;
    else if (r.status === "closed") rfis.closed++;
  }

  const submittals = { draft: 0, submitted: 0, underReview: 0, returned: 0, total: subRes.rows.length };
  for (const s of subRes.rows) {
    if (s.status === "draft") submittals.draft++;
    else if (s.status === "submitted") submittals.submitted++;
    else if (s.status === "under_review") submittals.underReview++;
    else if (s.status === "returned") submittals.returned++;
  }

  return {
    tasks,
    changeOrders,
    rfis,
    submittals,
    budget: { totals: budget.totals },
    dailyLogs: { total: logCountRes.rows[0].n, lastLogDate: logRes.rows[0] ? logRes.rows[0].log_date : null },
  };
}

async function getRfiLog(projectId) {
  const r = await pool.query(
    `SELECT rf.*, au.full_name AS assigned_to_name, anu.full_name AS answered_by_name
       FROM rfis rf
       LEFT JOIN users au ON au.id = rf.assigned_to
       LEFT JOIN users anu ON anu.id = rf.answered_by
      WHERE rf.project_id = $1 AND rf.deleted_at IS NULL
      ORDER BY rf.rfi_number ASC`,
    [projectId]
  );
  return r.rows.map((row) => ({
    rfiNumber: row.rfi_number,
    subject: row.subject,
    status: row.status,
    dueDate: row.due_date,
    assignedToName: row.assigned_to_name,
    answeredByName: row.answered_by_name,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
  }));
}

async function getSubmittalLog(projectId) {
  const r = await pool.query(
    `SELECT s.*, ru.full_name AS reviewed_by_name
       FROM submittals s
       LEFT JOIN users ru ON ru.id = s.reviewed_by
      WHERE s.project_id = $1 AND s.deleted_at IS NULL
      ORDER BY s.submittal_number ASC, s.revision ASC`,
    [projectId]
  );
  return r.rows.map((row) => ({
    submittalNumber: row.submittal_number,
    revision: row.revision,
    title: row.title,
    specSection: row.spec_section,
    status: row.status,
    disposition: row.disposition,
    dueDate: row.due_date,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  }));
}

async function getDailyLogRollup(projectId, from, to) {
  const params = [projectId];
  let dateClause = "";
  if (from) { params.push(from); dateClause += ` AND log_date >= $${params.length}`; }
  if (to) { params.push(to); dateClause += ` AND log_date <= $${params.length}`; }

  const logsRes = await pool.query(
    `SELECT dl.*, cu.full_name AS created_by_name
       FROM daily_logs dl
       LEFT JOIN users cu ON cu.id = dl.created_by
      WHERE dl.project_id = $1 AND dl.deleted_at IS NULL ${dateClause}
      ORDER BY dl.log_date ASC`,
    params
  );
  const logIds = logsRes.rows.map((r) => r.id);
  let manpower = [];
  if (logIds.length > 0) {
    const mpRes = await pool.query(
      `SELECT trade, company, workers, hours FROM daily_log_manpower WHERE daily_log_id = ANY($1::uuid[])`,
      [logIds]
    );
    manpower = mpRes.rows;
  }

  const logs = logsRes.rows.map((row) => ({
    logDate: row.log_date,
    weather: row.weather,
    tempHigh: row.temp_high,
    tempLow: row.temp_low,
    weatherDelay: row.weather_delay,
    crewCount: row.crew_count,
    workPerformed: row.work_performed,
    delays: row.delays,
    safetyIncidents: row.safety_incidents,
    createdByName: row.created_by_name,
  }));

  const byTrade = {};
  for (const m of manpower) {
    const key = m.trade || "Unspecified";
    if (!byTrade[key]) byTrade[key] = { trade: key, totalWorkers: 0, totalHours: 0 };
    byTrade[key].totalWorkers += Number(m.workers) || 0;
    byTrade[key].totalHours += Number(m.hours) || 0;
  }

  const totals = {
    logCount: logs.length,
    weatherDelayDays: logs.filter((l) => l.weatherDelay).length,
    safetyIncidentDays: logs.filter((l) => l.safetyIncidents && l.safetyIncidents.trim()).length,
    totalManpowerWorkers: Object.values(byTrade).reduce((s, t) => s + t.totalWorkers, 0),
  };

  return { from: from || null, to: to || null, logs, manpowerByTrade: Object.values(byTrade), totals };
}

const REPORT_TITLES = {
  "status-summary": "Project Status Summary",
  "budget-vs-actual": "Budget vs. Actual",
  "rfi-log": "RFI Log",
  "submittal-log": "Submittal Log",
  "daily-log-rollup": "Daily Log Rollup",
};

async function buildReportData(type, projectId, { from, to } = {}) {
  if (type === "status-summary") return getStatusSummary(projectId);
  if (type === "budget-vs-actual") return getBudgetVsActual(projectId);
  if (type === "rfi-log") return getRfiLog(projectId);
  if (type === "submittal-log") return getSubmittalLog(projectId);
  if (type === "daily-log-rollup") return getDailyLogRollup(projectId, from, to);
  return null;
}

// ============================================================
// ON-SCREEN ENDPOINTS
// GET /api/projects/:projectId/reports/status-summary
// GET /api/projects/:projectId/reports/budget-vs-actual
// GET /api/projects/:projectId/reports/rfi-log
// GET /api/projects/:projectId/reports/submittal-log
// GET /api/projects/:projectId/reports/daily-log-rollup?from=&to=
// ============================================================
for (const type of Object.keys(REPORT_TITLES)) {
  router.get(
    `/projects/:projectId/reports/${type}`,
    requireAuth,
    requireModule("reports"),
    guardProject,
    async (req, res) => {
      try {
        const project = await getProjectHeader(req.params.projectId);
        if (!project) return res.status(404).json({ error: "Project not found." });
        const { from, to } = req.query;
        const data = await buildReportData(type, req.params.projectId, { from, to });
        res.json({ project, reportType: type, title: REPORT_TITLES[type], generatedAt: new Date().toISOString(), data });
      } catch (err) {
        console.error(`[radah-pm] report (${type}) error:`, err);
        res.status(500).json({ error: "Something went wrong building that report." });
      }
    }
  );
}

// ============================================================
// EXPORT
// GET /api/projects/:projectId/reports/export?type=...&format=pdf|xlsx&from=&to=
// ============================================================
router.get(
  "/projects/:projectId/reports/export",
  requireAuth,
  requireModule("reports"),
  guardProject,
  async (req, res) => {
    const { type, format, from, to } = req.query;
    if (!REPORT_TITLES[type]) {
      return res.status(400).json({ error: "Unknown report type." });
    }
    if (format !== "pdf" && format !== "xlsx") {
      return res.status(400).json({ error: "format must be 'pdf' or 'xlsx'." });
    }
    try {
      const project = await getProjectHeader(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      const data = await buildReportData(type, req.params.projectId, { from, to });
      const fileBase = `${project.name.replace(/[^a-zA-Z0-9._-]/g, "_")}-${type}`;

      if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.pdf"`);
        renderPdf(res, type, project, data);
      } else {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.xlsx"`);
        await renderXlsx(res, type, project, data);
      }
    } catch (err) {
      console.error(`[radah-pm] report export (${req.query.type}, ${req.query.format}) error:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Something went wrong generating that export." });
      } else {
        res.end();
      }
    }
  }
);

// ============================================================
// PDF rendering (pdfkit) — one function per report type.
// ============================================================
function pdfHeader(doc, project, title) {
  doc.fontSize(18).fillColor("#0B1F3A").text(title, { align: "left" });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor("#333333").text(project.name);
  if (project.clientOrgName) doc.text(project.clientOrgName);
  doc.fontSize(9).fillColor("#6b7280").text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);
  doc.strokeColor("#E2E1DA").moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fillColor("#000000");
}

function pdfSectionTitle(doc, text) {
  doc.moveDown(0.6);
  doc.fontSize(13).fillColor("#0B1F3A").text(text);
  doc.fontSize(10).fillColor("#000000");
  doc.moveDown(0.2);
}

function pdfKeyValueRow(doc, label, value) {
  doc.fontSize(10).fillColor("#6b7280").text(label, { continued: true, width: 220 });
  doc.fillColor("#000000").text(`  ${value}`);
}

function pdfTable(doc, columns, rows) {
  // columns: [{ header, width, align }]
  const startX = doc.page.margins.left;
  let y = doc.y;
  const rowHeight = 18;

  function drawHeader() {
    let x = startX;
    doc.fontSize(9).fillColor("#ffffff");
    doc.rect(startX, y, columns.reduce((s, c) => s + c.width, 0), rowHeight).fill("#0B1F3A");
    doc.fillColor("#ffffff");
    for (const c of columns) {
      doc.text(c.header, x + 4, y + 5, { width: c.width - 8, align: c.align || "left" });
      x += c.width;
    }
    y += rowHeight;
    doc.fillColor("#000000");
  }

  drawHeader();
  let i = 0;
  for (const row of rows) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    const isTotal = Boolean(row.__total);
    if (isTotal) {
      // Bold total row with a top border, no zebra shading — mirrors the
      // bold TOTAL row already used in the Excel export of this report,
      // so PDF and Excel line up visually.
      const tableWidth = columns.reduce((s, c) => s + c.width, 0);
      doc.strokeColor("#0B1F3A").lineWidth(1)
        .moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    } else if (i % 2 === 1) {
      doc.rect(startX, y, columns.reduce((s, c) => s + c.width, 0), rowHeight).fill("#F7F6F2");
      doc.fillColor("#000000");
    }
    let x = startX;
    doc.fontSize(9).fillColor("#1a1a1a").font(isTotal ? "Helvetica-Bold" : "Helvetica");
    for (const c of columns) {
      const val = row[c.key] === null || row[c.key] === undefined ? "—" : String(row[c.key]);
      doc.text(val, x + 4, y + 5, { width: c.width - 8, align: c.align || "left" });
      x += c.width;
    }
    y += rowHeight;
    i++;
  }
  doc.y = y + 10;
}

function renderPdf(res, type, project, data) {
  const doc = new PDFDocument({ margin: 40, size: "LETTER" });
  doc.pipe(res);
  const title = REPORT_TITLES[type];
  pdfHeader(doc, project, title);

  if (type === "status-summary") {
    pdfSectionTitle(doc, "Tasks");
    pdfKeyValueRow(doc, "Total", data.tasks.total);
    pdfKeyValueRow(doc, "Completed", data.tasks.completed);
    pdfKeyValueRow(doc, "In Progress", data.tasks.inProgress);
    pdfKeyValueRow(doc, "Blocked", data.tasks.blocked);
    pdfKeyValueRow(doc, "Not Started", data.tasks.notStarted);

    pdfSectionTitle(doc, "Budget");
    pdfKeyValueRow(doc, "Budgeted", dollars(data.budget.totals.budgetedCents));
    pdfKeyValueRow(doc, "Committed", dollars(data.budget.totals.committedCents));
    pdfKeyValueRow(doc, "Actual", dollars(data.budget.totals.actualCents));
    pdfKeyValueRow(doc, "Remaining", dollars(data.budget.totals.remainingCents));

    pdfSectionTitle(doc, "Change Orders");
    pdfKeyValueRow(doc, "Draft", data.changeOrders.draft);
    pdfKeyValueRow(doc, "Submitted", data.changeOrders.submitted);
    pdfKeyValueRow(doc, "Approved", data.changeOrders.approved);
    pdfKeyValueRow(doc, "Rejected", data.changeOrders.rejected);
    pdfKeyValueRow(doc, "Net Approved Cost Impact", dollars(data.changeOrders.netApprovedCostImpactCents));

    pdfSectionTitle(doc, "RFIs");
    pdfKeyValueRow(doc, "Open", data.rfis.open);
    pdfKeyValueRow(doc, "Answered", data.rfis.answered);
    pdfKeyValueRow(doc, "Closed", data.rfis.closed);
    pdfKeyValueRow(doc, "Total", data.rfis.total);

    pdfSectionTitle(doc, "Submittals");
    pdfKeyValueRow(doc, "Draft", data.submittals.draft);
    pdfKeyValueRow(doc, "Submitted", data.submittals.submitted);
    pdfKeyValueRow(doc, "Under Review", data.submittals.underReview);
    pdfKeyValueRow(doc, "Returned", data.submittals.returned);
    pdfKeyValueRow(doc, "Total", data.submittals.total);

    pdfSectionTitle(doc, "Daily Logs");
    pdfKeyValueRow(doc, "Total Logs", data.dailyLogs.total);
    pdfKeyValueRow(doc, "Most Recent", data.dailyLogs.lastLogDate ? new Date(data.dailyLogs.lastLogDate).toLocaleDateString() : "—");
  }

  if (type === "budget-vs-actual") {
    pdfTable(
      doc,
      [
        { key: "name", header: "Category", width: 180 },
        { key: "budgeted", header: "Budgeted", width: 95, align: "right" },
        { key: "committed", header: "Committed", width: 95, align: "right" },
        { key: "actual", header: "Actual", width: 95, align: "right" },
        { key: "remaining", header: "Remaining", width: 95, align: "right" },
      ],
      [
        ...data.categories.map((c) => ({
          name: c.name,
          budgeted: dollars(c.budgetedCents),
          committed: dollars(c.committedCents),
          actual: dollars(c.actualCents),
          remaining: dollars(c.remainingCents),
        })),
        {
          __total: true,
          name: "Totals",
          budgeted: dollars(data.totals.budgetedCents),
          committed: dollars(data.totals.committedCents),
          actual: dollars(data.totals.actualCents),
          remaining: dollars(data.totals.remainingCents),
        },
      ]
    );
  }

  if (type === "rfi-log") {
    pdfTable(
      doc,
      [
        { key: "num", header: "#", width: 35 },
        { key: "subject", header: "Subject", width: 210 },
        { key: "status", header: "Status", width: 75 },
        { key: "due", header: "Due", width: 75 },
        { key: "assigned", header: "Assigned To", width: 100 },
      ],
      data.map((r) => ({
        num: r.rfiNumber,
        subject: r.subject,
        status: r.status,
        due: r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—",
        assigned: r.assignedToName || "—",
      }))
    );
  }

  if (type === "submittal-log") {
    pdfTable(
      doc,
      [
        { key: "num", header: "#", width: 55 },
        { key: "title", header: "Title", width: 190 },
        { key: "spec", header: "Spec Section", width: 90 },
        { key: "status", header: "Status", width: 80 },
        { key: "disposition", header: "Disposition", width: 80 },
      ],
      data.map((s) => ({
        num: `${s.submittalNumber}${s.revision ? `.${s.revision}` : ""}`,
        title: s.title,
        spec: s.specSection || "—",
        status: s.status.replace("_", " "),
        disposition: s.disposition ? s.disposition.replace(/_/g, " ") : "—",
      }))
    );
  }

  if (type === "daily-log-rollup") {
    pdfSectionTitle(doc, "Summary");
    pdfKeyValueRow(doc, "Logs in range", data.totals.logCount);
    pdfKeyValueRow(doc, "Weather delay days", data.totals.weatherDelayDays);
    pdfKeyValueRow(doc, "Days with safety incidents", data.totals.safetyIncidentDays);
    pdfKeyValueRow(doc, "Total manpower (worker-entries)", data.totals.totalManpowerWorkers);

    if (data.manpowerByTrade.length > 0) {
      pdfSectionTitle(doc, "Manpower by Trade");
      pdfTable(
        doc,
        [
          { key: "trade", header: "Trade", width: 200 },
          { key: "workers", header: "Total Workers", width: 120, align: "right" },
          { key: "hours", header: "Total Hours", width: 120, align: "right" },
        ],
        data.manpowerByTrade.map((t) => ({ trade: t.trade, workers: t.totalWorkers, hours: t.totalHours }))
      );
    }

    pdfSectionTitle(doc, "Daily Logs");
    pdfTable(
      doc,
      [
        { key: "date", header: "Date", width: 75 },
        { key: "weather", header: "Weather", width: 90 },
        { key: "crew", header: "Crew", width: 45, align: "right" },
        { key: "delay", header: "Wx Delay", width: 60 },
        { key: "work", header: "Work Performed", width: 190 },
      ],
      data.logs.map((l) => ({
        date: new Date(l.logDate).toLocaleDateString(),
        weather: l.weather || "—",
        crew: l.crewCount ?? "—",
        delay: l.weatherDelay ? "Yes" : "No",
        work: (l.workPerformed || "—").slice(0, 90),
      }))
    );
  }

  doc.end();
}

// ============================================================
// Excel rendering (exceljs) — one sheet per report type.
// ============================================================
async function renderXlsx(res, type, project, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MangoDoe";
  wb.created = new Date();

  function styledHeader(sheet, row) {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
    });
  }

  if (type === "status-summary") {
    const sheet = wb.addWorksheet("Status Summary");
    sheet.columns = [{ header: "Metric", key: "metric", width: 32 }, { header: "Value", key: "value", width: 24 }];
    styledHeader(sheet, sheet.getRow(1));
    const rows = [
      ["Project", project.name],
      ["Stage", project.stage],
      [],
      ["Tasks — Total", data.tasks.total],
      ["Tasks — Completed", data.tasks.completed],
      ["Tasks — In Progress", data.tasks.inProgress],
      ["Tasks — Blocked", data.tasks.blocked],
      ["Tasks — Not Started", data.tasks.notStarted],
      [],
      ["Budget — Budgeted", dollarsNum(data.budget.totals.budgetedCents)],
      ["Budget — Committed", dollarsNum(data.budget.totals.committedCents)],
      ["Budget — Actual", dollarsNum(data.budget.totals.actualCents)],
      ["Budget — Remaining", dollarsNum(data.budget.totals.remainingCents)],
      [],
      ["Change Orders — Draft", data.changeOrders.draft],
      ["Change Orders — Submitted", data.changeOrders.submitted],
      ["Change Orders — Approved", data.changeOrders.approved],
      ["Change Orders — Rejected", data.changeOrders.rejected],
      ["Change Orders — Net Approved Cost Impact", dollarsNum(data.changeOrders.netApprovedCostImpactCents)],
      [],
      ["RFIs — Open", data.rfis.open],
      ["RFIs — Answered", data.rfis.answered],
      ["RFIs — Closed", data.rfis.closed],
      ["RFIs — Total", data.rfis.total],
      [],
      ["Submittals — Draft", data.submittals.draft],
      ["Submittals — Submitted", data.submittals.submitted],
      ["Submittals — Under Review", data.submittals.underReview],
      ["Submittals — Returned", data.submittals.returned],
      ["Submittals — Total", data.submittals.total],
      [],
      ["Daily Logs — Total", data.dailyLogs.total],
      ["Daily Logs — Most Recent", data.dailyLogs.lastLogDate ? new Date(data.dailyLogs.lastLogDate).toLocaleDateString() : "—"],
    ];
    for (const r of rows) sheet.addRow(r);
  }

  if (type === "budget-vs-actual") {
    const sheet = wb.addWorksheet("Budget vs Actual");
    sheet.columns = [
      { header: "Category", key: "name", width: 28 },
      { header: "Budgeted", key: "budgeted", width: 16 },
      { header: "Committed", key: "committed", width: 16 },
      { header: "Actual", key: "actual", width: 16 },
      { header: "Remaining", key: "remaining", width: 16 },
    ];
    styledHeader(sheet, sheet.getRow(1));
    for (const c of data.categories) {
      sheet.addRow({
        name: c.name,
        budgeted: dollarsNum(c.budgetedCents),
        committed: dollarsNum(c.committedCents),
        actual: dollarsNum(c.actualCents),
        remaining: dollarsNum(c.remainingCents),
      });
    }
    const totalRow = sheet.addRow({
      name: "TOTAL",
      budgeted: dollarsNum(data.totals.budgetedCents),
      committed: dollarsNum(data.totals.committedCents),
      actual: dollarsNum(data.totals.actualCents),
      remaining: dollarsNum(data.totals.remainingCents),
    });
    totalRow.font = { bold: true };
    sheet.getColumn("budgeted").numFmt = "$#,##0.00";
    sheet.getColumn("committed").numFmt = "$#,##0.00";
    sheet.getColumn("actual").numFmt = "$#,##0.00";
    sheet.getColumn("remaining").numFmt = "$#,##0.00";
  }

  if (type === "rfi-log") {
    const sheet = wb.addWorksheet("RFI Log");
    sheet.columns = [
      { header: "RFI #", key: "num", width: 8 },
      { header: "Subject", key: "subject", width: 40 },
      { header: "Status", key: "status", width: 14 },
      { header: "Due Date", key: "due", width: 14 },
      { header: "Assigned To", key: "assigned", width: 20 },
      { header: "Answered By", key: "answered", width: 20 },
      { header: "Answered At", key: "answeredAt", width: 18 },
    ];
    styledHeader(sheet, sheet.getRow(1));
    for (const r of data) {
      sheet.addRow({
        num: r.rfiNumber,
        subject: r.subject,
        status: r.status,
        due: r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "",
        assigned: r.assignedToName || "",
        answered: r.answeredByName || "",
        answeredAt: r.answeredAt ? new Date(r.answeredAt).toLocaleDateString() : "",
      });
    }
  }

  if (type === "submittal-log") {
    const sheet = wb.addWorksheet("Submittal Log");
    sheet.columns = [
      { header: "Submittal #", key: "num", width: 12 },
      { header: "Rev", key: "rev", width: 6 },
      { header: "Title", key: "title", width: 36 },
      { header: "Spec Section", key: "spec", width: 16 },
      { header: "Status", key: "status", width: 14 },
      { header: "Disposition", key: "disposition", width: 18 },
      { header: "Due Date", key: "due", width: 14 },
      { header: "Reviewed By", key: "reviewed", width: 20 },
    ];
    styledHeader(sheet, sheet.getRow(1));
    for (const s of data) {
      sheet.addRow({
        num: s.submittalNumber,
        rev: s.revision,
        title: s.title,
        spec: s.specSection || "",
        status: s.status,
        disposition: s.disposition || "",
        due: s.dueDate ? new Date(s.dueDate).toLocaleDateString() : "",
        reviewed: s.reviewedByName || "",
      });
    }
  }

  if (type === "daily-log-rollup") {
    const summary = wb.addWorksheet("Summary");
    summary.columns = [{ header: "Metric", key: "metric", width: 32 }, { header: "Value", key: "value", width: 20 }];
    styledHeader(summary, summary.getRow(1));
    summary.addRow(["Logs in range", data.totals.logCount]);
    summary.addRow(["Weather delay days", data.totals.weatherDelayDays]);
    summary.addRow(["Days with safety incidents", data.totals.safetyIncidentDays]);
    summary.addRow(["Total manpower (worker-entries)", data.totals.totalManpowerWorkers]);

    const trade = wb.addWorksheet("Manpower by Trade");
    trade.columns = [
      { header: "Trade", key: "trade", width: 24 },
      { header: "Total Workers", key: "workers", width: 16 },
      { header: "Total Hours", key: "hours", width: 16 },
    ];
    styledHeader(trade, trade.getRow(1));
    for (const t of data.manpowerByTrade) trade.addRow({ trade: t.trade, workers: t.totalWorkers, hours: t.totalHours });

    const logs = wb.addWorksheet("Daily Logs");
    logs.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Weather", key: "weather", width: 16 },
      { header: "Weather Delay", key: "delay", width: 14 },
      { header: "Crew Count", key: "crew", width: 12 },
      { header: "Work Performed", key: "work", width: 50 },
      { header: "Delays / Issues", key: "delays", width: 40 },
      { header: "Safety Incidents", key: "safety", width: 30 },
      { header: "Logged By", key: "by", width: 20 },
    ];
    styledHeader(logs, logs.getRow(1));
    for (const l of data.logs) {
      logs.addRow({
        date: new Date(l.logDate).toLocaleDateString(),
        weather: l.weather || "",
        delay: l.weatherDelay ? "Yes" : "No",
        crew: l.crewCount ?? "",
        work: l.workPerformed || "",
        delays: l.delays || "",
        safety: l.safetyIncidents || "",
        by: l.createdByName || "",
      });
    }
  }

  await wb.xlsx.write(res);
  res.end();
}

module.exports = router;
