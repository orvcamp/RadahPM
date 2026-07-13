// backend/routes/timeentries.js
//
// MangoDoe Projects — Time Tracking. Logged hours per task/user/project,
// billable flag, rolls up into per-project and per-user utilization.
// Anyone with project access can log their own time; only admin/staff can
// edit or delete someone else's entry.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapEntry(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    userId: row.user_id,
    userName: row.user_name || null,
    minutes: row.minutes,
    billable: row.billable,
    entryDate: row.entry_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function guardProject(req, res, next) {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) return res.status(404).json({ error: "Project not found." });
    next();
  } catch (e) { next(e); }
}

async function guardEntry(req, res, next) {
  try {
    const r = await pool.query(
      "SELECT project_id, user_id FROM time_entries WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Time entry not found." });
    }
    const isOwner = row.user_id === req.user.id;
    const isManager = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isManager) {
      return res.status(403).json({ error: "You can only edit your own time entries." });
    }
    next();
  } catch (e) { next(e); }
}

// GET /api/projects/:projectId/time-entries
// Optional ?userId=, ?taskId=, ?from=, ?to= filters. Everyone sees the full
// project log (utilization visibility is a feature here, same reasoning
// Daily Logs uses for clients — not something to hide from teammates).
router.get("/projects/:projectId/time-entries", requireAuth, requireModule("time_tracking"), guardProject, async (req, res) => {
  const { userId, taskId, from, to } = req.query || {};
  const conditions = ["te.project_id = $1", "te.deleted_at IS NULL"];
  const values = [req.params.projectId];
  let i = 2;
  if (userId) { conditions.push(`te.user_id = $${i}`); values.push(userId); i++; }
  if (taskId) { conditions.push(`te.task_id = $${i}`); values.push(taskId); i++; }
  if (from) { conditions.push(`te.entry_date >= $${i}`); values.push(from); i++; }
  if (to) { conditions.push(`te.entry_date <= $${i}`); values.push(to); i++; }
  try {
    const r = await pool.query(
      `SELECT te.*, u.full_name AS user_name FROM time_entries te
         JOIN users u ON u.id = te.user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY te.entry_date DESC, te.created_at DESC`,
      values
    );
    const totalMinutes = r.rows.reduce((s, row) => s + row.minutes, 0);
    const billableMinutes = r.rows.reduce((s, row) => s + (row.billable ? row.minutes : 0), 0);
    res.json({ entries: r.rows.map(mapEntry), totalMinutes, billableMinutes });
  } catch (err) {
    console.error("[radah-pm] list time entries error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/projects/:projectId/time-entries
// Body: { taskId?, minutes, billable?, entryDate?, note? }
// Always logged against the requesting user — nobody logs time on
// someone else's behalf here; that's an admin edit, not a create.
router.post("/projects/:projectId/time-entries", requireAuth, requireModule("time_tracking"), guardProject, async (req, res) => {
  const { taskId, minutes, billable, entryDate, note } = req.body || {};
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) {
    return res.status(400).json({ error: "minutes must be a positive number." });
  }
  try {
    if (taskId) {
      const t = await pool.query("SELECT project_id FROM tasks WHERE id = $1", [taskId]);
      if (!t.rows[0] || t.rows[0].project_id !== req.params.projectId) {
        return res.status(400).json({ error: "That task isn't part of this project." });
      }
    }
    const r = await pool.query(
      `INSERT INTO time_entries (project_id, task_id, user_id, minutes, billable, entry_date, note)
       VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), COALESCE($6, CURRENT_DATE), $7)
       RETURNING *`,
      [req.params.projectId, taskId || null, req.user.id, Math.round(mins), billable, entryDate || null, note || null]
    );
    res.status(201).json({ entry: mapEntry({ ...r.rows[0], user_name: req.user.fullName }) });
  } catch (err) {
    console.error("[radah-pm] create time entry error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.patch("/time-entries/:id", requireAuth, guardEntry, async (req, res) => {
  const bodyKeyMap = { minutes: "minutes", billable: "billable", entryDate: "entry_date", note: "note", taskId: "task_id" };
  const updates = [];
  const values = [];
  let i = 1;
  for (const [bodyKey, col] of Object.entries(bodyKeyMap)) {
    if (req.body && req.body[bodyKey] !== undefined) {
      if (bodyKey === "minutes") {
        const mins = Number(req.body.minutes);
        if (!Number.isFinite(mins) || mins <= 0) return res.status(400).json({ error: "minutes must be a positive number." });
        updates.push(`${col} = $${i}`); values.push(Math.round(mins)); i++;
        continue;
      }
      updates.push(`${col} = $${i}`);
      values.push(req.body[bodyKey]);
      i++;
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });
  try {
    values.push(req.params.id);
    const r = await pool.query(
      `UPDATE time_entries SET ${updates.join(", ")} WHERE id = $${i}
       RETURNING *, (SELECT full_name FROM users WHERE id = time_entries.user_id) AS user_name`,
      values
    );
    res.json({ entry: mapEntry(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update time entry error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/time-entries/:id", requireAuth, guardEntry, async (req, res) => {
  try {
    await pool.query("UPDATE time_entries SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Time entry removed." });
  } catch (err) {
    console.error("[radah-pm] delete time entry error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
