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
const { userCanAccessProject, resourceProjectId } = require("./projects");
const { requireModule } = require("../orgModules");
const r2 = require("../db/r2");

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
    folderId: row.folder_id || null,
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
router.get("/projects/:projectId/documents", requireAuth, requireModule("documents"), async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    const result = await pool.query(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.project_id = $1 AND d.deleted_at IS NULL
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
    const { storageKey, fileName, contentType, sizeBytes, description, folderId } = req.body || {};
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
      // If a folder was given, confirm it belongs to this project.
      if (folderId) {
        const f = await pool.query(
          "SELECT 1 FROM document_folders WHERE id = $1 AND project_id = $2",
          [folderId, req.params.projectId]
        );
        if (f.rows.length === 0) {
          return res.status(400).json({ error: "That folder doesn't belong to this project." });
        }
      }
      const result = await pool.query(
        `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by, folder_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          req.params.projectId,
          storageKey,
          fileName,
          contentType || null,
          sizeBytes || null,
          description || null,
          req.user.id,
          folderId || null,
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
 * GET /api/documents/:id/view-url
 * Returns a short-lived presigned URL that renders INLINE in the browser
 * (for the in-app preview), plus the file's content type so the client can
 * pick the right viewer.
 */
router.get("/documents/:id/view-url", requireAuth, requireR2, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found." });
    const allowed = await userCanAccessProject(req.user, doc.project_id);
    if (!allowed) return res.status(403).json({ error: "You do not have access to this document." });
    const viewUrl = await r2.getViewUrl(doc.storage_key, doc.content_type);
    res.json({ viewUrl, contentType: doc.content_type || null, fileName: doc.file_name });
  } catch (err) {
    console.error("[radah-pm] view url error:", err);
    res.status(500).json({ error: "Could not open the document." });
  }
});

/**
 * DELETE /api/documents/:id
 * Admin/staff, or the user who uploaded it, may delete. Removes both the
 * R2 object and the metadata row.
 */
router.delete("/documents/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const doc = result.rows[0];
    if (!doc) {
      return res.status(404).json({ error: "Document not found." });
    }
    const allowed = await userCanAccessProject(req.user, doc.project_id);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this document." });
    }
    // Soft delete: the stored file is retained and an admin can restore it
    // from the project's Deleted Items view.
    await pool.query(
      "UPDATE documents SET deleted_at = now(), deleted_by = $1 WHERE id = $2",
      [req.user.id, req.params.id]
    );
    res.json({ message: "Document moved to Deleted Items. An admin can restore it." });
  } catch (err) {
    console.error("[radah-pm] delete document error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// FOLDERS (nested). Folder management is admin/staff; any member may
// move their own uploads. Deleting a folder re-parents its contents up
// one level (never deletes files).
// ============================================================
function mapFolder(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    parentFolderId: row.parent_folder_id || null,
    name: row.name,
    createdAt: row.created_at,
  };
}

// Collect a folder plus all its descendant folder ids (for loop prevention).
async function collectDescendantIds(folderId) {
  const ids = new Set([folderId]);
  let frontier = [folderId];
  while (frontier.length) {
    const r = await pool.query(
      "SELECT id FROM document_folders WHERE parent_folder_id = ANY($1::uuid[])",
      [frontier]
    );
    frontier = [];
    for (const row of r.rows) {
      if (!ids.has(row.id)) { ids.add(row.id); frontier.push(row.id); }
    }
  }
  return ids;
}

// GET /api/projects/:projectId/folders — flat list; the client builds the tree.
router.get("/projects/:projectId/folders", requireAuth, requireModule("documents"), async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) return res.status(403).json({ error: "You do not have access to this project." });
    const r = await pool.query(
      "SELECT * FROM document_folders WHERE project_id = $1 ORDER BY name ASC",
      [req.params.projectId]
    );
    res.json({ folders: r.rows.map(mapFolder) });
  } catch (err) {
    console.error("[radah-pm] list folders error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/projects/:projectId/folders  { name, parentFolderId }  (admin/staff)
router.post(
  "/projects/:projectId/folders",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { name, parentFolderId } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Folder name is required." });
    try {
      if (parentFolderId) {
        const p = await pool.query(
          "SELECT 1 FROM document_folders WHERE id = $1 AND project_id = $2",
          [parentFolderId, req.params.projectId]
        );
        if (p.rows.length === 0) {
          return res.status(400).json({ error: "The parent folder doesn't belong to this project." });
        }
      }
      const r = await pool.query(
        `INSERT INTO document_folders (project_id, parent_folder_id, name, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.projectId, parentFolderId || null, name.trim(), req.user.id]
      );
      res.status(201).json({ folder: mapFolder(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create folder error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH /api/folders/:id  { name, parentFolderId }  (admin/staff) — rename / move
router.patch("/folders/:id", requireAuth, requireRole("admin", "staff"), guardResource("document_folders"), async (req, res) => {
  try {
    const cur = await pool.query("SELECT * FROM document_folders WHERE id = $1", [req.params.id]);
    const folder = cur.rows[0];
    if (!folder) return res.status(404).json({ error: "Folder not found." });

    const updates = [];
    const values = [];
    let i = 1;

    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) return res.status(400).json({ error: "Folder name cannot be empty." });
      updates.push(`name = $${i}`); values.push(String(req.body.name).trim()); i++;
    }
    if (req.body.parentFolderId !== undefined) {
      const newParent = req.body.parentFolderId || null;
      if (newParent) {
        // Must be in the same project, and not the folder itself or a descendant.
        const p = await pool.query(
          "SELECT 1 FROM document_folders WHERE id = $1 AND project_id = $2",
          [newParent, folder.project_id]
        );
        if (p.rows.length === 0) {
          return res.status(400).json({ error: "The target folder doesn't belong to this project." });
        }
        const descendants = await collectDescendantIds(folder.id);
        if (descendants.has(newParent)) {
          return res.status(400).json({ error: "You can't move a folder into itself or one of its subfolders." });
        }
      }
      updates.push(`parent_folder_id = $${i}`); values.push(newParent); i++;
    }

    if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });
    values.push(req.params.id);
    const r = await pool.query(
      `UPDATE document_folders SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ folder: mapFolder(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update folder error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// DELETE /api/folders/:id  (admin/staff)
// Re-parents child folders and documents up to this folder's parent, then
// deletes the now-empty folder. No files are lost.
router.delete("/folders/:id", requireAuth, requireRole("admin", "staff"), guardResource("document_folders"), async (req, res) => {
  const client = await pool.connect();
  try {
    const cur = await client.query("SELECT * FROM document_folders WHERE id = $1", [req.params.id]);
    const folder = cur.rows[0];
    if (!folder) { client.release(); return res.status(404).json({ error: "Folder not found." }); }

    await client.query("BEGIN");
    // Move child folders up to this folder's parent.
    await client.query(
      "UPDATE document_folders SET parent_folder_id = $1 WHERE parent_folder_id = $2",
      [folder.parent_folder_id, folder.id]
    );
    // Move documents up to this folder's parent.
    await client.query(
      "UPDATE documents SET folder_id = $1 WHERE folder_id = $2",
      [folder.parent_folder_id, folder.id]
    );
    await client.query("DELETE FROM document_folders WHERE id = $1", [folder.id]);
    await client.query("COMMIT");
    res.json({ message: "Folder deleted; its contents moved up one level." });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] delete folder error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

// PATCH /api/documents/:id  { folderId }  — move a document into a folder.
// Uploader or admin/staff.
router.patch("/documents/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found." });
    const allowed = await userCanAccessProject(req.user, doc.project_id);
    if (!allowed) return res.status(403).json({ error: "You do not have access to this document." });
    const canMove = isInternal(req.user) || doc.uploaded_by === req.user.id;
    if (!canMove) return res.status(403).json({ error: "Only the uploader or RADAH staff can move this document." });

    if (req.body.folderId === undefined) {
      return res.status(400).json({ error: "No folder provided." });
    }
    const folderId = req.body.folderId || null;
    if (folderId) {
      const f = await pool.query(
        "SELECT 1 FROM document_folders WHERE id = $1 AND project_id = $2",
        [folderId, doc.project_id]
      );
      if (f.rows.length === 0) {
        return res.status(400).json({ error: "That folder doesn't belong to this project." });
      }
    }
    const upd = await pool.query(
      `UPDATE documents SET folder_id = $1 WHERE id = $2 RETURNING *`,
      [folderId, req.params.id]
    );
    const withName = await pool.query(
      `SELECT d.*, u.full_name AS uploaded_by_name FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = $1`,
      [upd.rows[0].id]
    );
    res.json({ document: mapDocument(withName.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] move document error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// STANDARD FOLDER TEMPLATE (construction-industry structure)
// POST /api/projects/:projectId/folders/apply-template  (admin/staff)
// Idempotent: find-or-create by name at each level, so re-running won't
// duplicate. Great for setting up a new project's filing structure at once.
// ============================================================
const FOLDER_TEMPLATE = [
  { name: "00 - Project Management", children: ["Contacts & Directory", "Meeting Minutes", "Correspondence", "Schedules"] },
  { name: "01 - Preconstruction & Contracts", children: ["Contracts & Agreements", "Bonds & Insurance", "Permits & Approvals", "Proposals & Estimates"] },
  { name: "02 - Drawings & Specifications", children: ["Contract Drawings (For Construction)", "Shop Drawings", "As-Builts", "Specifications", "Superseded"] },
  { name: "03 - Submittals", children: [] },
  { name: "04 - RFIs", children: [] },
  { name: "05 - Change Management", children: ["Change Orders", "Potential Change Orders (PCOs)", "Construction Change Directives"] },
  { name: "06 - Cost & Billing", children: ["Budget", "Pay Applications", "Invoices", "Lien Waivers"] },
  { name: "07 - Field & Logs", children: ["Daily Logs", "Site Photos", "Delivery Logs", "Visitor Logs", "Equipment Logs", "Weather Logs"] },
  { name: "08 - Safety", children: ["Safety Plans", "Incident Reports", "Toolbox Talks & JHAs", "Safety Inspections"] },
  { name: "09 - Quality (QA-QC)", children: ["Inspection Reports", "Test Reports", "Punch Lists", "Deficiency Logs"] },
  { name: "10 - Closeout", children: ["Warranties", "O&M Manuals", "As-Built Record Set", "Final Certificates & Permits", "Training"] },
];

router.post(
  "/projects/:projectId/folders/apply-template",
  requireAuth,
  requireModule("documents"),
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const projectId = req.params.projectId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let created = 0;
      async function findOrCreate(name, parentId) {
        const found = await client.query(
          "SELECT id FROM document_folders WHERE project_id = $1 AND name = $2 AND parent_folder_id IS NOT DISTINCT FROM $3",
          [projectId, name, parentId]
        );
        if (found.rows[0]) return found.rows[0].id;
        const ins = await client.query(
          "INSERT INTO document_folders (project_id, parent_folder_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
          [projectId, parentId, name, req.user.id]
        );
        created++;
        return ins.rows[0].id;
      }
      for (const top of FOLDER_TEMPLATE) {
        const topId = await findOrCreate(top.name, null);
        for (const child of top.children) await findOrCreate(child, topId);
      }
      await client.query("COMMIT");
      res.json({ message: `Standard folder structure applied. ${created} new folder(s) created.`, created });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] apply folder template error:", err);
      res.status(500).json({ error: "Something went wrong applying the template." });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
