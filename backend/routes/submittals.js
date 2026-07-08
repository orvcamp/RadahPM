// backend/routes/submittals.js
//
// Per-project submittals. Workflow: draft -> submitted -> under_review ->
// returned (with a disposition: approved / approved_as_noted /
// revise_resubmit / rejected). A returned submittal can spawn a revision
// (same number, revision+1, linked to the prior round). Attachments reuse
// the R2/Documents pipeline.
//
// Permissions:
//   - create/edit/submit/revise: admin/staff or trade_partner members.
//   - start review / return / reopen: admin/staff or client members.
//   - view: any project member. delete: admin/staff.

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");
const { requireModule } = require("../orgModules");
const r2 = require("../db/r2");

const router = express.Router();

const DISPOSITIONS = ["approved", "approved_as_noted", "revise_resubmit", "rejected"];

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
function requireR2(req, res, next) {
  if (!r2.isConfigured) return res.status(503).json({ error: "File storage is not configured yet." });
  next();
}
function buildStorageKey(projectId, fileName) {
  const safe = (fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `projects/${projectId}/${crypto.randomUUID()}-${safe}`;
}
async function isProjectMember(userId, projectId) {
  const r = await pool.query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  return r.rows.length > 0;
}
async function canSubmit(user, projectId) {
  if (isInternal(user)) return true;
  if (user.role === "trade_partner") return isProjectMember(user.id, projectId);
  return false;
}
async function canReview(user, projectId) {
  if (isInternal(user)) return true;
  if (user.role === "client") return isProjectMember(user.id, projectId);
  return false;
}

function mapSubmittal(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    submittalNumber: row.submittal_number,
    revision: row.revision,
    previousSubmittalId: row.previous_submittal_id,
    title: row.title,
    specSection: row.spec_section,
    description: row.description,
    status: row.status,
    disposition: row.disposition,
    dueDate: row.due_date,
    ballInCourt: row.ball_in_court,
    ballInCourtName: row.ball_in_court_name || null,
    reviewNotes: row.review_notes,
    reviewedByName: row.reviewed_by_name || null,
    reviewedAt: row.reviewed_at,
    submittedByName: row.submitted_by_name || null,
    submittedAt: row.submitted_at,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  };
}

const JOIN_NAMES = `
  LEFT JOIN users bic ON bic.id = s.ball_in_court
  LEFT JOIN users rv ON rv.id = s.reviewed_by
  LEFT JOIN users sb ON sb.id = s.submitted_by
  LEFT JOIN users cu ON cu.id = s.created_by`;
const SELECT_NAMES = `s.*, bic.full_name AS ball_in_court_name, rv.full_name AS reviewed_by_name,
  sb.full_name AS submitted_by_name, cu.full_name AS created_by_name`;

async function fetchSubmittal(id, runner = pool) {
  const r = await runner.query(`SELECT ${SELECT_NAMES} FROM submittals s ${JOIN_NAMES} WHERE s.id = $1`, [id]);
  return r.rows[0] ? mapSubmittal(r.rows[0]) : null;
}

