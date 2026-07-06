// backend/routes/phases.js

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");
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

function mapPhase(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

/**
 * GET /api/projects/:projectId/phases
 */
router.get("/projects/:projectId/phases", requireAuth, async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    const result = await pool.query(
      "SELECT * FROM phases WHERE project_id = $1 ORDER BY sort_order ASC, start_date ASC",
      [req.params.projectId]
    );
    res.json({ phases: result.rows.map(mapPhase) });
  } catch (err) {
    console.error("[radah-pm] list phases error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/projects/:projectId/phases
 * Admin/staff only.
 * Body: { name, sortOrder, startDate, endDate }
 */
router.post("/projects/:projectId/phases", requireAuth, requireRole("admin", "staff"), guardProject, async (req, res) => {
  const { name, sortOrder, startDate, endDate } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "Phase name is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO phases (project_id, name, sort_order, start_date, end_date)
       VALUES ($1, $2, COALESCE($3, 0), $4, $5)
       RETURNING *`,
      [req.params.projectId, name, sortOrder ?? null, startDate || null, endDate || null]
    );
    res.status(201).json({ phase: mapPhase(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] create phase error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * PATCH /api/phases/:id
 * Admin/staff only.
 */
router.patch("/phases/:id", requireAuth, requireRole("admin", "staff"), guardResource("phases"), async (req, res) => {
  const bodyKeyMap = {
    name: "name",
    sortOrder: "sort_order",
    startDate: "start_date",
    endDate: "end_date",
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

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields provided to update." });
  }
  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE phases SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Phase not found." });
    }
    res.json({ phase: mapPhase(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update phase error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * DELETE /api/phases/:id
 * Admin/staff only.
 */
router.delete("/phases/:id", requireAuth, requireRole("admin", "staff"), guardResource("phases"), async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM phases WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Phase not found." });
    }
    res.json({ message: "Phase deleted." });
  } catch (err) {
    console.error("[radah-pm] delete phase error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
