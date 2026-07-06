// backend/routes/tasks.js
//
// Visibility within a project a user can already access:
//   - admin/staff: see all tasks in the project.
//   - client: see all tasks in the project (owners want full visibility
//     into their own project's progress).
//   - trade_partner: see only tasks assigned to them within the project.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");

const router = express.Router();

// --- org-isolation guards (Phase 3 A2) ---
function guardProject(req, res, next) {
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}
function guardResource(table) {
  return async (req, res, next) => {
    try {
      const pid = await resourceProjectId(table, req.params.id);
      if (!pid || !(await userCanAccessProject(req.user, pid))) {
        return res.status(404).json({ error: "Not found." });
      }
      next();
    } catch (e) { next(e); }
  };
}

function mapTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    phaseId: row.phase_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    description: row.description,
    status: row.status,
    isMilestone: row.is_milestone,
    startDate: row.start_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name || null,
    createdBy: row.created_by,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/projects/:projectId/tasks
 * Optional ?phaseId=... filter.
 */
router.get("/projects/:projectId/tasks", requireAuth, async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    const { phaseId } = req.query;
    const restrictToSelf = req.user.role === "trade_partner";

    const conditions = ["t.project_id = $1"];
    const values = [req.params.projectId];
    let i = 2;

    if (phaseId) {
      conditions.push(`t.phase_id = $${i}`);
      values.push(phaseId);
      i++;
    }
    if (restrictToSelf) {
      conditions.push(`t.assigned_to = $${i}`);
      values.push(req.user.id);
      i++;
    }

    const result = await pool.query(
      `SELECT t.*, u.full_name as assigned_to_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE ${conditions.join(" AND ")}
       ORDER BY t.sort_order ASC, t.start_date ASC NULLS LAST`,
      values
    );
    res.json({ tasks: result.rows.map(mapTask) });
  } catch (err) {
    console.error("[radah-pm] list tasks error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/projects/:projectId/tasks
 * Admin/staff only (trade partners and clients cannot create tasks in Phase 1).
 * Body: { title, description, phaseId, status, isMilestone, startDate, dueDate, assignedTo, sortOrder }
 */
router.post(
  "/projects/:projectId/tasks",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { title, description, phaseId, status, isMilestone, startDate, dueDate, assignedTo, sortOrder, parentTaskId } =
      req.body || {};

    if (!title) {
      return res.status(400).json({ error: "Task title is required." });
    }

    try {
      // If assigning to someone, they must already be a member of this
      // project (internal staff/admin are exempt since they have
      // implicit access to all projects).
      if (assignedTo) {
        const assigneeResult = await pool.query("SELECT role FROM users WHERE id = $1", [assignedTo]);
        const assignee = assigneeResult.rows[0];
        if (!assignee) {
          return res.status(400).json({ error: "Assigned user not found." });
        }
        if (assignee.role === "client" || assignee.role === "trade_partner") {
          const membership = await pool.query(
            "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
            [req.params.projectId, assignedTo]
          );
          if (membership.rows.length === 0) {
            return res.status(400).json({
              error: "This person must be added to the project's team before being assigned a task.",
            });
          }
        }
      }

      const result = await pool.query(
        `INSERT INTO tasks
           (project_id, phase_id, parent_task_id, title, description, status, is_milestone, start_date, due_date, assigned_to, created_by, sort_order)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::task_status, 'not_started'::task_status), COALESCE($7, FALSE), $8, $9, $10, $11, COALESCE($12, 0))
         RETURNING *`,
        [
          req.params.projectId,
          phaseId || null,
          parentTaskId || null,
          title,
          description || null,
          status || null,
          isMilestone ?? null,
          startDate || null,
          dueDate || null,
          assignedTo || null,
          req.user.id,
          sortOrder ?? null,
        ]
      );
      res.status(201).json({ task: mapTask(result.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create task error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

/**
 * GET /api/tasks/:id
 */
router.get("/tasks/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.full_name as assigned_to_name FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1`,
      [req.params.id]
    );
    const task = result.rows[0];
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    const allowed = await userCanAccessProject(req.user, task.project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this task." });
    }
    if (req.user.role === "trade_partner" && task.assigned_to !== req.user.id) {
      return res.status(403).json({ error: "This task is not assigned to you." });
    }

    res.json({ task: mapTask(task) });
  } catch (err) {
    console.error("[radah-pm] get task error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * PATCH /api/tasks/:id
 * Admin/staff: can edit any field.
 * Trade partner: can only update `status` on tasks assigned to them
 * (e.g. marking their own work in_progress/completed) — cannot reassign,
 * retitle, or reschedule.
 * Client: read-only in Phase 1 (no edits).
 */
router.patch("/tasks/:id", requireAuth, async (req, res) => {
  try {
    const existing = await pool.query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    const task = existing.rows[0];
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    const allowed = await userCanAccessProject(req.user, task.project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this task." });
    }

    if (req.user.role === "client") {
      return res.status(403).json({ error: "Clients have view-only access to tasks in Phase 1." });
    }

    if (req.user.role === "trade_partner") {
      if (task.assigned_to !== req.user.id) {
        return res.status(403).json({ error: "This task is not assigned to you." });
      }
      const allowedKeys = Object.keys(req.body || {});
      const onlyStatus = allowedKeys.every((k) => k === "status");
      if (!onlyStatus) {
        return res.status(403).json({
          error: "You can only update the status of tasks assigned to you.",
        });
      }
    }

    // Same membership guard as task creation: an admin/staff reassigning
    // a task to a client/trade_partner must pick someone already on the
    // project's team, or that person will never see the task they're
    // assigned (visibility is scoped by project_members).
    if (req.body.assignedTo) {
      const assigneeResult = await pool.query("SELECT role FROM users WHERE id = $1", [
        req.body.assignedTo,
      ]);
      const assignee = assigneeResult.rows[0];
      if (!assignee) {
        return res.status(400).json({ error: "Assigned user not found." });
      }
      if (assignee.role === "client" || assignee.role === "trade_partner") {
        const membership = await pool.query(
          "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
          [task.project_id, req.body.assignedTo]
        );
        if (membership.rows.length === 0) {
          return res.status(400).json({
            error: "This person must be added to the project's team before being assigned a task.",
          });
        }
      }
    }

    const bodyKeyMap = {
      title: "title",
      description: "description",
      phaseId: "phase_id",
      status: "status",
      isMilestone: "is_milestone",
      startDate: "start_date",
      dueDate: "due_date",
      assignedTo: "assigned_to",
      sortOrder: "sort_order",
    };

    const updates = [];
    const values = [];
    let i = 1;
    for (const [bodyKey, column] of Object.entries(bodyKeyMap)) {
      if (req.body[bodyKey] !== undefined) {
        updates.push(`${column} = $${i}`);
        values.push(req.body[bodyKey]);
        i++;
      }
    }

    // Auto-stamp completed_at when status flips to completed; clear it otherwise.
    if (req.body.status === "completed") {
      updates.push(`completed_at = now()`);
    } else if (req.body.status && req.body.status !== "completed") {
      updates.push(`completed_at = NULL`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields provided to update." });
    }

    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE tasks SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ task: mapTask(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update task error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * DELETE /api/tasks/:id
 * Admin/staff only.
 */
router.delete("/tasks/:id", requireAuth, requireRole("admin", "staff"), guardResource("tasks"), async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM tasks WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found." });
    }
    res.json({ message: "Task deleted." });
  } catch (err) {
    console.error("[radah-pm] delete task error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// TASK COMMENTS
// ============================================================

router.get("/tasks/:id/comments", requireAuth, async (req, res) => {
  try {
    const existing = await pool.query("SELECT project_id FROM tasks WHERE id = $1", [
      req.params.id,
    ]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Task not found." });
    }
    const allowed = await userCanAccessProject(req.user, existing.rows[0].project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this task." });
    }

    const result = await pool.query(
      `SELECT c.*, u.full_name FROM task_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({
      comments: result.rows.map((r) => ({
        id: r.id,
        body: r.body,
        userId: r.user_id,
        fullName: r.full_name,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("[radah-pm] list comments error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post("/tasks/:id/comments", requireAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) {
    return res.status(400).json({ error: "Comment body is required." });
  }

  try {
    const existing = await pool.query("SELECT project_id FROM tasks WHERE id = $1", [
      req.params.id,
    ]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Task not found." });
    }
    const allowed = await userCanAccessProject(req.user, existing.rows[0].project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this task." });
    }

    const result = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.id, body.trim()]
    );
    res.status(201).json({
      comment: {
        id: result.rows[0].id,
        body: result.rows[0].body,
        userId: req.user.id,
        fullName: req.user.fullName,
        createdAt: result.rows[0].created_at,
      },
    });
  } catch (err) {
    console.error("[radah-pm] create comment error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
