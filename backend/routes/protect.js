// backend/routes/protect.js
//
// Radah Protect — membership tiers and memberships. v1 billing_model is
// 'discount' only (see Phase 10 migration notes); the column exists so
// real subscription billing can be added later as a second implementation
// behind the same membership record.
//
// Discount resolution: a property's applicable discount is whichever of
// (a) a property-scoped membership on that property, or (b) an
// account-scoped membership on its org, is active — property-scoped wins
// if both exist, since it's the more specific grant. This mirrors no
// existing pattern in the codebase (Protect is genuinely new), but the
// property-beats-account precedence is the obvious reading of "account
// membership is a volume play across properties, property membership is
// a direct choice for this one" from this session's scoping discussion.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole, requireOrg } = require("../middleware/auth");
const { requireModule } = require("../orgModules");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

function mapTier(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    discountPercent: Number(row.discount_percent),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    tierId: row.tier_id,
    tierName: row.tier_name || null,
    discountPercent: row.discount_percent != null ? Number(row.discount_percent) : null,
    billingModel: row.billing_model,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// TIERS (org-scoped catalog)
// ============================================================

router.get("/protect/tiers", requireAuth, requireOrg, requireModule("protect"), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM protect_tiers WHERE org_id = $1 AND deleted_at IS NULL ORDER BY discount_percent ASC",
      [req.user.orgId]
    );
    res.json({ tiers: r.rows.map(mapTier) });
  } catch (err) {
    console.error("[radah-pm] list protect tiers error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post(
  "/protect/tiers",
  requireAuth,
  requireOrg,
  requireModule("protect"),
  requireRole("admin", "staff"),
  async (req, res) => {
    const { name, description, discountPercent } = req.body || {};
    if (!name) return res.status(400).json({ error: "Tier name is required." });
    const pct = Number(discountPercent);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: "Discount percent must be a number between 0 and 100." });
    }
    try {
      const r = await pool.query(
        `INSERT INTO protect_tiers (org_id, name, description, discount_percent, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.orgId, name, description || null, pct, req.user.id]
      );
      res.status(201).json({ tier: mapTier(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create protect tier error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.patch(
  "/protect/tiers/:id",
  requireAuth,
  requireOrg,
  requireModule("protect"),
  requireRole("admin", "staff"),
  async (req, res) => {
    try {
      const existing = await pool.query("SELECT org_id FROM protect_tiers WHERE id = $1 AND deleted_at IS NULL", [
        req.params.id,
      ]);
      if (!existing.rows[0] || existing.rows[0].org_id !== req.user.orgId) {
        return res.status(404).json({ error: "Tier not found." });
      }
      const bodyKeyMap = { name: "name", description: "description", discountPercent: "discount_percent", isActive: "is_active" };
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
      values.push(req.params.id);
      const r = await pool.query(`UPDATE protect_tiers SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`, values);
      res.json({ tier: mapTier(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] update protect tier error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.delete(
  "/protect/tiers/:id",
  requireAuth,
  requireOrg,
  requireModule("protect"),
  requireRole("admin", "staff"),
  async (req, res) => {
    try {
      const existing = await pool.query("SELECT org_id FROM protect_tiers WHERE id = $1 AND deleted_at IS NULL", [
        req.params.id,
      ]);
      if (!existing.rows[0] || existing.rows[0].org_id !== req.user.orgId) {
        return res.status(404).json({ error: "Tier not found." });
      }
      await pool.query("UPDATE protect_tiers SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [
        req.user.id,
        req.params.id,
      ]);
      res.json({ message: "Tier removed." });
    } catch (err) {
      console.error("[radah-pm] delete protect tier error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// MEMBERSHIPS (property- or account-scoped)
// ============================================================

/**
 * GET /api/protect/memberships?scopeType=&scopeId=
 * Without query params, returns every membership for the org. Internal
 * (admin/staff) endpoint — the property owner never sees membership
 * management, only its effect (their discounted service history).
 */
router.get("/protect/memberships", requireAuth, requireOrg, requireModule("protect"), async (req, res) => {
  try {
    const { scopeType, scopeId } = req.query;
    const conditions = ["m.org_id = $1", "m.deleted_at IS NULL"];
    const values = [req.user.orgId];
    if (scopeType) {
      values.push(scopeType);
      conditions.push(`m.scope_type = $${values.length}`);
    }
    if (scopeId) {
      values.push(scopeId);
      conditions.push(`m.scope_id = $${values.length}`);
    }
    const r = await pool.query(
      `SELECT m.*, t.name AS tier_name, t.discount_percent
       FROM protect_memberships m
       LEFT JOIN protect_tiers t ON t.id = m.tier_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.created_at DESC`,
      values
    );
    res.json({ memberships: r.rows.map(mapMembership) });
  } catch (err) {
    console.error("[radah-pm] list protect memberships error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/protect/memberships
 * Body: { scopeType: 'property'|'account', scopeId, tierId, startDate? }
 * scopeType 'property' -> scopeId must be a project_id this org can access.
 * scopeType 'account'  -> scopeId must equal the caller's own org_id
 *                          (an org can only grant an account-level
 *                          membership to itself, not another org).
 */
router.post(
  "/protect/memberships",
  requireAuth,
  requireOrg,
  requireModule("protect"),
  requireRole("admin", "staff"),
  async (req, res) => {
    const { scopeType, scopeId, tierId, startDate } = req.body || {};
    if (!["property", "account"].includes(scopeType)) {
      return res.status(400).json({ error: "scopeType must be 'property' or 'account'." });
    }
    if (!scopeId) return res.status(400).json({ error: "scopeId is required." });

    try {
      if (scopeType === "property") {
        const allowed = await userCanAccessProject(req.user, scopeId);
        if (!allowed) return res.status(404).json({ error: "Property not found." });
      } else if (scopeId !== req.user.orgId) {
        return res.status(403).json({ error: "An account-level membership must be scoped to your own organization." });
      }

      if (tierId) {
        const tierCheck = await pool.query("SELECT org_id FROM protect_tiers WHERE id = $1 AND deleted_at IS NULL", [tierId]);
        if (!tierCheck.rows[0] || tierCheck.rows[0].org_id !== req.user.orgId) {
          return res.status(400).json({ error: "Tier not found." });
        }
      }

      const r = await pool.query(
        `INSERT INTO protect_memberships (org_id, scope_type, scope_id, tier_id, start_date, created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6) RETURNING *`,
        [req.user.orgId, scopeType, scopeId, tierId || null, startDate || null, req.user.id]
      );
      res.status(201).json({ membership: mapMembership(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create protect membership error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.patch(
  "/protect/memberships/:id",
  requireAuth,
  requireOrg,
  requireModule("protect"),
  requireRole("admin", "staff"),
  async (req, res) => {
    try {
      const existing = await pool.query("SELECT org_id FROM protect_memberships WHERE id = $1 AND deleted_at IS NULL", [
        req.params.id,
      ]);
      if (!existing.rows[0] || existing.rows[0].org_id !== req.user.orgId) {
        return res.status(404).json({ error: "Membership not found." });
      }
      // status (active/paused/cancelled) and tier changes only — scope is
      // immutable by design (cancel and create a new one to re-scope).
      const bodyKeyMap = { status: "status", tierId: "tier_id", endDate: "end_date" };
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
      values.push(req.params.id);
      const r = await pool.query(
        `UPDATE protect_memberships SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );
      res.json({ membership: mapMembership(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] update protect membership error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

router.delete(
  "/protect/memberships/:id",
  requireAuth,
  requireOrg,
  requireModule("protect"),
  requireRole("admin", "staff"),
  async (req, res) => {
    try {
      const existing = await pool.query("SELECT org_id FROM protect_memberships WHERE id = $1 AND deleted_at IS NULL", [
        req.params.id,
      ]);
      if (!existing.rows[0] || existing.rows[0].org_id !== req.user.orgId) {
        return res.status(404).json({ error: "Membership not found." });
      }
      await pool.query("UPDATE protect_memberships SET deleted_at = now(), deleted_by = $1 WHERE id = $2", [
        req.user.id,
        req.params.id,
      ]);
      res.json({ message: "Membership removed." });
    } catch (err) {
      console.error("[radah-pm] delete protect membership error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

/**
 * GET /api/properties/:propertyId/protect-discount
 * Resolves the discount percent currently applicable to a property —
 * property-scoped membership wins over account-scoped if both exist.
 * Frontend calls this when entering/reviewing a work order's cost; there
 * is no automatic billing calculation in the codebase to hook into today
 * (cost_cents is entered directly), so this is a lookup the UI applies,
 * not an automatic deduction.
 */
router.get("/properties/:propertyId/protect-discount", requireAuth, requireOrg, requireModule("protect"), async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.propertyId);
    if (!allowed) return res.status(404).json({ error: "Property not found." });

    const propertyMembership = await pool.query(
      `SELECT m.*, t.discount_percent FROM protect_memberships m
       LEFT JOIN protect_tiers t ON t.id = m.tier_id
       WHERE m.scope_type = 'property' AND m.scope_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1`,
      [req.params.propertyId]
    );
    if (propertyMembership.rows[0]) {
      return res.json({
        discountPercent: Number(propertyMembership.rows[0].discount_percent) || 0,
        source: "property",
        membershipId: propertyMembership.rows[0].id,
      });
    }

    const accountMembership = await pool.query(
      `SELECT m.*, t.discount_percent FROM protect_memberships m
       LEFT JOIN protect_tiers t ON t.id = m.tier_id
       WHERE m.scope_type = 'account' AND m.scope_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1`,
      [req.user.orgId]
    );
    if (accountMembership.rows[0]) {
      return res.json({
        discountPercent: Number(accountMembership.rows[0].discount_percent) || 0,
        source: "account",
        membershipId: accountMembership.rows[0].id,
      });
    }

    res.json({ discountPercent: 0, source: null, membershipId: null });
  } catch (err) {
    console.error("[radah-pm] resolve protect discount error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
