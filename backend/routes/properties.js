// backend/routes/properties.js
//
// MangoDoe Facilities — Properties & Assets module.
//
// A "Property" IS a projects row (see Phase 6 migration notes) — this file
// never creates a parallel table for the property itself. It creates a
// projects row plus a 1:1 property_details row, and every list/get query
// joins property_details so this module only ever surfaces projects rows
// that are actually being used as a Property (never a Construction project
// that happens to share the same org, though in practice an org is one
// vertical — see organizations.vertical from Phase 5 — so that overlap
// shouldn't occur regardless; the join is a belt-and-suspenders guarantee).
//
// Reuses userCanAccessProject from routes/projects.js unchanged — a
// Property's access rules are identical to a Construction project's.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal, requireOrg } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapProperty(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    address: row.location,
    squareFootage: row.square_footage,
    propertyType: row.property_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row) {
  return {
    id: row.id,
    propertyId: row.project_id,
    category: row.category,
    name: row.name,
    make: row.make,
    model: row.model,
    serialNumber: row.serial_number,
    installDate: row.install_date,
    warrantyExpiresAt: row.warranty_expires_at,
    locationDetail: row.location_detail,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function guardProperty(req, res, next) {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.propertyId || req.params.id);
    if (!allowed) return res.status(404).json({ error: "Property not found." });
    next();
  } catch (e) { next(e); }
}

// Confirms an asset belongs to a property the user can access; attaches
// req.propertyId for handlers that need it.
async function guardAsset(req, res, next) {
  try {
    const r = await pool.query("SELECT project_id FROM assets WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Asset not found." });
    }
    req.propertyId = row.project_id;
    next();
  } catch (e) { next(e); }
}

// ============================================================
// PROPERTIES
// ============================================================

// GET /api/properties — same visibility rules as GET /api/projects.
router.get("/properties", requireAuth, requireOrg, async (req, res) => {
  try {
    let result;
    if (isInternal(req.user)) {
      result = await pool.query(
        `SELECT p.*, pd.square_footage, pd.property_type FROM projects p
         JOIN property_details pd ON pd.project_id = p.id
         WHERE p.org_id = $1 ORDER BY p.created_at DESC`,
        [req.user.orgId]
      );
    } else {
      result = await pool.query(
        `SELECT p.*, pd.square_footage, pd.property_type FROM projects p
         JOIN property_details pd ON pd.project_id = p.id
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = $1 AND p.org_id = $2
         ORDER BY p.created_at DESC`,
        [req.user.id, req.user.orgId]
      );
    }
    res.json({ properties: result.rows.map(mapProperty) });
  } catch (err) {
    console.error("[radah-pm] list properties error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/properties — admin/staff only. Creates the projects row and its
// property_details extension together, in one transaction.
router.post("/properties", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  const { name, description, address, squareFootage, propertyType } = req.body || {};
  if (!name) return res.status(400).json({ error: "Property name is required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proj = await client.query(
      `INSERT INTO projects (name, description, status, location, created_by, org_id)
       VALUES ($1, $2, 'active', $3, $4, $5) RETURNING *`,
      [name, description || null, address || null, req.user.id, req.user.orgId]
    );
    const details = await client.query(
      `INSERT INTO property_details (project_id, square_footage, property_type)
       VALUES ($1, $2, $3) RETURNING *`,
      [proj.rows[0].id, squareFootage || null, propertyType || null]
    );
    await client.query("COMMIT");
    res.status(201).json({ property: mapProperty({ ...proj.rows[0], ...details.rows[0] }) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] create property error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

// GET /api/properties/:id
router.get("/properties/:id", requireAuth, guardProperty, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, pd.square_footage, pd.property_type FROM projects p
       JOIN property_details pd ON pd.project_id = p.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Property not found." });
    res.json({ property: mapProperty(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] get property error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// PATCH /api/properties/:id — admin/staff only.
router.patch("/properties/:id", requireAuth, requireRole("admin", "staff"), guardProperty, async (req, res) => {
  const { name, description, address, status, squareFootage, propertyType } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE projects SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         location = COALESCE($3, location),
         status = COALESCE($4::project_status, status)
       WHERE id = $5`,
      [name || null, description || null, address || null, status || null, req.params.id]
    );
    await client.query(
      `UPDATE property_details SET
         square_footage = COALESCE($1, square_footage),
         property_type = COALESCE($2, property_type)
       WHERE project_id = $3`,
      [squareFootage || null, propertyType || null, req.params.id]
    );
    await client.query("COMMIT");
    const r = await pool.query(
      `SELECT p.*, pd.square_footage, pd.property_type FROM projects p
       JOIN property_details pd ON pd.project_id = p.id WHERE p.id = $1`,
      [req.params.id]
    );
    res.json({ property: mapProperty(r.rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] update property error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

// ============================================================
// ASSETS (scoped to a property)
// ============================================================

router.get("/properties/:propertyId/assets", requireAuth, guardProperty, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM assets WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [req.params.propertyId]
    );
    res.json({ assets: r.rows.map(mapAsset) });
  } catch (err) {
    console.error("[radah-pm] list assets error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post(
  "/properties/:propertyId/assets",
  requireAuth,
  requireModule("assets"),
  requireRole("admin", "staff"),
  guardProperty,
  async (req, res) => {
    const { category, name, make, model, serialNumber, installDate, warrantyExpiresAt, locationDetail, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: "Asset name is required." });
    try {
      const r = await pool.query(
        `INSERT INTO assets
           (project_id, category, name, make, model, serial_number, install_date, warranty_expires_at, location_detail, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [req.params.propertyId, category || null, name, make || null, model || null, serialNumber || null,
          installDate || null, warrantyExpiresAt || null, locationDetail || null, notes || null, req.user.id]
      );
      res.status(201).json({ asset: mapAsset(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create asset error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.patch("/assets/:id", requireAuth, requireRole("admin", "staff"), guardAsset, async (req, res) => {
  const bodyKeyMap = {
    category: "category", name: "name", make: "make", model: "model", serialNumber: "serial_number",
    installDate: "install_date", warrantyExpiresAt: "warranty_expires_at", locationDetail: "location_detail",
    status: "status", notes: "notes",
  };
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
    const r = await pool.query(`UPDATE assets SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ asset: mapAsset(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update asset error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/assets/:id", requireAuth, requireRole("admin", "staff"), guardAsset, async (req, res) => {
  try {
    await pool.query("UPDATE assets SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Asset removed." });
  } catch (err) {
    console.error("[radah-pm] delete asset error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
