// backend/routes/trash.js
//
// Deleted Items ("recycle bin") for a project. Destructive deletes across
// documents, daily logs, RFIs, submittals, and change orders are soft deletes:
// the record is flagged and hidden, never destroyed. An admin can restore it
// here, or permanently purge it (which is the only irreversible action, and
// for documents also removes the stored file from R2).
//
// Admin only, and org-scoped through userCanAccessProject.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");
const { userCanAccessProject } = require("./projects");
const r2 = require("../db/r2");

const router = express.Router();

// type -> { table, label, title expression }
const TYPES = {
  documents:     { table: "documents",     label: "Document" },
  daily_logs:    { table: "daily_logs",    label: "Daily Log" },
  rfis:          { table: "rfis",          label: "RFI" },
  submittals:    { table: "submittals",    label: "Submittal" },
  change_orders: { table: "change_orders", label: "Change Order" },
};

function guardProject(req, res, next) {
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}

// GET /api/projects/:projectId/trash — everything soft-deleted on this project.
router.get("/projects/:projectId/trash", requireAuth, requireRole("admin"), guardProject, async (req, res) => {
  const pid = req.params.projectId;
  try {
    const [docs, logs, rfis, subs, cos] = await Promise.all([
      pool.query(
        `SELECT d.id, d.file_name AS title, d.deleted_at, u.full_name AS deleted_by_name
           FROM documents d LEFT JOIN users u ON u.id = d.deleted_by
          WHERE d.project_id = $1 AND d.deleted_at IS NOT NULL ORDER BY d.deleted_at DESC`, [pid]),
      pool.query(
        `SELECT dl.id, to_char(dl.log_date,'YYYY-MM-DD') AS title, dl.deleted_at, u.full_name AS deleted_by_name
           FROM daily_logs dl LEFT JOIN users u ON u.id = dl.deleted_by
          WHERE dl.project_id = $1 AND dl.deleted_at IS NOT NULL ORDER BY dl.deleted_at DESC`, [pid]),
      pool.query(
        `SELECT r.id, ('RFI #' || r.rfi_number || ' — ' || r.subject) AS title, r.deleted_at, u.full_name AS deleted_by_name
           FROM rfis r LEFT JOIN users u ON u.id = r.deleted_by
          WHERE r.project_id = $1 AND r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC`, [pid]),
      pool.query(
        `SELECT s.id, ('Submittal #' || s.submittal_number || ' Rev ' || s.revision || ' — ' || s.title) AS title, s.deleted_at, u.full_name AS deleted_by_name
           FROM submittals s LEFT JOIN users u ON u.id = s.deleted_by
          WHERE s.project_id = $1 AND s.deleted_at IS NOT NULL ORDER BY s.deleted_at DESC`, [pid]),
      pool.query(
        `SELECT co.id, ('CO #' || co.co_number || ' — ' || co.title) AS title, co.deleted_at, u.full_name AS deleted_by_name
           FROM change_orders co LEFT JOIN users u ON u.id = co.deleted_by
          WHERE co.project_id = $1 AND co.deleted_at IS NOT NULL ORDER BY co.deleted_at DESC`, [pid]),
    ]);

    const pack = (type, rows) =>
      rows.map((r) => ({
        type,
        typeLabel: TYPES[type].label,
        id: r.id,
        title: r.title,
        deletedAt: r.deleted_at,
        deletedByName: r.deleted_by_name || null,
      }));

    const items = [
      ...pack("documents", docs.rows),
      ...pack("daily_logs", logs.rows),
      ...pack("rfis", rfis.rows),
      ...pack("submittals", subs.rows),
      ...pack("change_orders", cos.rows),
    ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

    res.json({ items });
  } catch (err) {
    console.error("[radah-pm] list trash error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Resolve a soft-deleted row and confirm the caller can access its project.
async function loadDeleted(type, id, user) {
  const t = TYPES[type];
  if (!t) return { error: "Unknown item type." };
  const r = await pool.query(
    `SELECT * FROM ${t.table} WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return { error: "Item not found in Deleted Items." };
  if (!(await userCanAccessProject(user, row.project_id))) return { error: "Item not found in Deleted Items." };
  return { row, table: t.table, label: t.label };
}

// POST /api/trash/:type/:id/restore
router.post("/trash/:type/:id/restore", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const found = await loadDeleted(req.params.type, req.params.id, req.user);
    if (found.error) return res.status(404).json({ error: found.error });
    await pool.query(`UPDATE ${found.table} SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, [req.params.id]);
    res.json({ message: `${found.label} restored.` });
  } catch (err) {
    console.error("[radah-pm] restore error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// DELETE /api/trash/:type/:id — permanent purge (irreversible).
router.delete("/trash/:type/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const found = await loadDeleted(req.params.type, req.params.id, req.user);
    if (found.error) return res.status(404).json({ error: found.error });

    // For documents, remove the stored file too. If storage removal fails we
    // keep the row rather than orphan the object.
    if (found.table === "documents" && r2.isConfigured && found.row.storage_key) {
      try {
        await r2.deleteObject(found.row.storage_key);
      } catch (e) {
        console.error("[radah-pm] R2 purge failed:", e);
        return res.status(502).json({ error: "Could not remove the stored file. Please try again." });
      }
    }

    await pool.query(`DELETE FROM ${found.table} WHERE id = $1`, [req.params.id]);
    res.json({ message: `${found.label} permanently deleted.` });
  } catch (err) {
    console.error("[radah-pm] purge error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
