// backend/routes/logs.js
//
// Project logs — nine PM registers backed by one table, because they share the
// same shape: an entry with a number, a title, an owner, a status, a priority,
// a due date, and an outcome.
//
//   Action · Issue · Decision · Risk · Assumption · Constraint ·
//   Opportunity · Open Items · Lessons Learned
//
// Risk and Opportunity additionally use likelihood/impact. Everything else
// ignores those fields.
//
// Permissions: admin/staff create, edit, and close entries (these are
// PM-owned registers). Every project member can view. Delete is admin-only and
// soft, so entries land in Deleted Items and can be restored.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");
const { requireModule } = require("../orgModules");
const { notifyUser } = require("../notify");

const router = express.Router();

// The catalogue. Adding a register later is one line here plus a label in the UI.
const LOG_TYPES = [
  { key: "action", label: "Action Log", singular: "Action" },
  { key: "issue", label: "Issue Log", singular: "Issue" },
  { key: "decision", label: "Decision Log", singular: "Decision" },
  { key: "risk", label: "Risk Register", singular: "Risk", scored: true },
  { key: "assumption", label: "Assumption Log", singular: "Assumption" },
  { key: "constraint", label: "Constraint Log", singular: "Constraint" },
  { key: "opportunity", label: "Opportunity Log", singular: "Opportunity", scored: true },
  { key: "open_item", label: "Open Items Log", singular: "Open Item" },
  { key: "lessons_learned", label: "Lessons Learned Log", singular: "Lesson Learned" },
];
const TYPE_KEYS = LOG_TYPES.map((t) => t.key);
const STATUSES = ["open", "in_progress", "closed"];
const PRIORITIES = ["low", "medium", "high", "critical"];

function guardProject(req, res, next) {
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}
function guardResource(table) {
  return async (req, res, next) => {
    try {
      const pid = await resourceProjectId(table, req.params.id);
      if (!pid || !(await userCanAccessProject(req.user, pid))) return res.status(404).json({ error: "Not found." });
      next();
    } catch (e) { next(e); }
  };
}

function mapEntry(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    logType: row.log_type,
    entryNumber: row.entry_number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    ownerId: row.owner_id,
    ownerName: row.owner_name || null,
    dueDate: row.due_date,
    likelihood: row.likelihood,
    impact: row.impact,
    category: row.category,
    resolution: row.resolution,
    closedAt: row.closed_at,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  };
}

const SELECT_ENTRY = `
  SELECT pl.*, o.full_name AS owner_name, c.full_name AS created_by_name
    FROM project_logs pl
    LEFT JOIN users o ON o.id = pl.owner_id
    LEFT JOIN users c ON c.id = pl.created_by`;

async function fetchEntry(id) {
  const r = await pool.query(`${SELECT_ENTRY} WHERE pl.id = $1`, [id]);
  return r.rows[0] ? mapEntry(r.rows[0]) : null;
}

