// backend/routes/projects.js
//
// Visibility rules (enforced here, not just in the UI):
//   - admin/staff: see and manage all projects.
//   - client/trade_partner: see only projects where they have a row
//     in project_members. They cannot create, edit, or delete projects.

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const r2 = require("../db/r2");
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
    photoKey: row.photo_key || null,
    stage: row.stage || "lead",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Attach a short-lived presigned photo URL to each project that has one.
async function withPhotoUrls(projects) {
  if (!r2.isConfigured) return projects;
  return Promise.all(projects.map(async (p) => {
    if (p.photoKey) {
      try { p.photoUrl = await r2.getDownloadUrl(p.photoKey); } catch { p.photoUrl = null; }
    }
    return p;
  }));
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
    res.json({ projects: await withPhotoUrls(result.rows.map(mapProject)) });
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
/**
 * GET /api/projects/:id/deletion-preview
 * Admin only. Reports what a permanent project delete would destroy —
 * every child record that CASCADEs from the projects row — so the
 * confirmation dialog can say something true instead of a generic
 * "are you sure?". Counts across every module regardless of which
 * vertical this project's org is on; a query against a table with no
 * matching rows just comes back 0.
 */
router.get("/:id/deletion-preview", requireAuth, requireOrg, requireRole("admin"), async (req, res) => {
  try {
    const proj = await pool.query("SELECT id, name FROM projects WHERE id = $1 AND org_id = $2", [req.params.id, req.user.orgId]);
    if (!proj.rows[0]) return res.status(404).json({ error: "Project not found." });

    const count = (sql) => pool.query(sql, [req.params.id]).then((r) => r.rows[0].n);
    const [
      tasks, documents, budgetLines, members,
      rfis, submittals, changeOrders, dailyLogs, payApplications,
      assets, workOrders, inspections,
      approvalRequests, timeEntries,
    ] = await Promise.all([
      count("SELECT COUNT(*)::int AS n FROM tasks WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM documents WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM budget_lines WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM rfis WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM submittals WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM change_orders WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM daily_logs WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM pay_applications WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM assets WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM work_orders WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM inspections WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM approval_requests WHERE project_id = $1"),
      count("SELECT COUNT(*)::int AS n FROM time_entries WHERE project_id = $1"),
    ]);

    res.json({
      name: proj.rows[0].name,
      willPermanentlyDelete: {
        tasks, documents, budgetLines, teamMembers: members,
        rfis, submittals, changeOrders, dailyLogs, payApplications,
        assets, workOrders, inspections,
        approvalRequests, timeEntries,
      },
    });
  } catch (err) {
    console.error("[radah-pm] project deletion preview error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

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

// ============================================================
// PROJECT PHOTO (cover image) — admin/staff, org-scoped. Reuses R2.
// ============================================================
function requireR2(req, res, next) {
  if (!r2.isConfigured) return res.status(503).json({ error: "File storage is not configured yet." });
  next();
}
async function projectInOrg(projectId, orgId) {
  const r = await pool.query("SELECT photo_key FROM projects WHERE id = $1 AND org_id = $2", [projectId, orgId]);
  return r.rows[0] || null;
}

// POST /api/projects/:id/photo/upload-url  { fileName, contentType }
router.post("/:id/photo/upload-url", requireAuth, requireOrg, requireRole("admin", "staff"), requireR2, async (req, res) => {
  try {
    if (!(await projectInOrg(req.params.id, req.user.orgId))) return res.status(404).json({ error: "Project not found." });
    const { fileName, contentType } = req.body || {};
    if (!fileName) return res.status(400).json({ error: "fileName is required." });
    if (contentType && !String(contentType).startsWith("image/")) {
      return res.status(400).json({ error: "Project photo must be an image." });
    }
    const safe = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const storageKey = `projects/${req.params.id}/_photo/${crypto.randomUUID()}-${safe}`;
    const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
    res.json({ uploadUrl, storageKey });
  } catch (err) {
    console.error("[radah-pm] project photo upload-url error:", err);
    res.status(500).json({ error: "Could not prepare the upload." });
  }
});

// POST /api/projects/:id/photo/confirm  { storageKey }
router.post("/:id/photo/confirm", requireAuth, requireOrg, requireRole("admin", "staff"), requireR2, async (req, res) => {
  try {
    const cur = await projectInOrg(req.params.id, req.user.orgId);
    if (!cur) return res.status(404).json({ error: "Project not found." });
    const { storageKey } = req.body || {};
    if (!storageKey || !String(storageKey).startsWith(`projects/${req.params.id}/_photo/`)) {
      return res.status(400).json({ error: "Invalid storage key for this project photo." });
    }
    // Best-effort cleanup of any previous photo.
    if (cur.photo_key && cur.photo_key !== storageKey) {
      try { await r2.deleteObject(cur.photo_key); } catch { /* ignore */ }
    }
    await pool.query("UPDATE projects SET photo_key = $1 WHERE id = $2", [storageKey, req.params.id]);
    let photoUrl = null;
    try { photoUrl = await r2.getDownloadUrl(storageKey); } catch { /* ignore */ }
    res.json({ photoKey: storageKey, photoUrl });
  } catch (err) {
    console.error("[radah-pm] project photo confirm error:", err);
    res.status(500).json({ error: "Could not save the photo." });
  }
});

// DELETE /api/projects/:id/photo
router.delete("/:id/photo", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  try {
    const cur = await projectInOrg(req.params.id, req.user.orgId);
    if (!cur) return res.status(404).json({ error: "Project not found." });
    if (cur.photo_key && r2.isConfigured) { try { await r2.deleteObject(cur.photo_key); } catch { /* ignore */ } }
    await pool.query("UPDATE projects SET photo_key = NULL WHERE id = $1", [req.params.id]);
    res.json({ message: "Photo removed." });
  } catch (err) {
    console.error("[radah-pm] project photo delete error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Project lifecycle stages (advanced like a stepper; distinct from status).
const STAGE_KEYS = ["lead", "preconstruction", "mobilization", "construction", "substantial_completion", "closeout", "complete"];

// PATCH /api/projects/:id/stage  { stage }  (admin/staff, org-scoped)
router.patch("/:id/stage", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  const { stage } = req.body || {};
  if (!STAGE_KEYS.includes(stage)) return res.status(400).json({ error: "Invalid stage." });
  try {
    const r = await pool.query(
      "UPDATE projects SET stage = $1 WHERE id = $2 AND org_id = $3 RETURNING *",
      [stage, req.params.id, req.user.orgId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Project not found." });
    res.json({ project: mapProject(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] set project stage error:", err);
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
  "submittals",
  "project_logs",
  "time_entries",
  "approval_requests",
]);
async function resourceProjectId(table, id) {
  if (!RESOURCE_TABLES.has(table)) throw new Error("resourceProjectId: table not allowed");
  const r = await pool.query(`SELECT project_id FROM ${table} WHERE id = $1`, [id]);
  return r.rows[0] ? r.rows[0].project_id : null;
}
module.exports.resourceProjectId = resourceProjectId;
