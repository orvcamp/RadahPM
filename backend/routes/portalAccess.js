// backend/routes/portalAccess.js
//
// Staff-facing management of Property Owner Portal access. An admin/staff
// user grants a property to an owner's email; this find-or-creates the
// portal_accounts row (one per email, platform-wide) and adds a
// portal_account_access grant linking it to this property + org.
//
// Granting access across orgs: nothing here restricts an email to one org.
// If the same email is granted a property in a second org later (by that
// org's own staff), portal_account_access simply gains a second row for
// the same portal_accounts.id — which is exactly the "one login sees
// properties across multiple orgs" behavior this was built for.

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, requireOrg } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapGrant(row) {
  return {
    id: row.id,
    propertyId: row.project_id,
    portalAccountId: row.portal_account_id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

async function guardProperty(req, res, next) {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.propertyId);
    if (!allowed) return res.status(404).json({ error: "Property not found." });
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/properties/:propertyId/portal-access
 * List everyone with portal access to this property.
 */
router.get(
  "/properties/:propertyId/portal-access",
  requireAuth,
  requireOrg,
  requireModule("owner_portal"),
  guardProperty,
  async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT a.id, a.project_id, a.portal_account_id, a.added_by, a.created_at,
                pa.email, pa.full_name, pa.phone
         FROM portal_account_access a
         JOIN portal_accounts pa ON pa.id = a.portal_account_id
         WHERE a.project_id = $1
         ORDER BY pa.full_name ASC`,
        [req.params.propertyId]
      );
      res.json({ grants: r.rows.map(mapGrant) });
    } catch (err) {
      console.error("[radah-pm] list portal access error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

/**
 * POST /api/properties/:propertyId/portal-access
 * Body: { email, fullName, phone? }
 * Grants portal access to this property for the given email — creates the
 * portal_accounts row if this email has never had one (platform-wide,
 * not per-org), reuses it otherwise. Returns a one-time temp password when
 * the account is newly created, since there's no self-registration path;
 * staff pass this to the owner directly (out of band — never over email
 * from this endpoint) or the owner uses forgot-password once that lands.
 */
router.post(
  "/properties/:propertyId/portal-access",
  requireAuth,
  requireOrg,
  requireModule("owner_portal"),
  requireRole("admin", "staff"),
  guardProperty,
  async (req, res) => {
    const { email, fullName, phone } = req.body || {};
    if (!email || !fullName) {
      return res.status(400).json({ error: "Email and full name are required." });
    }
    const normalizedEmail = String(email).toLowerCase().trim();

    try {
      let account;
      let tempPassword = null;
      const existing = await pool.query("SELECT * FROM portal_accounts WHERE email = $1", [normalizedEmail]);

      if (existing.rows.length > 0) {
        account = existing.rows[0];
      } else {
        tempPassword = crypto.randomBytes(9).toString("base64url"); // 12-char, URL-safe
        const passwordHash = await bcrypt.hash(tempPassword, 12);
        const created = await pool.query(
          `INSERT INTO portal_accounts (email, password_hash, full_name, phone)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [normalizedEmail, passwordHash, fullName, phone || null]
        );
        account = created.rows[0];
      }

      const grant = await pool.query(
        `INSERT INTO portal_account_access (portal_account_id, org_id, project_id, added_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (portal_account_id, project_id) DO NOTHING
         RETURNING *`,
        [account.id, req.user.orgId, req.params.propertyId, req.user.id]
      );

      if (grant.rows.length === 0) {
        return res.status(409).json({ error: "This person already has portal access to this property." });
      }

      res.status(201).json({
        grant: mapGrant({ ...grant.rows[0], email: account.email, full_name: account.full_name, phone: account.phone }),
        tempPassword, // null if the account already existed
      });
    } catch (err) {
      console.error("[radah-pm] grant portal access error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

/**
 * DELETE /api/portal-access/:id
 * Revokes one property grant. Does not delete the portal_accounts row
 * itself — the owner may still have access to other properties.
 */
router.delete("/portal-access/:id", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  try {
    const existing = await pool.query("SELECT * FROM portal_account_access WHERE id = $1", [req.params.id]);
    const row = existing.rows[0];
    if (!row || row.org_id !== req.user.orgId) {
      return res.status(404).json({ error: "Grant not found." });
    }
    await pool.query("DELETE FROM portal_account_access WHERE id = $1", [req.params.id]);
    res.json({ message: "Portal access revoked." });
  } catch (err) {
    console.error("[radah-pm] revoke portal access error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
