// backend/routes/vendors.js
//
// MangoDoe Facilities — Vendor & Contract Management.
//
// Vendors are org-scoped (a vendor can serve more than one property), not
// property-scoped — same reasoning as why users/orgs work the way they do
// elsewhere in this codebase. Vendor Contracts are the property-scoped
// join between a vendor and a specific property.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, requireOrg } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapVendor(row) {
  return {
    id: row.id,
    name: row.name,
    trade: row.trade,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    insuranceExpiresAt: row.insurance_expires_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContract(row) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    propertyId: row.project_id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    valueCents: row.value_cents === null ? null : Number(row.value_cents),
    renewalReminderDays: row.renewal_reminder_days,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function guardVendor(req, res, next) {
  try {
    const r = await pool.query("SELECT org_id FROM vendors WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const row = r.rows[0];
    if (!row || row.org_id !== req.user.orgId) return res.status(404).json({ error: "Vendor not found." });
    next();
  } catch (e) { next(e); }
}

async function guardProperty(req, res, next) {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.propertyId);
    if (!allowed) return res.status(404).json({ error: "Property not found." });
    next();
  } catch (e) { next(e); }
}

async function guardContract(req, res, next) {
  try {
    const r = await pool.query("SELECT project_id FROM vendor_contracts WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    const row = r.rows[0];
    if (!row || !(await userCanAccessProject(req.user, row.project_id))) {
      return res.status(404).json({ error: "Vendor contract not found." });
    }
    next();
  } catch (e) { next(e); }
}

// ============================================================
// VENDORS (org-scoped directory)
// ============================================================

router.get("/vendors", requireAuth, requireOrg, requireModule("vendors"), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM vendors WHERE org_id = $1 AND deleted_at IS NULL ORDER BY name ASC",
      [req.user.orgId]
    );
    res.json({ vendors: r.rows.map(mapVendor) });
  } catch (err) {
    console.error("[radah-pm] list vendors error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post("/vendors", requireAuth, requireOrg, requireModule("vendors"), requireRole("admin", "staff"), async (req, res) => {
  const { name, trade, contactName, phone, email, insuranceExpiresAt, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Vendor name is required." });
  try {
    const r = await pool.query(
      `INSERT INTO vendors (org_id, name, trade, contact_name, phone, email, insurance_expires_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.orgId, name, trade || null, contactName || null, phone || null, email || null,
        insuranceExpiresAt || null, notes || null, req.user.id]
    );
    res.status(201).json({ vendor: mapVendor(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] create vendor error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.patch("/vendors/:id", requireAuth, requireRole("admin", "staff"), guardVendor, async (req, res) => {
  const bodyKeyMap = {
    name: "name", trade: "trade", contactName: "contact_name", phone: "phone",
    email: "email", insuranceExpiresAt: "insurance_expires_at", notes: "notes",
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
    const r = await pool.query(`UPDATE vendors SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ vendor: mapVendor(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update vendor error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/vendors/:id", requireAuth, requireRole("admin", "staff"), guardVendor, async (req, res) => {
  try {
    await pool.query("UPDATE vendors SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Vendor removed." });
  } catch (err) {
    console.error("[radah-pm] delete vendor error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// VENDOR CONTRACTS (property-scoped)
// ============================================================

router.get("/properties/:propertyId/vendor-contracts", requireAuth, requireModule("vendors"), guardProperty, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM vendor_contracts WHERE project_id = $1 AND deleted_at IS NULL ORDER BY end_date ASC NULLS LAST",
      [req.params.propertyId]
    );
    res.json({ contracts: r.rows.map(mapContract) });
  } catch (err) {
    console.error("[radah-pm] list vendor contracts error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post(
  "/properties/:propertyId/vendor-contracts",
  requireAuth,
  requireModule("vendors"),
  requireRole("admin", "staff"),
  guardProperty,
  async (req, res) => {
    const { vendorId, title, startDate, endDate, valueCents, renewalReminderDays, notes } = req.body || {};
    if (!vendorId || !title) return res.status(400).json({ error: "vendorId and title are required." });
    // Confirm the vendor belongs to this same org before linking it.
    const v = await pool.query("SELECT org_id FROM vendors WHERE id = $1 AND deleted_at IS NULL", [vendorId]);
    if (!v.rows[0] || v.rows[0].org_id !== req.user.orgId) {
      return res.status(400).json({ error: "Vendor not found." });
    }
    try {
      const r = await pool.query(
        `INSERT INTO vendor_contracts (vendor_id, project_id, title, start_date, end_date, value_cents, renewal_reminder_days, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 30), $8, $9) RETURNING *`,
        [vendorId, req.params.propertyId, title, startDate || null, endDate || null, valueCents || null,
          renewalReminderDays || null, notes || null, req.user.id]
      );
      res.status(201).json({ contract: mapContract(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create vendor contract error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.patch("/vendor-contracts/:id", requireAuth, requireRole("admin", "staff"), guardContract, async (req, res) => {
  const bodyKeyMap = {
    title: "title", startDate: "start_date", endDate: "end_date",
    valueCents: "value_cents", renewalReminderDays: "renewal_reminder_days", notes: "notes",
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
    const r = await pool.query(`UPDATE vendor_contracts SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
    res.json({ contract: mapContract(r.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] update vendor contract error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/vendor-contracts/:id", requireAuth, requireRole("admin", "staff"), guardContract, async (req, res) => {
  try {
    await pool.query("UPDATE vendor_contracts SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [req.user.id, req.params.id]);
    res.json({ message: "Vendor contract removed." });
  } catch (err) {
    console.error("[radah-pm] delete vendor contract error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
