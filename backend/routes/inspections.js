// backend/routes/inspections.js
//
// MangoDoe Facilities — Inspections & Compliance.
// Checklist-based: an inspection has a list of inspection_items, each with
// a pass/fail/na result, notes, and an optional photo. Photo upload reuses
// the same R2 pattern (object key stored, presigned URL generated on read)
// used for project photos elsewhere.

const express = require("express");
const pool = require("../db/pool");
const r2 = require("../db/r2");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapInspection(row) {
  return {
    id: row.id,
    propertyId: row.project_id,
    title: row.title,
    scheduledDate: row.scheduled_date,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function mapItem(row) {
  let photoUrl = null;
  if (row.photo_key && r2.isConfigured) {
    try { photoUrl = await r2.getDownloadUrl(row.photo_key); } catch { photoUrl = null; }
  }
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    description: row.description,
    result: row.result,
    notes: row.notes,
    photoKey: row.photo_key,
    photoUrl,
    sortOrder: row.sort_order,
  };
}

async function guardProperty(req, res, next) {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.propertyId);
    if (!allowed) return res.status(404).json({ error: "Property not found." });
    next();
  } catch (e) { next(e); }
}

async function guardInspection(req, res, next) {
  try {
    const r = await pool.query(
      "SELECT project_id, status FROM inspections WHERE id = $1 AND deleted_at IS NULL",
      [req.params.inspectionId || req.params.id]
    );
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Inspection not found." });
    }
    req.propertyId = row.project_id;
    req.inspectionStatus = row.status;
    next();
  } catch (e) { next(e); }
}

async function guardItem(req, res, next) {
  try {
    const r = await pool.query(
      `SELECT i.project_id FROM inspection_items it
       JOIN inspections i ON i.id = it.inspection_id
       WHERE it.id = $1 AND i.deleted_at IS NULL`,
      [req.params.id]
    );
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Inspection item not found." });
    }
    next();
  } catch (e) { next(e); }
}

// ============================================================
// INSPECTIONS
// ============================================================

router.get("/properties/:propertyId/inspections", requireAuth, requireModule("inspections"), guardProperty, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM inspections WHERE project_id = $1 AND deleted_at IS NULL ORDER BY scheduled_date DESC NULLS LAST, created_at DESC",
      [req.params.propertyId]
    );
    res.json({ inspections: r.rows.map(mapInspection) });
  } catch (err) {
    console.error("[radah-pm] list inspections error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post(
  "/properties/:propertyId/inspections",
  requireAuth,
  requireModule("inspections"),
  requireRole("admin", "staff"),
  guardProperty,
  async (req, res) => {
    const { title, scheduledDate, items } = req.body || {};
    if (!title) return res.status(400).json({ error: "Title is required." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO inspections (project_id, title, scheduled_date, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.propertyId, title, scheduledDate || null, req.user.id]
      );
      let sortOrder = 0;
      const createdItems = [];
      for (const desc of Array.isArray(items) ? items : []) {
        const text = typeof desc === "string" ? desc : desc && desc.description;
        if (!text || !text.trim()) continue;
        const itemRes = await client.query(
          "INSERT INTO inspection_items (inspection_id, description, sort_order) VALUES ($1, $2, $3) RETURNING *",
          [ins.rows[0].id, text.trim(), sortOrder++]
        );
        createdItems.push(itemRes.rows[0]);
      }
      await client.query("COMMIT");
      res.status(201).json({
        inspection: mapInspection(ins.rows[0]),
        items: await Promise.all(createdItems.map(mapItem)),
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] create inspection error:", err);
      res.status(500).json({ error: "Something went wrong." });
    } finally {
      client.release();
    }
  }
);

router.get("/inspections/:id", requireAuth, guardInspection, async (req, res) => {
  try {
    const insRes = await pool.query("SELECT * FROM inspections WHERE id = $1", [req.params.id]);
    const itemsRes = await pool.query(
      "SELECT * FROM inspection_items WHERE inspection_id = $1 ORDER BY sort_order ASC",
      [req.params.id]
    );
    res.json({
      inspection: mapInspection(insRes.rows[0]),
      items: await Promise.all(itemsRes.rows.map(mapItem)),
    });
  } catch (err) {
    console.error("[radah-pm] get inspection error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.patch("/inspections/:id", requireAuth, requireRole("admin", "staff"), guardInspection, async (req, res) => {
  const bodyKeyMap = { title: "title", scheduledDate: "scheduled_date", status: "status" };
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
  if (req.body && req.body.status === "completed") {
    updates.push("completed_at = now()");
    updates.push(`completed_by = $${i}`);
    values.push(req.user.id);
    i++;
  }
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields provided to update." });
  try {
    values.push(req.params.id);
    const r = await pool.query(`UPDATE inspections SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ inspection: mapInspection(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update inspection error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/inspections/:id", requireAuth, requireRole("admin", "staff"), guardInspection, async (req, res) => {
  try {
    await pool.query("UPDATE inspections SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Inspection removed." });
  } catch (err) {
    console.error("[radah-pm] delete inspection error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// INSPECTION ITEMS
// ============================================================

router.post(
  "/inspections/:inspectionId/items",
  requireAuth,
  requireRole("admin", "staff"),
  guardInspection,
  async (req, res) => {
    const { description } = req.body || {};
    if (!description || !description.trim()) return res.status(400).json({ error: "Description is required." });
    try {
      const sortRes = await pool.query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM inspection_items WHERE inspection_id = $1",
        [req.params.inspectionId]
      );
      const r = await pool.query(
        "INSERT INTO inspection_items (inspection_id, description, sort_order) VALUES ($1, $2, $3) RETURNING *",
        [req.params.inspectionId, description.trim(), sortRes.rows[0].next]
      );
      res.status(201).json({ item: await mapItem(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] add inspection item error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH an item — result/notes/photoKey. Any project member can record a
// result (the person walking the site doing the inspection is often staff,
// but this deliberately isn't locked to admin/staff only, mirroring how
// Daily Logs work — the point is capturing the finding, not gatekeeping it).
router.patch("/inspection-items/:id", requireAuth, guardItem, async (req, res) => {
  const bodyKeyMap = { description: "description", result: "result", notes: "notes", photoKey: "photo_key", sortOrder: "sort_order" };
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
    const r = await pool.query(`UPDATE inspection_items SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ item: await mapItem(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update inspection item error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/inspection-items/:id", requireAuth, requireRole("admin", "staff"), guardItem, async (req, res) => {
  try {
    await pool.query("DELETE FROM inspection_items WHERE id = $1", [req.params.id]);
    res.json({ message: "Item removed." });
  } catch (err) {
    console.error("[radah-pm] delete inspection item error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
