// backend/routes/workorders.js
//
// MangoDoe Facilities — Work Orders and Preventive Maintenance Schedules.
//
// pm_schedules define recurring maintenance; POST /pm-schedules/:id/generate
// manually spawns a work_order from a due schedule and advances
// next_due_date. An actual background scheduler (cron) that calls this
// automatically is intentionally NOT built here — see the note at the
// bottom of this file — this scaffolding gives it something correct to
// call once that job exists.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapWorkOrder(row) {
  return {
    id: row.id,
    propertyId: row.project_id,
    assetId: row.asset_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    requestedBy: row.requested_by,
    assignedToUserId: row.assigned_to_user_id,
    assignedToVendorId: row.assigned_to_vendor_id,
    scheduledDate: row.scheduled_date,
    completedAt: row.completed_at,
    costCents: Number(row.cost_cents) || 0,
    pmScheduleId: row.pm_schedule_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPmSchedule(row) {
  return {
    id: row.id,
    propertyId: row.project_id,
    assetId: row.asset_id,
    title: row.title,
    description: row.description,
    frequencyType: row.frequency_type,
    intervalDays: row.interval_days,
    nextDueDate: row.next_due_date,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function guardProperty(req, res, next) {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.propertyId);
    if (!allowed) return res.status(404).json({ error: "Property not found." });
    next();
  } catch (e) { next(e); }
}

async function guardWorkOrder(req, res, next) {
  try {
    const r = await pool.query("SELECT project_id, status FROM work_orders WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Work order not found." });
    }
    req.propertyId = row.project_id;
    req.workOrderStatus = row.status;
    next();
  } catch (e) { next(e); }
}

async function guardPmSchedule(req, res, next) {
  try {
    const r = await pool.query("SELECT project_id FROM pm_schedules WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "PM schedule not found." });
    }
    req.propertyId = row.project_id;
    next();
  } catch (e) { next(e); }
}

// ============================================================
// WORK ORDERS
// ============================================================