// ============================================================ LIST
router.get("/projects/:projectId/submittals", requireAuth, requireModule("submittals"), guardProject, async (req, res) => {
  try {
    const subsRes = await pool.query(
      `SELECT ${SELECT_NAMES} FROM submittals s ${JOIN_NAMES}
        WHERE s.project_id = $1 AND s.deleted_at IS NULL
        ORDER BY s.submittal_number DESC, s.revision DESC`,
      [req.params.projectId]
    );
    const ids = subsRes.rows.map((r) => r.id);
    const attachRes = await pool.query(
      `SELECT sd.id, sd.submittal_id, sd.document_id, d.file_name, d.uploaded_by
         FROM submittal_documents sd JOIN documents d ON d.id = sd.document_id
        WHERE sd.submittal_id = ANY($1::uuid[]) ORDER BY sd.created_at ASC`,
      [ids]
    );
    const bySub = {};
    for (const a of attachRes.rows) {
      (bySub[a.submittal_id] = bySub[a.submittal_id] || []).push({
        id: a.id, documentId: a.document_id, fileName: a.file_name,
        canDelete: isInternal(req.user) || a.uploaded_by === req.user.id,
      });
    }
    const membersRes = await pool.query(
      `SELECT u.id, u.full_name FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY u.full_name ASC`,
      [req.params.projectId]
    );
    const submittals = subsRes.rows.map((row) => {
      const s = mapSubmittal(row);
      s.attachments = bySub[s.id] || [];
      return s;
    });
    res.json({
      submittals,
      canSubmit: await canSubmit(req.user, req.params.projectId),
      canReview: await canReview(req.user, req.params.projectId),
      dispositions: DISPOSITIONS,
      members: membersRes.rows.map((m) => ({ id: m.id, fullName: m.full_name })),
    });
  } catch (err) {
    console.error("[radah-pm] list submittals error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ CREATE
router.post("/projects/:projectId/submittals", requireAuth, requireModule("submittals"), guardProject, async (req, res) => {
  try {
    if (!(await canSubmit(req.user, req.params.projectId))) {
      return res.status(403).json({ error: "You don't have permission to create submittals on this project." });
    }
    const { title, specSection, description, dueDate, ballInCourt } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "A title is required." });
    const numRes = await pool.query("SELECT COALESCE(MAX(submittal_number),0)+1 AS next FROM submittals WHERE project_id = $1", [req.params.projectId]);
    const ins = await pool.query(
      `INSERT INTO submittals (project_id, submittal_number, revision, title, spec_section, description, due_date, ball_in_court, status, created_by)
       VALUES ($1,$2,0,$3,$4,$5,$6,$7,'draft',$8) RETURNING id`,
      [req.params.projectId, numRes.rows[0].next, title.trim(), specSection || null, description || null, dueDate || null, ballInCourt || null, req.user.id]
    );
    res.status(201).json({ submittal: await fetchSubmittal(ins.rows[0].id) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Submittal number collision — please retry." });
    console.error("[radah-pm] create submittal error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ EDIT (creator/internal, not while returned/under_review-locked)
router.patch("/submittals/:id", requireAuth, requireModule("submittals"), guardResource("submittals"), async (req, res) => {
  try {
    const cur = await pool.query("SELECT * FROM submittals WHERE id = $1", [req.params.id]);
    const sub = cur.rows[0];
    if (!sub) return res.status(404).json({ error: "Submittal not found." });
    if (!(await canSubmit(req.user, sub.project_id))) {
      return res.status(403).json({ error: "You don't have permission to edit submittals." });
    }
    if (sub.status === "returned") return res.status(409).json({ error: "This submittal is returned. Create a revision instead of editing." });

    const map = { title: "title", specSection: "spec_section", description: "description", dueDate: "due_date", ballInCourt: "ball_in_court" };
    const updates = []; const values = []; let i = 1;
    for (const [k, col] of Object.entries(map)) {
      if (req.body[k] !== undefined) {
        if (k === "title" && !String(req.body[k]).trim()) return res.status(400).json({ error: "Title cannot be empty." });
        updates.push(`${col} = $${i}`); values.push(req.body[k] || null); i++;
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update." });
    values.push(req.params.id);
    await pool.query(`UPDATE submittals SET ${updates.join(", ")} WHERE id = $${i}`, values);
    res.json({ submittal: await fetchSubmittal(req.params.id) });
  } catch (err) {
    console.error("[radah-pm] update submittal error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ TRANSITION
// action = submit | start_review | return | reopen
router.post("/submittals/:id/transition", requireAuth, requireModule("submittals"), guardResource("submittals"), async (req, res) => {
  const action = (req.body && req.body.action) || "";
  if (!["submit", "start_review", "return", "reopen"].includes(action)) return res.status(400).json({ error: "Unknown action." });
  try {
    const cur = await pool.query("SELECT * FROM submittals WHERE id = $1", [req.params.id]);
    const sub = cur.rows[0];
    if (!sub) return res.status(404).json({ error: "Submittal not found." });

    if (action === "submit") {
      if (!(await canSubmit(req.user, sub.project_id))) return res.status(403).json({ error: "You can't submit this." });
      if (sub.status !== "draft") return res.status(409).json({ error: "Only draft submittals can be submitted." });
      await pool.query("UPDATE submittals SET status='submitted', submitted_by=$1, submitted_at=now() WHERE id=$2", [req.user.id, sub.id]);
    } else if (action === "start_review") {
      if (!(await canReview(req.user, sub.project_id))) return res.status(403).json({ error: "You can't review this." });
      if (sub.status !== "submitted") return res.status(409).json({ error: "Only submitted submittals can be moved to review." });
      await pool.query("UPDATE submittals SET status='under_review' WHERE id=$1", [sub.id]);
    } else if (action === "return") {
      if (!(await canReview(req.user, sub.project_id))) return res.status(403).json({ error: "You can't return this." });
      if (sub.status !== "under_review" && sub.status !== "submitted") return res.status(409).json({ error: "Only submitted or under-review submittals can be returned." });
      const { disposition, reviewNotes } = req.body || {};
      if (!DISPOSITIONS.includes(disposition)) return res.status(400).json({ error: "A valid disposition is required." });
      await pool.query(
        "UPDATE submittals SET status='returned', disposition=$1::submittal_disposition, review_notes=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4",
        [disposition, reviewNotes || null, req.user.id, sub.id]
      );
    } else if (action === "reopen") {
      if (!(await canReview(req.user, sub.project_id))) return res.status(403).json({ error: "You can't reopen this." });
      if (sub.status !== "returned") return res.status(409).json({ error: "Only returned submittals can be reopened." });
      await pool.query("UPDATE submittals SET status='under_review', disposition=NULL WHERE id=$1", [sub.id]);
    }
    res.json({ submittal: await fetchSubmittal(req.params.id) });
  } catch (err) {
    console.error("[radah-pm] submittal transition error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ CREATE REVISION
// From a returned submittal, spawn the next round (same number, revision+1).
router.post("/submittals/:id/revise", requireAuth, requireModule("submittals"), guardResource("submittals"), async (req, res) => {
  const client = await pool.connect();
  try {
    const cur = await client.query("SELECT * FROM submittals WHERE id = $1", [req.params.id]);
    const prev = cur.rows[0];
    if (!prev) { client.release(); return res.status(404).json({ error: "Submittal not found." }); }
    if (!(await canSubmit(req.user, prev.project_id))) { client.release(); return res.status(403).json({ error: "You can't create a revision." }); }
    if (prev.status !== "returned") { client.release(); return res.status(409).json({ error: "Only a returned submittal can be revised." }); }

    // Ensure we branch from the latest revision of this package.
    const latest = await client.query(
      "SELECT MAX(revision) AS maxrev FROM submittals WHERE project_id=$1 AND submittal_number=$2",
      [prev.project_id, prev.submittal_number]
    );
    const nextRev = Number(latest.rows[0].maxrev) + 1;

    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO submittals (project_id, submittal_number, revision, previous_submittal_id, title, spec_section, description, due_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING id`,
      [prev.project_id, prev.submittal_number, nextRev, prev.id, prev.title, prev.spec_section, prev.description, prev.due_date, req.user.id]
    );
    await client.query("COMMIT");
    res.status(201).json({ submittal: await fetchSubmittal(ins.rows[0].id) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: "Revision already exists — refresh and try again." });
    console.error("[radah-pm] revise submittal error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

// ============================================================ DELETE (admin/staff)
router.delete("/submittals/:id", requireAuth, requireModule("submittals"), requireRole("admin"), guardResource("submittals"), async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE submittals SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id",
      [req.user.id, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Submittal not found." });
    res.json({ message: "Submittal moved to Deleted Items. An admin can restore it." });
  } catch (err) {
    console.error("[radah-pm] delete submittal error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================ ATTACHMENTS
router.post("/projects/:projectId/submittals/:subId/attachments/upload-url", requireAuth, requireModule("submittals"), requireR2, guardProject, async (req, res) => {
  try {
    const sub = await pool.query("SELECT id, project_id FROM submittals WHERE id = $1", [req.params.subId]);
    if (!sub.rows[0] || sub.rows[0].project_id !== req.params.projectId) return res.status(404).json({ error: "Submittal not found." });
    const { fileName, contentType } = req.body || {};
    if (!fileName) return res.status(400).json({ error: "fileName is required." });
    const storageKey = buildStorageKey(req.params.projectId, fileName);
    const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
    res.json({ uploadUrl, storageKey });
  } catch (err) {
    console.error("[radah-pm] submittal upload-url error:", err);
    res.status(500).json({ error: "Could not prepare the upload." });
  }
});

router.post("/projects/:projectId/submittals/:subId/attachments/confirm", requireAuth, requireModule("submittals"), requireR2, guardProject, async (req, res) => {
  const { storageKey, fileName, contentType, sizeBytes } = req.body || {};
  if (!storageKey || !fileName) return res.status(400).json({ error: "storageKey and fileName are required." });
  if (!storageKey.startsWith(`projects/${req.params.projectId}/`)) return res.status(400).json({ error: "Invalid storage key for this project." });
  const client = await pool.connect();
  try {
    const sub = await pool.query("SELECT id, project_id FROM submittals WHERE id = $1", [req.params.subId]);
    if (!sub.rows[0] || sub.rows[0].project_id !== req.params.projectId) { client.release(); return res.status(404).json({ error: "Submittal not found." }); }
    await client.query("BEGIN");
    const docRes = await client.query(
      `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.params.projectId, storageKey, fileName, contentType || null, sizeBytes || null, "Submittal attachment", req.user.id]
    );
    const documentId = docRes.rows[0].id;
    const linkRes = await client.query("INSERT INTO submittal_documents (submittal_id, document_id) VALUES ($1,$2) RETURNING id", [req.params.subId, documentId]);
    await client.query("COMMIT");
    res.status(201).json({ attachment: { id: linkRes.rows[0].id, documentId, fileName, canDelete: true } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] submittal confirm error:", err);
    res.status(500).json({ error: "Could not save the attachment." });
  } finally {
    client.release();
  }
});

router.delete("/submittal-documents/:id", requireAuth, requireModule("submittals"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sd.id, d.uploaded_by, d.project_id FROM submittal_documents sd JOIN documents d ON d.id = sd.document_id WHERE sd.id = $1`,
      [req.params.id]
    );
    const link = r.rows[0];
    if (!link) return res.status(404).json({ error: "Attachment not found." });
    if (!(await userCanAccessProject(req.user, link.project_id))) return res.status(404).json({ error: "Attachment not found." });
    if (!(isInternal(req.user) || link.uploaded_by === req.user.id)) return res.status(403).json({ error: "Only the uploader or staff can remove this." });
    await pool.query("DELETE FROM submittal_documents WHERE id = $1", [req.params.id]);
    res.json({ message: "Attachment removed." });
  } catch (err) {
    console.error("[radah-pm] delete submittal attachment error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
