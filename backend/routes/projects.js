// backend/routes/projects.js
//
// Visibility rules (enforced here, not just in the UI):
//   - admin/staff: see and manage all projects.
//   - client/trade_partner: see only projects where they have a row
//     in project_members. They cannot create, edit, or delete projects.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal, requireOrg } = require("../middleware/auth");

const router = express.Router();

/**
 * Throws-free helper: confirms the current user may access projectId.
 * Strictly org-scoped: the project must belong to the user's organization.
 * Within that org, internal users (admin/staff) see all projects; external
 * users (client/trade_partner) need a project_members row.
 * (Platform-admin cross-org access is a separate, later capability — not a
 * bypass here — so this function can never leak across tenants.)
 */
async function userCanAccessProject(user, projectId) {
  const proj = await pool.query("SELECT org_id FROM projects WHERE id = $1", [projectId]);
  if (proj.rows.length === 0) return false;
  const projectOrgId = proj.rows[0].org_id;
  if (!user.orgId || user.orgId !== projectOrgId) return false;
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
router.get("/", requireAuth, requireOrg, async (req, res) => {
  try {
    let result;
    if (isInternal(req.user)) {
      result = await pool.query(
        "SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at DESC",
        [req.user.orgId]
      );
    } else {
      result = await pool.query(
        `SELECT p.* FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = $1 AND p.org_id = $2
         ORDER BY p.created_at DESC`,
        [req.user.id, req.user.orgId]
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
router.post("/", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  const { name, description, clientOrgName, status, startDate, targetEndDate, location } =
    req.body || {};

  if (!name) {
    return res.status(400).json({ error: "Project name is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO projects (name, description, client_org_name, status, start_date, target_end_date, location, created_by, org_id)
       VALUES ($1, $2, $3, COALESCE($4::project_status, 'planning'::project_status), $5, $6, $7, $8, $9)
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
        req.user.orgId,
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
router.patch("/:id", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
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
  const idIdx = i;
  values.push(req.user.orgId);
  const orgIdx = i + 1;

  try {
    const result = await pool.query(
      `UPDATE projects SET ${updates.join(", ")} WHERE id = $${idIdx} AND org_id = $${orgIdx} RETURNING *`,
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
router.delete("/:id", requireAuth, requireOrg, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id",
      [req.params.id, req.user.orgId]
    );
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
router.post("/:id/members", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  const { userId, membershipRole } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: "userId is required." });
  }

  try {
    // The project must belong to the caller's org.
    const proj = await pool.query("SELECT org_id FROM projects WHERE id = $1", [req.params.id]);
    if (proj.rows.length === 0) return res.status(404).json({ error: "Project not found." });
    if (proj.rows[0].org_id !== req.user.orgId) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    // The user being added must belong to the same org.
    const target = await pool.query("SELECT org_id FROM users WHERE id = $1", [userId]);
    if (target.rows.length === 0 || target.rows[0].org_id !== req.user.orgId) {
      return res.status(400).json({ error: "That user isn't part of your organization." });
    }

    const result = await pool.query(
      `INSERT INTO project_members (project_id, user_id, membership_role)
       VALUES ($1, $2, COALESCE($3::membership_role, 'viewer'::membership_role))
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
router.delete("/:id/members/:userId", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  try {
    const proj = await pool.query("SELECT org_id FROM projects WHERE id = $1", [req.params.id]);
    if (proj.rows.length === 0) return res.status(404).json({ error: "Project not found." });
    if (proj.rows[0].org_id !== req.user.orgId) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
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

// Resolves the owning project_id for a child resource, by table. The table
// name is checked against a fixed whitelist (never user input), so the
// interpolation below is safe. Returns null if the row doesn't exist.
// Used by child modules to enforce org isolation on bare-:id write routes.
const RESOURCE_TABLES = new Set([
  "budget_categories",
  "budget_lines",
  "budget_commitments",
  "budget_expenses",
  "change_orders",
  "daily_logs",
  "document_folders",
  "phases",
  "tasks",
  "rfis",
]);
async function resourceProjectId(table, id) {
  if (!RESOURCE_TABLES.has(table)) throw new Error("resourceProjectId: table not allowed");
  const r = await pool.query(`SELECT project_id FROM ${table} WHERE id = $1`, [id]);
  return r.rows[0] ? r.rows[0].project_id : null;
}
module.exports.resourceProjectId = resourceProjectId;
