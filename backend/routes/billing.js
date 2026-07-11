// backend/routes/billing.js
//
// Pay applications (AIA G702/G703-style), draft -> submitted -> approved /
// rejected -> paid, with lien waiver tracking.
//
// Schedule of Values: not a separate table. Each pay app item snapshots its
// scheduled value from an existing budget_line at creation time (budget
// lines already include approved change order impact). A contract sum line
// shouldn't drift on a historical pay app if the budget is edited later.
//
// Carry-forward: a new pay app's item.previousCompletedCents is seeded from
// the most recent APPROVED or PAID app's matching item total (standard
// G703 practice — only certified progress carries forward).
//
// Permissions:
//   - admin/staff : create, edit (while draft), submit, delete (draft only);
//     approve/reject; revert; mark paid; manage lien waivers.
//   - client      : on their projects, view all + approve/reject SUBMITTED.
//   - trade_partner: no access (403) — this is cost/payment data.

const express = require("express");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject } = require("./projects");
const { requireModule } = require("../orgModules");
const r2 = require("../db/r2");
const { notifyProject } = require("../notify");

const router = express.Router();

// --- org-isolation guards (Phase 3 A2) ---
function guardProject(req, res, next) {
  if (req.user.role === "trade_partner") {
    return res.status(403).json({ error: "You do not have access to billing." });
  }
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}

// Pay app lookup + access guard (pay_applications has project_id directly).
async function guardPayApp(req, res, next) {
  try {
    if (req.user.role === "trade_partner") {
      return res.status(403).json({ error: "You do not have access to billing." });
    }
    const r = await pool.query(
      "SELECT project_id FROM pay_applications WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    const projectId = r.rows[0] ? r.rows[0].project_id : null;
    if (!projectId || !(await userCanAccessProject(req.user, projectId))) {
      return res.status(404).json({ error: "Pay application not found." });
    }
    req.payAppProjectId = projectId;
    next();
  } catch (e) { next(e); }
}

// Item / lien waiver lookup — joins through pay_applications for project_id.
function guardChild(table, fk) {
  return async (req, res, next) => {
    try {
      if (req.user.role === "trade_partner") {
        return res.status(403).json({ error: "You do not have access to billing." });
      }
      const r = await pool.query(
        `SELECT pa.project_id, pa.status, c.pay_application_id
           FROM ${table} c JOIN pay_applications pa ON pa.id = c.${fk}
          WHERE c.id = $1 AND pa.deleted_at IS NULL`,
        [req.params.id]
      );
      const row = r.rows[0];
      if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
        return res.status(404).json({ error: "Not found." });
      }
      req.parentProjectId = row.project_id;
      req.parentStatus = row.status;
      req.parentPayAppId = row.pay_application_id;
      next();
    } catch (e) { next(e); }
  };
}
const guardItem = guardChild("pay_application_items", "pay_application_id");
const guardWaiver = guardChild("lien_waivers", "pay_application_id");

function requireR2(req, res, next) {
  if (!r2.isConfigured) {
    return res.status(503).json({ error: "File storage is not configured yet. Please contact your administrator." });
  }
  next();
}
function buildStorageKey(projectId, fileName) {
  const safeName = (fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `projects/${projectId}/${crypto.randomUUID()}-${safeName}`;
}

// ---------- money helpers ----------
function centsOf(v) {
  return v === null || v === undefined ? 0 : Number(v);
}
function normalizeCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}
function normalizePercent(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

// ---------- computed rollups ----------
function computeItem(row, retentionPercent) {
  const scheduled = centsOf(row.scheduled_value_cents);
  const previous = centsOf(row.previous_completed_cents);
  const thisPeriod = centsOf(row.this_period_cents);
  const stored = centsOf(row.materials_stored_cents);
  const totalCompletedAndStored = previous + thisPeriod + stored;
  const retention = Math.round(totalCompletedAndStored * (retentionPercent / 100));
  return {
    id: row.id,
    payApplicationId: row.pay_application_id,
    budgetLineId: row.budget_line_id,
    description: row.description,
    scheduledValueCents: scheduled,
    previousCompletedCents: previous,
    thisPeriodCents: thisPeriod,
    materialsStoredCents: stored,
    totalCompletedAndStoredCents: totalCompletedAndStored,
    percentComplete: scheduled > 0 ? Math.round((totalCompletedAndStored / scheduled) * 1000) / 10 : 0,
    retentionCents: retention,
    balanceToFinishCents: scheduled - totalCompletedAndStored,
    sortOrder: row.sort_order,
  };
}

async function computeTotals(client, payApp, items) {
  const totals = items.reduce(
    (acc, it) => {
      acc.scheduledValueCents += it.scheduledValueCents;
      acc.previousCompletedCents += it.previousCompletedCents;
      acc.thisPeriodCents += it.thisPeriodCents;
      acc.materialsStoredCents += it.materialsStoredCents;
      acc.totalCompletedAndStoredCents += it.totalCompletedAndStoredCents;
      acc.retentionCents += it.retentionCents;
      acc.balanceToFinishCents += it.balanceToFinishCents;
      return acc;
    },
    {
      scheduledValueCents: 0, previousCompletedCents: 0, thisPeriodCents: 0,
      materialsStoredCents: 0, totalCompletedAndStoredCents: 0, retentionCents: 0,
      balanceToFinishCents: 0,
    }
  );
  totals.totalEarnedLessRetentionCents = totals.totalCompletedAndStoredCents - totals.retentionCents;
  totals.percentComplete = totals.scheduledValueCents > 0
    ? Math.round((totals.totalCompletedAndStoredCents / totals.scheduledValueCents) * 1000) / 10
    : 0;

  // Previous payments = the most recent APPROVED/PAID app's totalEarnedLessRetention, before this one.
  const prev = await client.query(
    `SELECT id FROM pay_applications
      WHERE project_id = $1 AND application_number < $2 AND status IN ('approved','paid') AND deleted_at IS NULL
      ORDER BY application_number DESC LIMIT 1`,
    [payApp.project_id, payApp.application_number]
  );
  let previousPaymentsCents = 0;
  if (prev.rows[0]) {
    const prevItemsRes = await client.query(
      "SELECT * FROM pay_application_items WHERE pay_application_id = $1",
      [prev.rows[0].id]
    );
    const prevAppRes = await client.query("SELECT retention_percent FROM pay_applications WHERE id = $1", [prev.rows[0].id]);
    const prevRetentionPercent = Number(prevAppRes.rows[0].retention_percent);
    const prevComputed = prevItemsRes.rows.map((r) => computeItem(r, prevRetentionPercent));
    previousPaymentsCents = prevComputed.reduce((s, it) => s + (it.totalCompletedAndStoredCents - it.retentionCents), 0);
  }
  totals.previousPaymentsCents = previousPaymentsCents;
  totals.currentPaymentDueCents = totals.totalEarnedLessRetentionCents - previousPaymentsCents;
  return totals;
}

function mapPayApp(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    applicationNumber: row.application_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    retentionPercent: Number(row.retention_percent),
    status: row.status,
    notes: row.notes,
    submittedByName: row.submitted_by_name || null,
    submittedAt: row.submitted_at,
    decidedByName: row.decided_by_name || null,
    decidedAt: row.decided_at,
    paidAt: row.paid_at,
    pdfDocumentId: row.pdf_document_id || null,
    createdAt: row.created_at,
  };
}

