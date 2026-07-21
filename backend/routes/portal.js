// backend/routes/portal.js
//
// Property Owner Portal — data endpoints, scoped to whatever properties
// the logged-in portal_accounts row has been granted via
// portal_account_access (see routes/portalAccess.js for how grants are
// created). Facilities-only for v1, per the build-sequence scoping doc —
// every property here is a `projects` row that also has a
// `property_details` row.
//
// "Invoices": there's no dedicated invoices table for Facilities today —
// billing lives on work_orders.cost_cents directly. So this exposes
// completed work orders with their cost as the v1 stand-in for an
// invoice list, rather than a generated billing document. Worth
// revisiting if/when a real Facilities invoicing entity gets built.

const express = require("express");
const pool = require("../db/pool");
const { requirePortalAuth } = require("../middleware/auth");
const r2 = require("../db/r2");

const router = express.Router();

// Every route below needs to confirm the portal account actually has a
// grant for :propertyId — this is the portal equivalent of guardProperty
// in the internal routes.
async function guardPortalProperty(req, res, next) {
  try {
    const r = await pool.query(
      "SELECT 1 FROM portal_account_access WHERE portal_account_id = $1 AND project_id = $2",
      [req.portalAccount.id, req.params.propertyId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Property not found." });
    }
    next();
  } catch (e) {
    next(e);
  }
}

function mapPropertySummary(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    orgId: row.org_id,
    orgName: row.org_name,
    squareFootage: row.square_footage,
    propertyType: row.property_type,
  };
}

/**
 * GET /api/portal/properties
 * Every property this login has been granted, across every org.
 */
router.get("/properties", requirePortalAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.name, p.location, p.org_id, o.name AS org_name,
              pd.square_footage, pd.property_type
       FROM portal_account_access a
       JOIN projects p ON p.id = a.project_id
       JOIN organizations o ON o.id = a.org_id
       LEFT JOIN property_details pd ON pd.project_id = p.id
       WHERE a.portal_account_id = $1
       ORDER BY p.name ASC`,
      [req.portalAccount.id]
    );
    res.json({ properties: r.rows.map(mapPropertySummary) });
  } catch (err) {
    console.error("[radah-pm] portal list properties error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/portal/properties/:propertyId
 */
router.get("/properties/:propertyId", requirePortalAuth, guardPortalProperty, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.name, p.location, p.description, p.org_id, o.name AS org_name,
              pd.square_footage, pd.property_type
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       LEFT JOIN property_details pd ON pd.project_id = p.id
       WHERE p.id = $1`,
      [req.params.propertyId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Property not found." });
    res.json({ property: mapPropertySummary(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] portal property detail error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/portal/properties/:propertyId/documents
 * Read-only. Returns a short-lived signed download URL per document
 * rather than exposing the storage key.
 */
router.get("/properties/:propertyId/documents", requirePortalAuth, guardPortalProperty, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, file_name, content_type, size_bytes, description, storage_key, created_at
       FROM documents
       WHERE project_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.params.propertyId]
    );
    const documents = await Promise.all(
      r.rows.map(async (row) => ({
        id: row.id,
        fileName: row.file_name,
        contentType: row.content_type,
        sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
        description: row.description,
        createdAt: row.created_at,
        downloadUrl: r2.isConfigured ? await r2.getDownloadUrl(row.storage_key, row.file_name) : null,
      }))
    );
    res.json({ documents });
  } catch (err) {
    console.error("[radah-pm] portal list documents error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/portal/properties/:propertyId/warranties
 * Assets with warranty info — pulled from the existing assets registry,
 * no new table.
 */
router.get("/properties/:propertyId/warranties", requirePortalAuth, guardPortalProperty, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, category, make, model, serial_number, install_date, warranty_expires_at
       FROM assets
       WHERE project_id = $1 AND deleted_at IS NULL AND warranty_expires_at IS NOT NULL
       ORDER BY warranty_expires_at ASC`,
      [req.params.propertyId]
    );
    res.json({
      assets: r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        make: row.make,
        model: row.model,
        serialNumber: row.serial_number,
        installDate: row.install_date,
        warrantyExpiresAt: row.warranty_expires_at,
        warrantyStatus: new Date(row.warranty_expires_at) >= new Date() ? "active" : "expired",
      })),
    });
  } catch (err) {
    console.error("[radah-pm] portal list warranties error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/portal/properties/:propertyId/service-requests
 * Work order history for this property — doubles as the v1 "invoices"
 * view via each item's costCents (see file header note).
 */
router.get("/properties/:propertyId/service-requests", requirePortalAuth, guardPortalProperty, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, description, priority, status, scheduled_date, completed_at, cost_cents, created_at
       FROM work_orders
       WHERE project_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.params.propertyId]
    );
    res.json({
      serviceRequests: r.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        status: row.status,
        scheduledDate: row.scheduled_date,
        completedAt: row.completed_at,
        costCents: Number(row.cost_cents) || 0,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error("[radah-pm] portal list service requests error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/portal/properties/:propertyId/service-requests
 * Body: { title, description?, priority? }
 * Creates a normal work_orders row (status 'open', unassigned) traced back
 * to this portal account via requested_by_portal_account_id.
 */
router.post("/properties/:propertyId/service-requests", requirePortalAuth, guardPortalProperty, async (req, res) => {
  const { title, description, priority } = req.body || {};
  if (!title) return res.status(400).json({ error: "A short title for the request is required." });
  const allowedPriorities = ["low", "normal", "high", "urgent"];
  const finalPriority = allowedPriorities.includes(priority) ? priority : "normal";

  try {
    const r = await pool.query(
      `INSERT INTO work_orders (project_id, title, description, priority, status, requested_by_portal_account_id)
       VALUES ($1, $2, $3, $4, 'open', $5) RETURNING *`,
      [req.params.propertyId, title, description || null, finalPriority, req.portalAccount.id]
    );
    // NOTE (follow-up): no staff notification is fired here yet.
    // notifyExternal.js already has the right shape for this (never
    // throws, fire-and-forget) — wiring a "new portal service request"
    // notice to the org's staff is a small addition there, left out of
    // this pass to keep it scoped.
    res.status(201).json({
      serviceRequest: {
        id: r.rows[0].id,
        title: r.rows[0].title,
        description: r.rows[0].description,
        priority: r.rows[0].priority,
        status: r.rows[0].status,
        createdAt: r.rows[0].created_at,
      },
    });
  } catch (err) {
    console.error("[radah-pm] portal create service request error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
