// backend/routes/users.js
// Admin/staff-only user management: list users, create users (invite
// clients/trade partners directly), deactivate users.

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, requireOrg, revokeUserSessions } = require("../middleware/auth");

const router = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    companyName: user.company_name,
    phone: user.phone,
    isActive: user.is_active,
    createdAt: user.created_at,
  };
}

/**
 * GET /api/users
 * Admin/staff only. Optional ?role=client filter.
 */
router.get("/", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  const { role } = req.query;
  try {
    const result = role
      ? await pool.query("SELECT * FROM users WHERE org_id = $1 AND role = $2 ORDER BY created_at DESC", [req.user.orgId, role])
      : await pool.query("SELECT * FROM users WHERE org_id = $1 ORDER BY created_at DESC", [req.user.orgId]);
    res.json({ users: result.rows.map(publicUser) });
  } catch (err) {
    console.error("[radah-pm] list users error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/users
 * Admin/staff only. Creates a new user account directly (e.g. inviting
 * a client or trade partner without requiring them to self-register).
 * Returns a generated temporary password so the admin can share it
 * with the new user through a secure channel.
 * Body: { email, fullName, role, companyName, phone }
 */
router.post("/", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  const { email, fullName, role, companyName, phone } = req.body || {};

  const validRoles = ["admin", "staff", "client", "trade_partner"];
  if (!email || !fullName || !validRoles.includes(role)) {
    return res.status(400).json({ error: "Email, full name, and a valid role are required." });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase().trim(),
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "");
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, company_name, phone, org_id)
       VALUES ($1, $2, $3, $4::user_role, $5, $6, $7)
       RETURNING *`,
      [email.toLowerCase().trim(), passwordHash, fullName, role, companyName || null, phone || null, req.user.orgId]
    );

    res.status(201).json({
      user: publicUser(result.rows[0]),
      temporaryPassword: tempPassword,
      note: "Share this temporary password with the user through a secure channel. They should change it after first login.",
    });
  } catch (err) {
    console.error("[radah-pm] create user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * PATCH /api/users/:id/deactivate
 * Admin/staff only.
 */
router.patch("/:id/deactivate", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE users SET is_active = FALSE WHERE id = $1 AND org_id = $2 RETURNING *",
      [req.params.id, req.user.orgId]
    );
    // A deactivated user's existing tokens must stop working immediately.
    if (result.rows.length > 0) await revokeUserSessions(req.params.id);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] deactivate user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * PATCH /api/users/:id/reactivate
 * Admin/staff only.
 */
router.patch("/:id/reactivate", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE users SET is_active = TRUE WHERE id = $1 AND org_id = $2 RETURNING *",
      [req.params.id, req.user.orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error("[radah-pm] reactivate user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/users/:id/reset-password
 * Admin/staff only. Generates a new temporary password for a user who
 * lost or never received their original one. Returns it once, the same
 * way account creation does — there is no email delivery in Phase 1, so
 * the admin must share it with the user through a secure channel.
 */
router.post("/:id/reset-password", requireAuth, requireOrg, requireRole("admin", "staff"), async (req, res) => {
  try {
    const existing = await pool.query("SELECT id FROM users WHERE id = $1 AND org_id = $2", [req.params.id, req.user.orgId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "");
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      passwordHash,
      req.params.id,
    ]);
    // Kill any sessions the user still has open.
    await revokeUserSessions(req.params.id);

    res.json({
      temporaryPassword: tempPassword,
      note: "Share this temporary password with the user through a secure channel. They should change it after logging in.",
    });
  } catch (err) {
    console.error("[radah-pm] reset password error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