function mapLienWaiver(row) {
  return {
    id: row.id,
    payApplicationId: row.pay_application_id,
    waiverType: row.waiver_type,
    vendorName: row.vendor_name,
    amountCents: centsOf(row.amount_cents),
    status: row.status,
    documentId: row.document_id,
    documentFileName: row.file_name || null,
    createdAt: row.created_at,
  };
}

async function fetchFullPayApp(id, runner = pool) {
  const appRes = await runner.query(
    `SELECT pa.*, su.full_name AS submitted_by_name, du.full_name AS decided_by_name
       FROM pay_applications pa
       LEFT JOIN users su ON su.id = pa.submitted_by
       LEFT JOIN users du ON du.id = pa.decided_by
      WHERE pa.id = $1 AND pa.deleted_at IS NULL`,
    [id]
  );
  const appRow = appRes.rows[0];
  if (!appRow) return null;

  const itemsRes = await runner.query(
    "SELECT * FROM pay_application_items WHERE pay_application_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [id]
  );
  const items = itemsRes.rows.map((r) => computeItem(r, Number(appRow.retention_percent)));
  const totals = await computeTotals(runner, appRow, items);

  const waiversRes = await runner.query(
    `SELECT lw.*, d.file_name
       FROM lien_waivers lw LEFT JOIN documents d ON d.id = lw.document_id
      WHERE lw.pay_application_id = $1
      ORDER BY lw.created_at ASC`,
    [id]
  );

  return {
    ...mapPayApp(appRow),
    items,
    totals,
    lienWaivers: waiversRes.rows.map(mapLienWaiver),
  };
}