// ============================================================ LIST
// GET /api/projects/:projectId/logs?type=action[&status=open]
router.get("/projects/:projectId/logs", requireAuth, requireModule("logs"), guardProject, async (req, res) => {
  const type = req.query.type;
  if (type && !TYPE_KEYS.includes(type)) return res.status(400).json({ error: "Unknown log type." });
  try {
    const params = [req.params.projectId];
    let where = "pl.project_id = $1 AND pl.deleted_at IS NULL";
    if (type) { params.push(type); where += ` AND pl.log_type = $${params.length}`; }
    if (req.query.status && STATUSES.includes(req.query.status)) {
      params.push(req.query.status); where += ` AND pl.status = $${params.length}::project_log_status`;
    }

    const rows = await pool.query(`${SELECT_ENTRY} WHERE ${where} ORDER BY pl.entry_number DESC`, params);

    // Counts per type so the UI can show how full each register is.
    const counts = await pool.query(
      `SELECT log_type, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status <> 'closed')::int AS open
         FROM project_logs
        WHERE project_id = $1 AND deleted_at IS NULL
        GROUP BY log_type`,
      [req.params.projectId]
    );
    const countsByType = {};
    for (const c of counts.rows) countsByType[c.log_type] = { total: c.total, open: c.open };

    const members = await pool.query(
      `SELECT u.id, u.full_name FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1 ORDER BY u.full_name ASC`,
      [req.params.projectId]
    );

    res.json({
      entries: rows.rows.map(mapEntry),
      types: LOG_TYPES,
      counts: countsByType,
      statuses: STATUSES,
      priorities: PRIORITIES,
      canManage: isInternal(req.user),
      canDelete: req.user.role === "admin",
      members: members.rows.map((m) => ({ id: m.id, fullName: m.full_name })),
    });
  } catch (err) {
    console.error("[radah-pm] list project logs error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ CREATE
router.post(
  "/projects/:projectId/logs",
  requireAuth,
  requireModule("logs"),
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { logType, title, description, priority, ownerId, dueDate, likelihood, impact, category } = req.body || {};
    if (!TYPE_KEYS.includes(logType)) return res.status(400).json({ error: "Unknown log type." });
    if (!title || !String(title).trim()) return res.status(400).json({ error: "A title is required." });
    if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid priority." });

    try {
      if (ownerId) {
        const ok = await pool.query("SELECT 1 FROM users WHERE id = $1 AND org_id = $2", [ownerId, req.user.orgId]);
        if (ok.rows.length === 0) return res.status(400).json({ error: "That owner isn't in your organization." });
      }
      const next = await pool.query(
        "SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM project_logs WHERE project_id = $1 AND log_type = $2",
        [req.params.projectId, logType]
      );
      const ins = await pool.query(
        `INSERT INTO project_logs
           (project_id, log_type, entry_number, title, description, priority, owner_id, due_date, likelihood, impact, category, created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::project_log_priority,'medium'),$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          req.params.projectId, logType, next.rows[0].n, String(title).trim(), description || null,
          priority || null, ownerId || null, dueDate || null, likelihood || null, impact || null,
          category || null, req.user.id,
        ]
      );
      const entry = await fetchEntry(ins.rows[0].id);

      // Ping the owner directly — being assigned an item is the signal worth sending.
      if (entry.ownerId) {
        const label = (LOG_TYPES.find((t) => t.key === logType) || {}).singular || "Item";
        await notifyUser({
          userId: entry.ownerId,
          projectId: req.params.projectId,
          orgId: req.user.orgId,
          actorId: req.user.id,
          actorName: req.user.fullName,
          type: "log.assigned",
          title: `${label} #${entry.entryNumber} assigned to you: ${entry.title}`,
          body: entry.dueDate ? `Due ${new Date(entry.dueDate).toLocaleDateString()}.` : null,
          tab: "logs",
        });
      }
      res.status(201).json({ entry });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Entry number collision — please retry." });
      console.error("[radah-pm] create log entry error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================ EDIT
router.patch("/logs/:id", requireAuth, requireModule("logs"), requireRole("admin", "staff"), guardResource("project_logs"), async (req, res) => {
  try {
    const cur = await pool.query("SELECT * FROM project_logs WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const existing = cur.rows[0];
    if (!existing) return res.status(404).json({ error: "Log entry not found." });

    const map = {
      title: "title", description: "description", priority: "priority", ownerId: "owner_id",
      dueDate: "due_date", likelihood: "likelihood", impact: "impact", category: "category",
      resolution: "resolution", status: "status",
    };
    const updates = []; const values = []; let i = 1;
    for (const [bodyKey, col] of Object.entries(map)) {
      if (req.body[bodyKey] === undefined) continue;
      let v = req.body[bodyKey];
      if (bodyKey === "title" && !String(v || "").trim()) return res.status(400).json({ error: "Title cannot be empty." });
      if (bodyKey === "priority" && v && !PRIORITIES.includes(v)) return res.status(400).json({ error: "Invalid priority." });
      if (bodyKey === "status") {
        if (!STATUSES.includes(v)) return res.status(400).json({ error: "Invalid status." });
        updates.push(`status = $${i}::project_log_status`); values.push(v); i++;
        updates.push(`closed_at = ${v === "closed" ? "now()" : "NULL"}`);
        continue;
      }
      if (bodyKey === "priority") { updates.push(`priority = $${i}::project_log_priority`); values.push(v); i++; continue; }
      updates.push(`${col} = $${i}`); values.push(v === "" ? null : v); i++;
    }
    if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update." });

    values.push(req.params.id);
    await pool.query(`UPDATE project_logs SET ${updates.join(", ")} WHERE id = $${i}`, values);

    const entry = await fetchEntry(req.params.id);
    // Newly assigned to someone else? Tell them.
    if (req.body.ownerId && req.body.ownerId !== existing.owner_id) {
      const label = (LOG_TYPES.find((t) => t.key === entry.logType) || {}).singular || "Item";
      await notifyUser({
        userId: entry.ownerId,
        projectId: entry.projectId,
        orgId: req.user.orgId,
        actorId: req.user.id,
        actorName: req.user.fullName,
        type: "log.assigned",
        title: `${label} #${entry.entryNumber} assigned to you: ${entry.title}`,
        body: entry.dueDate ? `Due ${new Date(entry.dueDate).toLocaleDateString()}.` : null,
        tab: "logs",
      });
    }
    res.json({ entry });
  } catch (err) {
    console.error("[radah-pm] update log entry error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ DELETE (admin, soft)
router.delete("/logs/:id", requireAuth, requireModule("logs"), requireRole("admin"), guardResource("project_logs"), async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE project_logs SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id",
      [req.user.id, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Log entry not found." });
    res.json({ message: "Log entry moved to Deleted Items. An admin can restore it." });
  } catch (err) {
    console.error("[radah-pm] delete log entry error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
