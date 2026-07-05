// backend/routes/documents.js
//
// Per-project document storage backed by Cloudflare R2.
//
// Upload flow (browser does the actual file transfer, not this server):
//   1. POST /api/projects/:projectId/documents/upload-url
//      -> backend returns a presigned PUT url + a storage key
//   2. browser PUTs the file bytes directly to R2 using that url
//   3. POST /api/projects/:projectId/documents/confirm
//      -> backend records the metadata row after a successful upload
//
// Download flow:
//   GET /api/documents/:id/download-url -> presigned GET url
//
// Visibility follows the same project-access rules as everything else:
// admin/staff see all; clients/trade_partners only for projects they're
// a member of. Within a project a member can access, all members can see
// the document list (documents aren't filtered per-task the way trade
// partner tasks are — a shared project doc library).

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject } = require("./projects");
const r2 = require("../db/r2");

const router = express.Router();

function mapDocument(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
    description: row.description,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name || null,
    createdAt: row.created_at,
  };
}

// Reject documents if R2 isn't configured, with a clear message.
function requireR2(req, res, next) {
  if (!r2.isConfigured) {
    return res.status(503).json({
      error: "Document storage is not configured yet. Please contact your administrator.",
    });
  }
  next();
}

// Build a safe storage key: projects/<projectId>/<random>-<sanitized-name>
function buildStorageKey(projectId, fileName) {
  const safeName = (fileName || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  return `projects/${projectId}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * GET /api/projects/:projectId/documents
 * List all documents for a project the user can access.
 */
router.get("/projects/:projectId/documents", requireAuth, async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    const result = await pool.query(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.project_id = $1
       ORDER BY d.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ documents: result.rows.map(mapDocument) });
  } catch (err) {
    console.error("[radah-pm] list documents error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/projects/:projectId/documents/upload-url
 * Body: { fileName, contentType }
 * Returns a presigned upload URL + the storageKey to confirm with later.
 * Any project member (including clients/trade partners) may upload to a
 * project they belong to.
 */
router.post(
  "/projects/:projectId/documents/upload-url",
  requireAuth,
  requireR2,
  async (req, res) => {
    const { fileName, contentType } = req.body || {};
    if (!fileName) {
      return res.status(400).json({ error: "fileName is required." });
    }
    try {
      const allowed = await userCanAccessProject(req.user, req.params.projectId);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this project." });
      }
      const storageKey = buildStorageKey(req.params.projectId, fileName);
      const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
      res.json({ uploadUrl, storageKey });
    } catch (err) {
      console.error("[radah-pm] upload-url error:", err);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  }
);

/**
 * POST /api/projects/:projectId/documents/confirm
 * Body: { storageKey, fileName, contentType, sizeBytes, description }
 * Records the document metadata after the browser has finished uploading.
 */
router.post(
  "/projects/:projectId/documents/confirm",
  requireAuth,
  requireR2,
  async (req, res) => {
    const { storageKey, fileName, contentType, sizeBytes, description } = req.body || {};
    if (!storageKey || !fileName) {
      return res.status(400).json({ error: "storageKey and fileName are required." });
    }
    // Make sure the storage key really belongs to this project's prefix —
    // prevents a member of project A from registering a key under project B.
    if (!storageKey.startsWith(`projects/${req.params.projectId}/`)) {
      return res.status(400).json({ error: "Invalid storage key for this project." });
    }
    try {
      const allowed = await userCanAccessProject(req.user, req.params.projectId);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this project." });
      }
      const result = await pool.query(
        `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.params.projectId,
          storageKey,
          fileName,
          contentType || null,
          sizeBytes || null,
          description || null,
          req.user.id,
        ]
      );
      // Re-fetch with uploader name for a consistent response shape.
      const withName = await pool.query(
        `SELECT d.*, u.full_name AS uploaded_by_name FROM documents d
         LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = $1`,
        [result.rows[0].id]
      );
      res.status(201).json({ document: mapDocument(withName.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] confirm document error:", err);
      res.status(500).json({ error: "Could not save the document record." });
    }
  }
);

/**
 * GET /api/documents/:id/download-url
 * Returns a short-lived presigned download URL.
 */
router.get("/documents/:id/download-url", requireAuth, requireR2, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    const doc = result.rows[0];
    if (!doc) {
      return res.status(404).json({ error: "Document not found." });
    }
    const allowed = await userCanAccessProject(req.user, doc.project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this document." });
    }
    const downloadUrl = await r2.getDownloadUrl(doc.storage_key, doc.file_name);
    res.json({ downloadUrl });
  } catch (err) {
    console.error("[radah-pm] download-url error:", err);
    res.status(500).json({ error: "Could not prepare the download. Please try again." });
  }
});

/**
 * DELETE /api/documents/:id
 * Admin/staff, or the user who uploaded it, may delete. Removes both the
 * R2 object and the metadata row.
 */
router.delete("/documents/:id", requireAuth, requireR2, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    const doc = result.rows[0];
    if (!doc) {
      return res.status(404).json({ error: "Document not found." });
    }
    const allowed = await userCanAccessProject(req.user, doc.project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this document." });
    }
    const canDelete = isInternal(req.user) || doc.uploaded_by === req.user.id;
    if (!canDelete) {
      return res.status(403).json({ error: "Only the uploader or RADAH staff can delete this document." });
    }

    // Delete from R2 first; if that fails, keep the row so we don't orphan a file.
    try {
      await r2.deleteObject(doc.storage_key);
    } catch (e) {
      console.error("[radah-pm] R2 delete failed:", e);
      return res.status(502).json({ error: "Could not delete the stored file. Please try again." });
    }

    await pool.query("DELETE FROM documents WHERE id = $1", [req.params.id]);
    res.json({ message: "Document deleted." });
  } catch (err) {
    console.error("[radah-pm] delete document error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
