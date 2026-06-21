// backend/routes/projects.js
//
// Visibility rules (enforced here, not just in the UI):
//   - admin/staff: see and manage all projects.
//   - client/trade_partner: see only projects where they have a row
//     in project_members. They cannot create, edit, or delete projects.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");

const router = express.Router();

/**
 * Throws-free helper: confirms the current user may access projectId.
 * Internal users always pass. External users must have a membership row.
 */
async function userCanAccessProject(user, projectId) {
  if (isInternal(user)) return true;
  const result = await pool.query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, user.id]
  );
  return result.rows.length > 0;
}

function mapProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clientOrgName: row.client_org_name,
    status: row.status,
    startDate: row.start_date,
    targetEndDate: row.target_end_date,
    actualEndDate: row.actual_end_date,
    location: row.location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/projects
 * Admin/staff: all projects. Client/trade_partner: only their assigned projects.
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    let result;
    if (isInternal(req.user)) {
      result = await pool.query("SELECT * FROM projects ORDER BY created_at DESC");
    } else {
      result = await pool.query(
        `SELECT p.* FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = $1
         ORDER BY p.created_at DESC`,
        [req.user.id]
      );
    }
    res.json({ projects: result.rows.map(mapProject) });
  } catch (err) {
    console.error("[radah-pm] list projects error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/projects
 * Admin/staff only.
 * Body: { name, description, clientOrgName, status, startDate, targetEndDate, location }
 */
router.post("/", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  const { name, description, clientOrgName, status, startDate, targetEndDate, location } =
    req.body || {};

  if (!name) {
    return res.status(400).json({ error: "Project name is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO projects (name, description, client_org_name, status, start_date, target_end_date, location, created_by)
       VALUES ($1, $2, $3, COALESCE($4, 'planning'), $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        description || null,
        clientOrgName || null,
        status || null,
        startDate || null,
        targetEndDate || null,
        location || null,
        req.user.id,
      ]
    );
    res.status(201).json({ project: mapProject(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] create project error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/projects/:id
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    const result = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found." });
    }
    res.json({ project: mapProject(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] get project error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * PATCH /api/projects/:id
 * Admin/staff only.
 */
router.patch("/:id", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  const fields = ["name", "description", "client_org_name", "status", "start_date", "target_end_date", "actual_end_date", "location"];
  const bodyKeyMap = {
    name: "name",
    description: "description",
    clientOrgName: "client_org_name",
    status: "status",
    startDate: "start_date",
    targetEndDate: "target_end_date",
    actualEndDate: "actual_end_date",
    location: "location",
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
      `UPDATE projects SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found." });
    }
    res.json({ project: mapProject(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update project error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * DELETE /api/projects/:id
 * Admin only (more destructive than other admin/staff actions).
 */
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM projects WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found." });
    }
    res.json({ message: "Project deleted." });
  } catch (err) {
    console.error("[radah-pm] delete project error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// PROJECT MEMBERS
// ============================================================

/**
 * GET /api/projects/:id/members
 */
router.get("/:id/members", requireAuth, async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    const result = await pool.query(
      `SELECT pm.id, pm.membership_role, u.id as user_id, u.full_name, u.email, u.role, u.company_name
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.added_at ASC`,
      [req.params.id]
    );
    res.json({
      members: result.rows.map((r) => ({
        membershipId: r.id,
        membershipRole: r.membership_role,
        userId: r.user_id,
        fullName: r.full_name,
        email: r.email,
        platformRole: r.role,
        companyName: r.company_name,
      })),
    });
  } catch (err) {
    console.error("[radah-pm] list members error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/projects/:id/members
 * Admin/staff only. Adds a client or trade partner to a project.
 * Body: { userId, membershipRole }
 */
router.post("/:id/members", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  const { userId, membershipRole } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: "userId is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO project_members (project_id, user_id, membership_role)
       VALUES ($1, $2, COALESCE($3, 'viewer'))
       ON CONFLICT (project_id, user_id) DO UPDATE SET membership_role = EXCLUDED.membership_role
       RETURNING *`,
      [req.params.id, userId, membershipRole || null]
    );
    res.status(201).json({ membership: result.rows[0] });
  } catch (err) {
    console.error("[radah-pm] add member error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * DELETE /api/projects/:id/members/:userId
 * Admin/staff only.
 */
router.delete("/:id/members/:userId", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId]
    );
    res.json({ message: "Member removed from project." });
  } catch (err) {
    console.error("[radah-pm] remove member error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
module.exports.userCanAccessProject = userCanAccessProject;
