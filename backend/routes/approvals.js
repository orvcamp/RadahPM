// backend/routes/approvals.js
//
// MangoDoe Projects — Approvals. A generic request -> reviewer ->
// approve/reject object, deliberately not tied to any specific thing being
// approved (linked_object_type/linked_object_id is optional context, not
// a hard dependency on another module existing). Does not touch Budget &
// Cost Control — that's what makes this "generic" rather than a Change
// Order clone; see the migration file's header comment for the reasoning.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapApproval(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    description: row.description,
    linkedObjectType: row.linked_object_type,
    linkedObjectId: row.linked_object_id,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name || null,
    approverId: row.approver_id,
    approverName: row.approver_name || null,
    status: row.status,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
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

async function guardApproval(req, res, next) {
  try {
    const r = await pool.query(
      "SELECT project_id, requested_by, approver_id, status FROM approval_requests WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Approval request not found." });
    }
    req.approval = row;
    next();
  } catch (e) { next(e); }
}

const SELECT_WITH_NAMES = `
  SELECT ar.*, rq.full_name AS requested_by_name, ap.full_name AS approver_name
    FROM approval_requests ar
    JOIN users rq ON rq.id = ar.requested_by
    LEFT JOIN users ap ON ap.id = ar.approver_id
`;

// GET /api/projects/:projectId/approvals — optional ?status= filter.
router.get("/projects/:projectId/approvals", requireAuth, requireModule("approvals"), guardProject, async (req, res) => {
  const { status } = req.query || {};
  const conditions = ["ar.project_id = $1", "ar.deleted_at IS NULL"];
  const values = [req.params.projectId];
  if (status) { conditions.push("ar.status = $2"); values.push(status); }
  try {
    const r = await pool.query(`${SELECT_WITH_NAMES} WHERE ${conditions.join(" AND ")} ORDER BY ar.created_at DESC`, values);
    res.json({ approvals: r.rows.map(mapApproval) });
  } catch (err) {
    console.error("[radah-pm] list approvals error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/projects/:projectId/approvals
// Any project member can request an approval (that's the point — a
// contributor asking a manager to sign off on something), not just
// admin/staff. The approver, if specified, must already be on the project.
router.post("/projects/:projectId/approvals", requireAuth, requireModule("approvals"), guardProject, async (req, res) => {
  const { type, title, description, linkedObjectType, linkedObjectId, approverId } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required." });
  try {
    if (approverId) {
      const member = await pool.query(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        [req.params.projectId, approverId]
      );
      const isInternalUser = await pool.query("SELECT role FROM users WHERE id = $1", [approverId]);
      const internal = isInternalUser.rows[0] && (isInternalUser.rows[0].role === "admin" || isInternalUser.rows[0].role === "staff");
      if (!internal && member.rows.length === 0) {
        return res.status(400).json({ error: "The approver must already be on this project's team." });
      }
    }
    const r = await pool.query(
      `INSERT INTO approval_requests (project_id, type, title, description, linked_object_type, linked_object_id, requested_by, approver_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.projectId, type || "general", title.trim(), description || null, linkedObjectType || null,
        linkedObjectId || null, req.user.id, approverId || null]
    );
    res.status(201).json({ approval: mapApproval({ ...r.rows[0], requested_by_name: req.user.fullName }) });
  } catch (err) {
    console.error("[radah-pm] create approval error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// PATCH /api/approvals/:id — edit title/description/approver while pending.
router.patch("/approvals/:id", requireAuth, guardApproval, async (req, res) => {
  if (req.approval.status !== "pending") {
    return res.status(409).json({ error: "Only a pending approval request can be edited." });
  }
  if (req.approval.requested_by !== req.user.id && req.user.role !== "admin" && req.user.role !== "staff") {
    return res.status(403).json({ error: "Only the requester or a manager can edit this." });
  }
  const bodyKeyMap = { title: "title", description: "description", approverId: "approver_id" };
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
    await pool.query(`UPDATE approval_requests SET ${updates.join(", ")} WHERE id = $${i}`, values);
    const r = await pool.query(`${SELECT_WITH_NAMES} WHERE ar.id = $1`, [req.params.id]);
    res.json({ approval: mapApproval(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update approval error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/approvals/:id/decide — Body: { decision: "approved"|"rejected", note? }
// Only the assigned approver, or an admin/staff (a manager can always
// step in), can decide. Once decided, it's final — no re-deciding; create
// a new request instead, same as Change Orders don't get un-approved.
router.post("/approvals/:id/decide", requireAuth, guardApproval, async (req, res) => {
  const { decision, note } = req.body || {};
  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }
  if (req.approval.status !== "pending") {
    return res.status(409).json({ error: "This request has already been decided." });
  }
  const isAssignedApprover = req.approval.approver_id === req.user.id;
  const isManager = req.user.role === "admin" || req.user.role === "staff";
  if (!isAssignedApprover && !isManager) {
    return res.status(403).json({ error: "Only the assigned approver can decide this." });
  }
  try {
    await pool.query(
      `UPDATE approval_requests SET status = $1, decision_note = $2, decided_at = now(),
              approver_id = COALESCE(approver_id, $3)
        WHERE id = $4`,
      [decision, note || null, req.user.id, req.params.id]
    );
    const r = await pool.query(`${SELECT_WITH_NAMES} WHERE ar.id = $1`, [req.params.id]);
    res.json({ approval: mapApproval(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] decide approval error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/approvals/:id", requireAuth, requireRole("admin", "staff"), guardApproval, async (req, res) => {
  try {
    await pool.query("UPDATE approval_requests SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Approval request removed." });
  } catch (err) {
    console.error("[radah-pm] delete approval error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
