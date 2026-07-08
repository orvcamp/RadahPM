// backend/routes/schedules.js
//
// The project's SCHEDULE as uploaded files, with revision history.
//
// This is deliberately NOT a scheduling engine. Schedules are built in
// Primavera P6 / MS Project; here we hold the current issued schedule (and its
// prior revisions) so the whole team knows which one is live. A future
// enhancement can parse MS Project XML / CSV into activities and render a
// read-only Gantt + 3-week lookahead.
//
// Permissions: any project member can view/download. admin/staff upload
// revisions and delete them. Files reuse the documents/R2 pipeline, so a
// schedule file also appears in the Documents library.

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject } = require("./projects");
const r2 = require("../db/r2");

const router = express.Router();

function guardProject(req, res, next) {
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}
function requireR2(req, res, next) {
  if (!r2.isConfigured) return res.status(503).json({ error: "File storage is not configured yet." });
  next();
}
function buildStorageKey(projectId, fileName) {
  const safe = (fileName || "schedule").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `projects/${projectId}/_schedule/${crypto.randomUUID()}-${safe}`;
}

// GET /api/projects/:projectId/schedules — newest first; the first row is current.
router.get("/projects/:projectId/schedules", requireAuth, guardProject, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ps.id, ps.revision, ps.notes, ps.created_at,
              d.id AS document_id, d.file_name, d.content_type, d.size_bytes,
              u.full_name AS uploaded_by_name
         FROM project_schedules ps
         JOIN documents d ON d.id = ps.document_id
         LEFT JOIN users u ON u.id = ps.uploaded_by
        WHERE ps.project_id = $1
        ORDER BY ps.revision DESC`,
      [req.params.projectId]
    );
    const schedules = r.rows.map((row, i) => ({
      id: row.id,
      revision: row.revision,
      notes: row.notes,
      createdAt: row.created_at,
      documentId: row.document_id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
      uploadedByName: row.uploaded_by_name || null,
      isCurrent: i === 0,
    }));
    res.json({ schedules, canManage: isInternal(req.user) });
  } catch (err) {
    console.error("[radah-pm] list schedules error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/projects/:projectId/schedules/upload-url  (admin/staff)
router.post(
  "/projects/:projectId/schedules/upload-url",
  requireAuth,
  requireRole("admin", "staff"),
  requireR2,
  guardProject,
  async (req, res) => {
    try {
      const { fileName, contentType } = req.body || {};
      if (!fileName) return res.status(400).json({ error: "fileName is required." });
      const storageKey = buildStorageKey(req.params.projectId, fileName);
      const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
      res.json({ uploadUrl, storageKey });
    } catch (err) {
      console.error("[radah-pm] schedule upload-url error:", err);
      res.status(500).json({ error: "Could not prepare the upload." });
    }
  }
);

// POST /api/projects/:projectId/schedules/confirm  (admin/staff)
// Creates the document row and a new schedule revision (max + 1).
router.post(
  "/projects/:projectId/schedules/confirm",
  requireAuth,
  requireRole("admin", "staff"),
  requireR2,
  guardProject,
  async (req, res) => {
    const { storageKey, fileName, contentType, sizeBytes, notes } = req.body || {};
    if (!storageKey || !fileName) return res.status(400).json({ error: "storageKey and fileName are required." });
    if (!String(storageKey).startsWith(`projects/${req.params.projectId}/_schedule/`)) {
      return res.status(400).json({ error: "Invalid storage key for this project schedule." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const nextRev = await client.query(
        "SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM project_schedules WHERE project_id = $1",
        [req.params.projectId]
      );
      const docRes = await client.query(
        `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.params.projectId, storageKey, fileName, contentType || null, sizeBytes || null, "Project schedule", req.user.id]
      );
      const insRes = await client.query(
        `INSERT INTO project_schedules (project_id, document_id, revision, notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, revision`,
        [req.params.projectId, docRes.rows[0].id, nextRev.rows[0].next, notes || null, req.user.id]
      );
      await client.query("COMMIT");
      res.status(201).json({
        schedule: {
          id: insRes.rows[0].id,
          revision: insRes.rows[0].revision,
          documentId: docRes.rows[0].id,
          fileName,
          isCurrent: true,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] schedule confirm error:", err);
      res.status(500).json({ error: "Could not save the schedule." });
    } finally {
      client.release();
    }
  }
);

// DELETE /api/project-schedules/:id  (admin/staff) — removes the revision entry.
router.delete("/project-schedules/:id", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const r = await pool.query("SELECT project_id FROM project_schedules WHERE id = $1", [req.params.id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "Schedule revision not found." });
    if (!(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Schedule revision not found." });
    }
    await pool.query("DELETE FROM project_schedules WHERE id = $1", [req.params.id]);
    res.json({ message: "Schedule revision removed." });
  } catch (err) {
    console.error("[radah-pm] delete schedule error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