// ============================================================
// LIST
// GET /api/projects/:projectId/billing/pay-apps
// ============================================================
router.get("/projects/:projectId/billing/pay-apps", requireAuth, requireModule("billing"), guardProject, async (req, res) => {
  try {
    const appsRes = await pool.query(
      `SELECT pa.*, su.full_name AS submitted_by_name, du.full_name AS decided_by_name
         FROM pay_applications pa
         LEFT JOIN users su ON su.id = pa.submitted_by
         LEFT JOIN users du ON du.id = pa.decided_by
        WHERE pa.project_id = $1 AND pa.deleted_at IS NULL
        ORDER BY pa.application_number DESC`,
      [req.params.projectId]
    );

    const payApps = [];
    for (const row of appsRes.rows) {
      const itemsRes = await pool.query("SELECT * FROM pay_application_items WHERE pay_application_id = $1", [row.id]);
      const items = itemsRes.rows.map((r) => computeItem(r, Number(row.retention_percent)));
      const totals = await computeTotals(pool, row, items);
      payApps.push({ ...mapPayApp(row), totals });
    }

    res.json({
      canManage: isInternal(req.user),
      canDecide: true,
      payApps,
    });
  } catch (err) {
    console.error("[radah-pm] list pay apps error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// DETAIL
// GET /api/billing/pay-apps/:id
// ============================================================
router.get("/billing/pay-apps/:id", requireAuth, requireModule("billing"), guardPayApp, async (req, res) => {
  try {
    const payApp = await fetchFullPayApp(req.params.id);
    if (!payApp) return res.status(404).json({ error: "Pay application not found." });
    res.json({
      canManage: isInternal(req.user),
      canDecide: true,
      payApp,
    });
  } catch (err) {
    console.error("[radah-pm] get pay app error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// CREATE (admin/staff only)
// POST /api/projects/:projectId/billing/pay-apps
// Body: { periodStart, periodEnd, retentionPercent }
// Seeds one item per current budget line, carrying forward completed
// amounts from the most recent approved/paid pay app.
// ============================================================
// Carry-forward lookup: sums a prior APPROVED/PAID app's certified totals
// per line, keyed two ways — by budget_line_id (reliable, used for items
// generated from the budget) and by normalized description (best-effort,
// used for manually-added or imported SOV lines that have no budget_line_id
// to match on). Shared by pay-app creation, manual item add, and SOV import.
async function buildCarryForwardMaps(client, projectId, beforeApplicationNumber) {
  const byLine = {};
  const byDescription = {};
  const prevRes = await client.query(
    `SELECT id FROM pay_applications
      WHERE project_id = $1 AND application_number < $2 AND status IN ('approved','paid') AND deleted_at IS NULL
      ORDER BY application_number DESC LIMIT 1`,
    [projectId, beforeApplicationNumber]
  );
  if (prevRes.rows[0]) {
    const prevItemsRes = await client.query(
      "SELECT * FROM pay_application_items WHERE pay_application_id = $1",
      [prevRes.rows[0].id]
    );
    for (const it of prevItemsRes.rows) {
      const total = centsOf(it.previous_completed_cents) + centsOf(it.this_period_cents) + centsOf(it.materials_stored_cents);
      if (it.budget_line_id) byLine[it.budget_line_id] = total;
      const key = (it.description || "").trim().toLowerCase();
      if (key) byDescription[key] = total;
    }
  }
  return { byLine, byDescription };
}

router.post(
  "/projects/:projectId/billing/pay-apps",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { periodStart, periodEnd, retentionPercent, importFromBudget } = req.body || {};
    const retention = normalizePercent(retentionPercent, 10.0);
    if (retention === null) {
      return res.status(400).json({ error: "Retention percent must be between 0 and 100." });
    }
    // Default true, so existing behavior (auto-populate from the budget) is
    // unchanged unless the caller explicitly asks to start with a blank SOV
    // (to build it manually and/or import one).
    const shouldImportBudget = importFromBudget !== false;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const numRes = await client.query(
        "SELECT COALESCE(MAX(application_number), 0) + 1 AS next FROM pay_applications WHERE project_id = $1",
        [req.params.projectId]
      );
      const applicationNumber = numRes.rows[0].next;

      const ins = await client.query(
        `INSERT INTO pay_applications
           (project_id, application_number, period_start, period_end, retention_percent, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6)
         RETURNING *`,
        [req.params.projectId, applicationNumber, periodStart || null, periodEnd || null, retention, req.user.id]
      );
      const payApp = ins.rows[0];

      if (shouldImportBudget) {
        // Lines to bill: current budget lines for this project.
        const linesRes = await client.query(
          "SELECT * FROM budget_lines WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC",
          [req.params.projectId]
        );

        const { byLine } = await buildCarryForwardMaps(client, req.params.projectId, applicationNumber);

        let sortOrder = 0;
        for (const line of linesRes.rows) {
          await client.query(
            `INSERT INTO pay_application_items
               (pay_application_id, budget_line_id, description, scheduled_value_cents, previous_completed_cents, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              payApp.id,
              line.id,
              line.description,
              centsOf(line.budgeted_amount_cents),
              byLine[line.id] || 0,
              sortOrder++,
            ]
          );
        }
      }
      // else: pay app is created with zero items — add lines manually via
      // POST /billing/pay-apps/:id/items or import a schedule of values via
      // POST /billing/pay-apps/:id/items/import.

      await client.query("COMMIT");
      const full = await fetchFullPayApp(payApp.id);
      res.status(201).json({ payApp: full });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err.code === "23505") {
        return res.status(409).json({ error: "Pay application number collision — please retry." });
      }
      console.error("[radah-pm] create pay app error:", err);
      res.status(500).json({ error: "Something went wrong." });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// EDIT HEADER (admin/staff only, draft only)
// PATCH /api/billing/pay-apps/:id
// ============================================================
router.patch(
  "/billing/pay-apps/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardPayApp,
  async (req, res) => {
    try {
      const cur = await pool.query("SELECT * FROM pay_applications WHERE id = $1", [req.params.id]);
      const payApp = cur.rows[0];
      if (!payApp) return res.status(404).json({ error: "Pay application not found." });
      if (payApp.status !== "draft") {
        return res.status(409).json({ error: "Only a draft pay application can be edited. Revert it to Draft first." });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (req.body.periodStart !== undefined) { updates.push(`period_start = $${i}`); values.push(req.body.periodStart || null); i++; }
      if (req.body.periodEnd !== undefined) { updates.push(`period_end = $${i}`); values.push(req.body.periodEnd || null); i++; }
      if (req.body.notes !== undefined) { updates.push(`notes = $${i}`); values.push(req.body.notes || null); i++; }
      if (req.body.retentionPercent !== undefined) {
        const retention = normalizePercent(req.body.retentionPercent, null);
        if (retention === null) return res.status(400).json({ error: "Retention percent must be between 0 and 100." });
        updates.push(`retention_percent = $${i}`); values.push(retention); i++;
      }

      if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });
      values.push(req.params.id);
      await pool.query(`UPDATE pay_applications SET ${updates.join(", ")} WHERE id = $${i}`, values);
      const full = await fetchFullPayApp(req.params.id);
      res.json({ payApp: full });
    } catch (err) {
      console.error("[radah-pm] update pay app error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// EDIT LINE ITEM (admin/staff only, parent must be draft)
// PATCH /api/billing/pay-app-items/:id
// Body: { thisPeriodCents, materialsStoredCents, description, scheduledValueCents }
// description/scheduledValueCents are only meaningful for manually-added or
// imported SOV lines — items generated from the budget can still have these
// edited too, but note the value will then diverge from the budget line.
// ============================================================
router.patch(
  "/billing/pay-app-items/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardItem,
  async (req, res) => {
    if (req.parentStatus !== "draft") {
      return res.status(409).json({ error: "Only items on a draft pay application can be edited." });
    }
    const updates = [];
    const values = [];
    let i = 1;

    if (req.body.thisPeriodCents !== undefined) {
      const cents = normalizeCents(req.body.thisPeriodCents);
      if (cents === null) return res.status(400).json({ error: "This period amount must be a whole number of cents, 0 or more." });
      updates.push(`this_period_cents = $${i}`); values.push(cents); i++;
    }
    if (req.body.materialsStoredCents !== undefined) {
      const cents = normalizeCents(req.body.materialsStoredCents);
      if (cents === null) return res.status(400).json({ error: "Materials stored amount must be a whole number of cents, 0 or more." });
      updates.push(`materials_stored_cents = $${i}`); values.push(cents); i++;
    }
    if (req.body.description !== undefined) {
      const desc = String(req.body.description || "").trim();
      if (!desc) return res.status(400).json({ error: "Description cannot be empty." });
      updates.push(`description = $${i}`); values.push(desc); i++;
    }
    if (req.body.scheduledValueCents !== undefined) {
      const cents = normalizeCents(req.body.scheduledValueCents);
      if (cents === null) return res.status(400).json({ error: "Scheduled value must be a whole number of cents, 0 or more." });
      updates.push(`scheduled_value_cents = $${i}`); values.push(cents); i++;
    }
    if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });

    try {
      values.push(req.params.id);
      await pool.query(`UPDATE pay_application_items SET ${updates.join(", ")} WHERE id = $${i}`, values);
      const full = await fetchFullPayApp(req.parentPayAppId);
      res.json({ payApp: full });
    } catch (err) {
      console.error("[radah-pm] update pay app item error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// ADD A LINE ITEM MANUALLY (admin/staff only, parent must be draft)
// POST /api/billing/pay-apps/:id/items
// Body: { description, scheduledValueCents }
// Not tied to a budget_line — for a schedule of values that differs from
// the internal cost budget (e.g. a contract SOV with different breakdown).
// Carries forward previousCompletedCents from the prior certified app by
// matching description, same as an imported line.
// ============================================================
router.post(
  "/billing/pay-apps/:id/items",
  requireAuth,
  requireRole("admin", "staff"),
  guardPayApp,
  async (req, res) => {
    try {
      const appRes = await pool.query("SELECT * FROM pay_applications WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
      const payApp = appRes.rows[0];
      if (!payApp) return res.status(404).json({ error: "Pay application not found." });
      if (payApp.status !== "draft") {
        return res.status(409).json({ error: "Only a draft pay application can have items added." });
      }
      const description = String((req.body || {}).description || "").trim();
      if (!description) return res.status(400).json({ error: "Description is required." });
      const scheduledValueCents = normalizeCents((req.body || {}).scheduledValueCents);
      if (scheduledValueCents === null) {
        return res.status(400).json({ error: "Scheduled value must be a whole number of cents, 0 or more." });
      }

      const sortRes = await pool.query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pay_application_items WHERE pay_application_id = $1",
        [req.params.id]
      );
      const { byDescription } = await buildCarryForwardMaps(pool, payApp.project_id, payApp.application_number);
      const previousCompletedCents = byDescription[description.toLowerCase()] || 0;

      await pool.query(
        `INSERT INTO pay_application_items
           (pay_application_id, budget_line_id, description, scheduled_value_cents, previous_completed_cents, sort_order)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
        [req.params.id, description, scheduledValueCents, previousCompletedCents, sortRes.rows[0].next]
      );
      const full = await fetchFullPayApp(req.params.id);
      res.status(201).json({ payApp: full });
    } catch (err) {
      console.error("[radah-pm] add pay app item error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// DELETE A LINE ITEM (admin/staff only, parent must be draft)
// DELETE /api/billing/pay-app-items/:id
// ============================================================
router.delete(
  "/billing/pay-app-items/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardItem,
  async (req, res) => {
    if (req.parentStatus !== "draft") {
      return res.status(409).json({ error: "Only items on a draft pay application can be removed." });
    }
    try {
      await pool.query("DELETE FROM pay_application_items WHERE id = $1", [req.params.id]);
      const full = await fetchFullPayApp(req.parentPayAppId);
      res.json({ payApp: full });
    } catch (err) {
      console.error("[radah-pm] delete pay app item error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// IMPORT A SCHEDULE OF VALUES (admin/staff only, parent must be draft)
// POST /api/billing/pay-apps/:id/items/import
// Body: { items: [{ description, scheduledValueCents }], mode: "replace" | "append" }
// "replace" clears all existing items on this draft app first (useful when
// starting a pay app blank and importing the real contract SOV in one go).
// "append" adds after whatever's already there.
// Parsing of an uploaded CSV/XLSX happens client-side; this endpoint just
// takes the resulting structured rows.
// ============================================================
router.post(
  "/billing/pay-apps/:id/items/import",
  requireAuth,
  requireRole("admin", "staff"),
  guardPayApp,
  async (req, res) => {
    const { items, mode } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Provide at least one item to import." });
    }
    if (items.length > 500) {
      return res.status(400).json({ error: "Too many items in one import (max 500)." });
    }
    if (mode !== "replace" && mode !== "append") {
      return res.status(400).json({ error: "mode must be 'replace' or 'append'." });
    }
    // Validate every row up front so a bad row doesn't partially import.
    const cleanRows = [];
    for (const [idx, raw] of items.entries()) {
      const description = String((raw && raw.description) || "").trim();
      if (!description) return res.status(400).json({ error: `Row ${idx + 1}: description is required.` });
      const scheduledValueCents = normalizeCents(raw && raw.scheduledValueCents);
      if (scheduledValueCents === null) {
        return res.status(400).json({ error: `Row ${idx + 1}: scheduled value must be a whole number of cents, 0 or more.` });
      }
      cleanRows.push({ description, scheduledValueCents });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const appRes = await client.query(
        "SELECT * FROM pay_applications WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
        [req.params.id]
      );
      const payApp = appRes.rows[0];
      if (!payApp) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pay application not found." }); }
      if (payApp.status !== "draft") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only a draft pay application can be imported into." });
      }

      if (mode === "replace") {
        await client.query("DELETE FROM pay_application_items WHERE pay_application_id = $1", [req.params.id]);
      }
      const sortRes = await client.query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pay_application_items WHERE pay_application_id = $1",
        [req.params.id]
      );
      let sortOrder = sortRes.rows[0].next;

      const { byDescription } = await buildCarryForwardMaps(client, payApp.project_id, payApp.application_number);

      for (const row of cleanRows) {
        const previousCompletedCents = byDescription[row.description.toLowerCase()] || 0;
        await client.query(
          `INSERT INTO pay_application_items
             (pay_application_id, budget_line_id, description, scheduled_value_cents, previous_completed_cents, sort_order)
           VALUES ($1, NULL, $2, $3, $4, $5)`,
          [req.params.id, row.description, row.scheduledValueCents, previousCompletedCents, sortOrder++]
        );
      }

      await client.query("COMMIT");
      const full = await fetchFullPayApp(req.params.id);
      res.status(201).json({ payApp: full, imported: cleanRows.length, mode });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] import pay app items error:", err);
      res.status(500).json({ error: "Something went wrong importing the schedule of values." });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// TRANSITION (the workflow engine)
// POST /api/billing/pay-apps/:id/transition   Body: { action }
//   action = submit | approve | reject | revert | mark-paid
// ============================================================
router.post("/billing/pay-apps/:id/transition", requireAuth, requireModule("billing"), guardPayApp, async (req, res) => {
  const action = (req.body && req.body.action) || "";
  const valid = ["submit", "approve", "reject", "revert", "mark-paid"];
  if (!valid.includes(action)) {
    return res.status(400).json({ error: "Unknown action." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query("SELECT * FROM pay_applications WHERE id = $1 FOR UPDATE", [req.params.id]);
    const payApp = cur.rows[0];
    if (!payApp) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pay application not found." }); }

    const internal = isInternal(req.user);
    if (!internal) {
      const member = await client.query(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        [payApp.project_id, req.user.id]
      );
      if (member.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "You do not have access to this project." });
      }
    }

    if (action === "submit") {
      if (!internal) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Only RADAH staff can submit a pay application." }); }
      if (payApp.status !== "draft") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only draft pay applications can be submitted." }); }
      await client.query(
        "UPDATE pay_applications SET status = 'submitted', submitted_by = $1, submitted_at = now() WHERE id = $2",
        [req.user.id, payApp.id]
      );
    } else if (action === "approve") {
      if (payApp.status !== "submitted") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only submitted pay applications can be approved." }); }
      await client.query(
        "UPDATE pay_applications SET status = 'approved', decided_by = $1, decided_at = now() WHERE id = $2",
        [req.user.id, payApp.id]
      );
    } else if (action === "reject") {
      if (payApp.status !== "submitted") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only submitted pay applications can be rejected." }); }
      await client.query(
        "UPDATE pay_applications SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2",
        [req.user.id, payApp.id]
      );
    } else if (action === "revert") {
      if (!internal) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Only RADAH staff can revert a pay application." }); }
      if (payApp.status !== "approved") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only approved pay applications can be reverted." }); }
      await client.query(
        "UPDATE pay_applications SET status = 'submitted', decided_by = NULL, decided_at = NULL WHERE id = $1",
        [payApp.id]
      );
    } else if (action === "mark-paid") {
      if (!internal) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Only RADAH staff can mark a pay application paid." }); }
      if (payApp.status !== "approved") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only approved pay applications can be marked paid." }); }
      await client.query("UPDATE pay_applications SET status = 'paid', paid_at = now() WHERE id = $1", [payApp.id]);
    }

    await client.query("COMMIT");
    const full = await fetchFullPayApp(req.params.id);

    const NOTIFY = {
      submit: { type: "payapp.submitted", verb: "submitted for decision" },
      approve: { type: "payapp.approved", verb: "approved" },
      reject: { type: "payapp.rejected", verb: "rejected" },
      "mark-paid": { type: "payapp.paid", verb: "marked paid" },
    };
    if (NOTIFY[action]) {
      await notifyProject({
        projectId: payApp.project_id,
        orgId: req.user.orgId,
        actorId: req.user.id,
        actorName: req.user.fullName,
        type: NOTIFY[action].type,
        title: `Pay App #${full.applicationNumber} ${NOTIFY[action].verb}`,
        body: `${req.user.fullName || "Someone"} ${NOTIFY[action].verb} this pay application.`,
        tab: "billing",
        excludeRoles: ["trade_partner"],
      });
    }
    res.json({ payApp: full });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] pay app transition error:", err);
    res.status(500).json({ error: "Something went wrong processing that action." });
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE (admin only, draft only — preserves billing history otherwise)
// ============================================================
router.delete("/billing/pay-apps/:id", requireAuth, requireRole("admin"), guardPayApp, async (req, res) => {
  try {
    const cur = await pool.query("SELECT status FROM pay_applications WHERE id = $1", [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "Pay application not found." });
    if (cur.rows[0].status !== "draft") {
      return res.status(409).json({ error: "Only a draft pay application can be deleted. Submitted and later applications are kept for billing history." });
    }
    await pool.query(
      "UPDATE pay_applications SET deleted_at = now(), deleted_by = $1 WHERE id = $2",
      [req.user.id, req.params.id]
    );
    res.json({ message: "Pay application deleted." });
  } catch (err) {
    console.error("[radah-pm] delete pay app error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// LIEN WAIVERS
// ============================================================

// POST /api/projects/:projectId/billing/pay-apps/:payAppId/lien-waivers
router.post(
  "/projects/:projectId/billing/pay-apps/:payAppId/lien-waivers",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { waiverType, vendorName, amountCents } = req.body || {};
    const validTypes = ["conditional_progress", "unconditional_progress", "conditional_final", "unconditional_final"];
    if (!validTypes.includes(waiverType)) {
      return res.status(400).json({ error: "Invalid waiver type." });
    }
    if (!vendorName || !vendorName.trim()) {
      return res.status(400).json({ error: "A vendor name is required." });
    }
    const cents = normalizeCents(amountCents);
    if (cents === null) return res.status(400).json({ error: "Amount must be a whole number of cents, 0 or more." });

    try {
      const pa = await pool.query(
        "SELECT id FROM pay_applications WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL",
        [req.params.payAppId, req.params.projectId]
      );
      if (!pa.rows[0]) return res.status(404).json({ error: "Pay application not found." });

      const ins = await pool.query(
        `INSERT INTO lien_waivers (pay_application_id, waiver_type, vendor_name, amount_cents, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.params.payAppId, waiverType, vendorName.trim(), cents, req.user.id]
      );
      res.status(201).json({ lienWaiver: mapLienWaiver(ins.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create lien waiver error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH /api/billing/lien-waivers/:id
router.patch("/billing/lien-waivers/:id", requireAuth, requireRole("admin", "staff"), guardWaiver, async (req, res) => {
  const updates = [];
  const values = [];
  let i = 1;

  if (req.body.status !== undefined) {
    if (!["pending", "received"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status." });
    updates.push(`status = $${i}`); values.push(req.body.status); i++;
  }
  if (req.body.vendorName !== undefined) {
    if (!String(req.body.vendorName).trim()) return res.status(400).json({ error: "Vendor name cannot be empty." });
    updates.push(`vendor_name = $${i}`); values.push(String(req.body.vendorName).trim()); i++;
  }
  if (req.body.amountCents !== undefined) {
    const cents = normalizeCents(req.body.amountCents);
    if (cents === null) return res.status(400).json({ error: "Amount must be a whole number of cents, 0 or more." });
    updates.push(`amount_cents = $${i}`); values.push(cents); i++;
  }
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });

  try {
    values.push(req.params.id);
    await pool.query(`UPDATE lien_waivers SET ${updates.join(", ")} WHERE id = $${i}`, values);
    const r = await pool.query(
      "SELECT lw.*, d.file_name FROM lien_waivers lw LEFT JOIN documents d ON d.id = lw.document_id WHERE lw.id = $1",
      [req.params.id]
    );
    res.json({ lienWaiver: mapLienWaiver(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update lien waiver error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// DELETE /api/billing/lien-waivers/:id
router.delete("/billing/lien-waivers/:id", requireAuth, requireRole("admin", "staff"), guardWaiver, async (req, res) => {
  try {
    await pool.query("DELETE FROM lien_waivers WHERE id = $1", [req.params.id]);
    res.json({ message: "Lien waiver removed." });
  } catch (err) {
    console.error("[radah-pm] delete lien waiver error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ---------- lien waiver signed-document attachment (one per waiver) ----------

// POST /api/projects/:projectId/billing/lien-waivers/:waiverId/attachment/upload-url
router.post(
  "/projects/:projectId/billing/lien-waivers/:waiverId/attachment/upload-url",
  requireAuth,
  requireRole("admin", "staff"),
  requireR2,
  guardProject,
  async (req, res) => {
    try {
      const w = await pool.query(
        `SELECT lw.id FROM lien_waivers lw JOIN pay_applications pa ON pa.id = lw.pay_application_id
          WHERE lw.id = $1 AND pa.project_id = $2`,
        [req.params.waiverId, req.params.projectId]
      );
      if (!w.rows[0]) return res.status(404).json({ error: "Lien waiver not found." });

      const { fileName, contentType } = req.body || {};
      if (!fileName) return res.status(400).json({ error: "fileName is required." });
      const storageKey = buildStorageKey(req.params.projectId, fileName);
      const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
      res.json({ uploadUrl, storageKey });
    } catch (err) {
      console.error("[radah-pm] lien waiver upload-url error:", err);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  }
);

// POST /api/projects/:projectId/billing/lien-waivers/:waiverId/attachment/confirm
router.post(
  "/projects/:projectId/billing/lien-waivers/:waiverId/attachment/confirm",
  requireAuth,
  requireRole("admin", "staff"),
  requireR2,
  guardProject,
  async (req, res) => {
    const { storageKey, fileName, contentType, sizeBytes } = req.body || {};
    if (!storageKey || !fileName) return res.status(400).json({ error: "storageKey and fileName are required." });
    if (!storageKey.startsWith(`projects/${req.params.projectId}/`)) {
      return res.status(400).json({ error: "Invalid storage key for this project." });
    }
    const client = await pool.connect();
    try {
      const w = await pool.query(
        `SELECT lw.id FROM lien_waivers lw JOIN pay_applications pa ON pa.id = lw.pay_application_id
          WHERE lw.id = $1 AND pa.project_id = $2`,
        [req.params.waiverId, req.params.projectId]
      );
      if (!w.rows[0]) { client.release(); return res.status(404).json({ error: "Lien waiver not found." }); }

      await client.query("BEGIN");
      const docRes = await client.query(
        `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.params.projectId, storageKey, fileName, contentType || null, sizeBytes || null, "Lien waiver", req.user.id]
      );
      await client.query("UPDATE lien_waivers SET document_id = $1, status = 'received' WHERE id = $2", [
        docRes.rows[0].id, req.params.waiverId,
      ]);
      await client.query("COMMIT");
      const r = await pool.query(
        "SELECT lw.*, d.file_name FROM lien_waivers lw LEFT JOIN documents d ON d.id = lw.document_id WHERE lw.id = $1",
        [req.params.waiverId]
      );
      res.status(201).json({ lienWaiver: mapLienWaiver(r.rows[0]) });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] lien waiver attachment confirm error:", err);
      res.status(500).json({ error: "Could not save the attachment." });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// PDF EXPORT — generates the pay application as a PDF, downloads it to the
// browser, and files (or re-files) a copy under this project's Documents,
// in the standard "06 - Cost & Billing / Pay Applications" folder.
// ============================================================

// Idempotent find-or-create down a folder path, mirroring the standard
// folder template logic in routes/documents.js.
async function findOrCreateFolderPath(client, projectId, pathParts, userId) {
  let parentId = null;
  for (const name of pathParts) {
    const found = await client.query(
      "SELECT id FROM document_folders WHERE project_id = $1 AND name = $2 AND parent_folder_id IS NOT DISTINCT FROM $3",
      [projectId, name, parentId]
    );
    if (found.rows[0]) {
      parentId = found.rows[0].id;
    } else {
      const ins = await client.query(
        "INSERT INTO document_folders (project_id, parent_folder_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
        [projectId, parentId, name, userId]
      );
      parentId = ins.rows[0].id;
    }
  }
  return parentId;
}

function dollarsStr(cents) {
  const n = centsOf(cents);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderPayAppPdfBuffer(payApp, project) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).fillColor("#0B1F3A").text(`Pay Application #${payApp.applicationNumber}`);
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor("#333333").text(project.name);
    if (project.clientOrgName) doc.text(project.clientOrgName);
    doc.fontSize(9).fillColor("#6b7280").text(
      `Period: ${payApp.periodStart ? new Date(payApp.periodStart).toLocaleDateString() : "?"} – ${payApp.periodEnd ? new Date(payApp.periodEnd).toLocaleDateString() : "?"}   ·   Status: ${payApp.status}   ·   Retention: ${payApp.retentionPercent}%`
    );
    doc.fontSize(9).fillColor("#6b7280").text(`Generated ${new Date().toLocaleString()}`);
    doc.moveDown(0.8);
    doc.strokeColor("#E2E1DA").moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.6);
    doc.fillColor("#000000");

    // ---- line items table ----
    const columns = [
      { key: "description", header: "Description", width: 160 },
      { key: "scheduled", header: "Scheduled", width: 70, align: "right" },
      { key: "previous", header: "Previous", width: 65, align: "right" },
      { key: "period", header: "This Period", width: 65, align: "right" },
      { key: "stored", header: "Stored", width: 60, align: "right" },
      { key: "total", header: "Total", width: 70, align: "right" },
      { key: "pct", header: "%", width: 35, align: "right" },
    ];
    const startX = doc.page.margins.left;
    let y = doc.y;
    const rowHeight = 18;
    function drawHeader() {
      let x = startX;
      const totalWidth = columns.reduce((s, c) => s + c.width, 0);
      doc.rect(startX, y, totalWidth, rowHeight).fill("#0B1F3A");
      doc.fillColor("#ffffff").fontSize(8);
      for (const c of columns) { doc.text(c.header, x + 3, y + 5, { width: c.width - 6, align: c.align || "left" }); x += c.width; }
      y += rowHeight;
      doc.fillColor("#000000");
    }
    drawHeader();
    let i = 0;
    for (const it of payApp.items) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; drawHeader(); }
      const totalWidth = columns.reduce((s, c) => s + c.width, 0);
      if (i % 2 === 1) { doc.rect(startX, y, totalWidth, rowHeight).fill("#F7F6F2"); doc.fillColor("#000000"); }
      let x = startX;
      doc.fontSize(8).fillColor("#1a1a1a");
      const vals = {
        description: it.description,
        scheduled: dollarsStr(it.scheduledValueCents),
        previous: dollarsStr(it.previousCompletedCents),
        period: dollarsStr(it.thisPeriodCents),
        stored: dollarsStr(it.materialsStoredCents),
        total: dollarsStr(it.totalCompletedAndStoredCents),
        pct: `${it.percentComplete}%`,
      };
      for (const c of columns) { doc.text(vals[c.key], x + 3, y + 5, { width: c.width - 6, align: c.align || "left" }); x += c.width; }
      y += rowHeight;
      i++;
    }
    doc.y = y + 14;

    // ---- totals ----
    const t = payApp.totals;
    function kv(label, value, bold) {
      doc.fontSize(10).fillColor("#6b7280").text(label, doc.page.margins.left, doc.y, { continued: true, width: 220 });
      doc.fillColor(bold ? "#0B1F3A" : "#000000").text(`  ${value}`, { align: "left" });
    }
    kv("Scheduled Value", dollarsStr(t.scheduledValueCents));
    kv("Completed & Stored to Date", dollarsStr(t.totalCompletedAndStoredCents));
    kv("Percent Complete", `${t.percentComplete}%`);
    kv("Retention", dollarsStr(t.retentionCents));
    kv("Total Earned Less Retention", dollarsStr(t.totalEarnedLessRetentionCents));
    kv("Less Previous Payments", dollarsStr(t.previousPaymentsCents));
    kv("Current Payment Due", dollarsStr(t.currentPaymentDueCents), true);
    kv("Balance to Finish", dollarsStr(t.balanceToFinishCents));

    // ---- lien waivers ----
    if (payApp.lienWaivers.length > 0) {
      doc.moveDown(1);
      doc.fontSize(12).fillColor("#0B1F3A").text("Lien Waivers");
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#000000");
      for (const w of payApp.lienWaivers) {
        doc.text(`${w.vendorName} — ${w.waiverType.replace(/_/g, " ")} — ${dollarsStr(w.amountCents)} — ${w.status}`);
      }
    }

    doc.end();
  });
}

// GET /api/billing/pay-apps/:id/pdf
router.get("/billing/pay-apps/:id/pdf", requireAuth, requireModule("billing"), guardPayApp, async (req, res) => {
  try {
    const payApp = await fetchFullPayApp(req.params.id);
    if (!payApp) return res.status(404).json({ error: "Pay application not found." });
    const projRes = await pool.query("SELECT name, client_org_name FROM projects WHERE id = $1", [payApp.projectId]);
    const project = { name: projRes.rows[0]?.name || "Project", clientOrgName: projRes.rows[0]?.client_org_name || null };

    const buffer = await renderPayAppPdfBuffer(payApp, project);
    const fileName = `Pay Application ${payApp.applicationNumber}.pdf`;

    // File (or re-file) a copy under Documents, if storage is configured.
    // Filing failures never block the download — they're logged and skipped.
    if (r2.isConfigured) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const folderId = await findOrCreateFolderPath(
          client, payApp.projectId, ["06 - Cost & Billing", "Pay Applications"], req.user.id
        );
        // Soft-delete the previously filed copy of this pay app's PDF, if any.
        if (payApp.pdfDocumentId) {
          await client.query(
            "UPDATE documents SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL",
            [req.user.id, payApp.pdfDocumentId]
          );
        }
        const storageKey = buildStorageKey(payApp.projectId, fileName);
        await r2.putObject(storageKey, buffer, "application/pdf");
        const docRes = await client.query(
          `INSERT INTO documents (project_id, folder_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
           VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7) RETURNING id`,
          [payApp.projectId, folderId, storageKey, fileName, buffer.length, `Pay Application #${payApp.applicationNumber}`, req.user.id]
        );
        await client.query("UPDATE pay_applications SET pdf_document_id = $1 WHERE id = $2", [docRes.rows[0].id, payApp.id]);
        await client.query("COMMIT");
      } catch (fileErr) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[radah-pm] pay app PDF filing error (download still proceeds):", fileErr);
      } finally {
        client.release();
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error("[radah-pm] pay app PDF export error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong generating that PDF." });
    else res.end();
  }
});

module.exports = router;