router.get("/properties/:propertyId/work-orders", requireAuth, requireModule("workorders"), guardProperty, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM work_orders WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [req.params.propertyId]
    );
    res.json({ workOrders: r.rows.map(mapWorkOrder) });
  } catch (err) {
    console.error("[radah-pm] list work orders error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST — any project member can submit a work order request (a tenant
// reporting an issue is the primary use case), not just admin/staff.
router.post("/properties/:propertyId/work-orders", requireAuth, requireModule("workorders"), guardProperty, async (req, res) => {
  const { assetId, title, description, priority, scheduledDate } = req.body || {};
  if (!title) return res.status(400).json({ error: "A short title is required." });
  try {
    const r = await pool.query(
      `INSERT INTO work_orders (project_id, asset_id, title, description, priority, requested_by, scheduled_date, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'normal'), $6, $7, $6) RETURNING *`,
      [req.params.propertyId, assetId || null, title, description || null, priority || null, req.user.id, scheduledDate || null]
    );
    res.status(201).json({ workOrder: mapWorkOrder(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] create work order error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// PATCH /api/work-orders/:id — admin/staff only. Covers editing details,
// assignment, and status changes all through one endpoint (mirrors the
// pattern used for billing pay-app-items: whichever fields are present
// get updated).
router.patch("/work-orders/:id", requireAuth, requireRole("admin", "staff"), guardWorkOrder, async (req, res) => {
  const bodyKeyMap = {
    title: "title", description: "description", priority: "priority", status: "status",
    assetId: "asset_id", assignedToUserId: "assigned_to_user_id", assignedToVendorId: "assigned_to_vendor_id",
    scheduledDate: "scheduled_date", costCents: "cost_cents",
  };
  const updates = [];
  const values = [];
  let i = 1;
  for (const [bodyKey, col] of Object.entries(bodyKeyMap)) {
    if (req.body && req.body[bodyKey] !== undefined) {
      updates.push(`${col} = $${i}`);
      values.push(req.body[bodyKey]);
      i++;
    }
  }
  // Assignment is either a user or a vendor, never both — enforced here.
  if (req.body && req.body.assignedToUserId) updates.push(`assigned_to_vendor_id = NULL`);
  if (req.body && req.body.assignedToVendorId) updates.push(`assigned_to_user_id = NULL`);
  if (req.body && req.body.status === "completed") updates.push(`completed_at = now()`);
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });
  try {
    values.push(req.params.id);
    const r = await pool.query(`UPDATE work_orders SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ workOrder: mapWorkOrder(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update work order error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/work-orders/:id", requireAuth, requireRole("admin", "staff"), guardWorkOrder, async (req, res) => {
  try {
    await pool.query("UPDATE work_orders SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Work order removed." });
  } catch (err) {
    console.error("[radah-pm] delete work order error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// PM SCHEDULES
// ============================================================

router.get("/properties/:propertyId/pm-schedules", requireAuth, requireModule("pm_scheduling"), guardProperty, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM pm_schedules WHERE project_id = $1 AND deleted_at IS NULL ORDER BY next_due_date ASC",
      [req.params.propertyId]
    );
    res.json({ pmSchedules: r.rows.map(mapPmSchedule) });
  } catch (err) {
    console.error("[radah-pm] list PM schedules error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post(
  "/properties/:propertyId/pm-schedules",
  requireAuth,
  requireModule("pm_scheduling"),
  requireRole("admin", "staff"),
  guardProperty,
  async (req, res) => {
    const { assetId, title, description, frequencyType, intervalDays, nextDueDate } = req.body || {};
    if (!title) return res.status(400).json({ error: "Title is required." });
    if (!nextDueDate) return res.status(400).json({ error: "A next due date is required." });
    try {
      const r = await pool.query(
        `INSERT INTO pm_schedules (project_id, asset_id, title, description, frequency_type, interval_days, next_due_date, created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'calendar'), $6, $7, $8) RETURNING *`,
        [req.params.propertyId, assetId || null, title, description || null, frequencyType || null,
          intervalDays || null, nextDueDate, req.user.id]
      );
      res.status(201).json({ pmSchedule: mapPmSchedule(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create PM schedule error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.patch("/pm-schedules/:id", requireAuth, requireRole("admin", "staff"), guardPmSchedule, async (req, res) => {
  const bodyKeyMap = {
    title: "title", description: "description", frequencyType: "frequency_type",
    intervalDays: "interval_days", nextDueDate: "next_due_date", isActive: "is_active",
  };
  const updates = [];
  const values = [];
  let i = 1;
  for (const [bodyKey, col] of Object.entries(bodyKeyMap)) {
    if (req.body && req.body[bodyKey] !== undefined) {
      updates.push(`${col} = $${i}`);
      values.push(req.body[bodyKey]);
      i++;
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });
  try {
    values.push(req.params.id);
    const r = await pool.query(`UPDATE pm_schedules SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ pmSchedule: mapPmSchedule(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update PM schedule error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/pm-schedules/:id", requireAuth, requireRole("admin", "staff"), guardPmSchedule, async (req, res) => {
  try {
    await pool.query("UPDATE pm_schedules SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "PM schedule removed." });
  } catch (err) {
    console.error("[radah-pm] delete PM schedule error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/pm-schedules/:id/generate — admin/staff only. Manually spawns
// a work_order from this schedule right now (regardless of whether it's
// actually due), and advances next_due_date by interval_days for calendar-
// type schedules. This is the piece a future cron job would call
// automatically once next_due_date <= today — not built in this pass (see
// note below) — but it's fully functional as a manual "generate now"
// action today.
router.post(
  "/pm-schedules/:id/generate",
  requireAuth,
  requireRole("admin", "staff"),
  guardPmSchedule,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sched = await client.query("SELECT * FROM pm_schedules WHERE id = $1 FOR UPDATE", [req.params.id]);
      const s = sched.rows[0];
      if (!s) { await client.query("ROLLBACK"); return res.status(404).json({ error: "PM schedule not found." }); }

      const wo = await client.query(
        `INSERT INTO work_orders (project_id, asset_id, title, description, priority, pm_schedule_id, created_by)
         VALUES ($1, $2, $3, $4, 'normal', $5, $6) RETURNING *`,
        [s.project_id, s.asset_id, s.title, s.description, s.id, req.user.id]
      );

      if (s.frequency_type === "calendar" && s.interval_days) {
        await client.query(
          "UPDATE pm_schedules SET next_due_date = next_due_date + ($1 || ' days')::interval WHERE id = $2",
          [s.interval_days, s.id]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({ workOrder: mapWorkOrder(wo.rows[0]) });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] generate work order from PM schedule error:", err);
      res.status(500).json({ error: "Something went wrong." });
    } finally {
      client.release();
    }
  }
);

module.exports = router;

// ------------------------------------------------------------
// NOT built in this pass, deliberately: an automatic scheduler that scans
// pm_schedules for next_due_date <= today and calls the generate logic
// above without a human clicking a button. This codebase has no existing
// background-job/cron infrastructure to hook into — adding one is a real
// architecture decision (a scheduled Railway service? a cron endpoint hit
// by an external pinger? node-cron in-process?) that deserves its own
// pass rather than being smuggled into a schema-scaffolding migration.
// The idx_pm_schedules_due index above is already shaped for whichever
// approach is chosen (WHERE is_active AND deleted_at IS NULL — a scheduler
// job just adds "AND next_due_date <= CURRENT_DATE").
// ------------------------------------------------------------
