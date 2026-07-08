// backend/routes/platform.js
//
// Platform (super) admin endpoints — organization provisioning. This is the
// only place that operates across the tenant boundary, and only to CREATE
// orgs and their first admin. It does NOT expose one org's project/budget/
// document data to another; it just provisions tenants.
//
// Guarded by requirePlatformAdmin (the is_platform_admin flag in the JWT).

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const { requireAuth, requirePlatformAdmin, revokeUserSessions } = require("../middleware/auth");
const { getOrgModules, MODULES, MODULE_KEYS } = require("../orgModules");
const { sendInviteEmail } = require("../invites");

const router = express.Router();

// GET /api/platform/organizations — list all orgs with basic counts.
router.get("/organizations", requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.id, o.name, o.is_active, o.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS user_count,
              (SELECT COUNT(*) FROM projects p WHERE p.org_id = o.id) AS project_count
         FROM organizations o
         ORDER BY o.created_at ASC`
    );
    const organizations = [];
    for (const o of r.rows) {
      organizations.push({
        id: o.id,
        name: o.name,
        isActive: o.is_active,
        userCount: Number(o.user_count),
        projectCount: Number(o.project_count),
        createdAt: o.created_at,
        modules: await getOrgModules(o.id),
      });
    }
    res.json({ organizations, availableModules: MODULES });
  } catch (err) {
    console.error("[radah-pm] list organizations error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/platform/organizations — create an org + its first admin.
// Body: { orgName, adminEmail, adminFullName, adminPassword }
// The created admin is a TENANT admin (role='admin'), not a platform admin.
router.post("/organizations", requireAuth, requirePlatformAdmin, async (req, res) => {
  const { orgName, adminEmail, adminFullName } = req.body || {};
  if (!orgName || !orgName.trim()) return res.status(400).json({ error: "Organization name is required." });
  if (!adminEmail || !adminFullName) return res.status(400).json({ error: "Admin email and full name are required." });

  const client = await pool.connect();
  try {
    const email = adminEmail.toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      client.release();
      return res.status(409).json({ error: "A user with that email already exists." });
    }

    // Auto-generate a temporary password for the new org admin.
    const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "");

    await client.query("BEGIN");
    const orgRes = await client.query(
      "INSERT INTO organizations (name) VALUES ($1) RETURNING id, name",
      [orgName.trim()]
    );
    const orgId = orgRes.rows[0].id;
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, org_id, is_platform_admin)
       VALUES ($1, $2, $3, 'admin', TRUE, $4, FALSE)
       RETURNING id, email, full_name`,
      [email, passwordHash, adminFullName.trim(), orgId]
    );
    await client.query("COMMIT");

    // Welcome the new org admin with a "set your password" link (no password
    // in the email). If mail isn't configured or the send fails, the caller
    // falls back to the temporary password shown on screen.
    const invite = await sendInviteEmail({
      userId: userRes.rows[0].id,
      email: userRes.rows[0].email,
      fullName: userRes.rows[0].full_name,
      orgName: orgRes.rows[0].name,
      isOrgAdmin: true,
    });

    res.status(201).json({
      organization: { id: orgId, name: orgRes.rows[0].name },
      admin: {
        id: userRes.rows[0].id,
        email: userRes.rows[0].email,
        fullName: userRes.rows[0].full_name,
      },
      inviteEmailSent: invite.sent,
      inviteEmailError: invite.sent ? null : invite.reason || null,
      temporaryPassword: tempPassword,
      note: invite.sent
        ? "A welcome email with a set-password link was sent. The temporary password below is a fallback only."
        : "Email wasn't sent — share this temporary password with the org admin securely.",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] create organization error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});


// PATCH /api/platform/organizations/:id/modules
// Body: { moduleKey, enabled }  — enable/disable a capability module for an org.
router.patch("/organizations/:id/modules", requireAuth, requirePlatformAdmin, async (req, res) => {
  const { moduleKey, enabled } = req.body || {};
  if (!MODULE_KEYS.includes(moduleKey)) {
    return res.status(400).json({ error: "Unknown module." });
  }
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be true or false." });
  }
  try {
    const org = await pool.query("SELECT 1 FROM organizations WHERE id = $1", [req.params.id]);
    if (org.rows.length === 0) return res.status(404).json({ error: "Organization not found." });
    await pool.query(
      `INSERT INTO org_modules (org_id, module_key, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [req.params.id, moduleKey, enabled]
    );
    res.json({ moduleKey, enabled });
  } catch (err) {
    console.error("[radah-pm] update org module error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/platform/organizations/:id/reset-admin
// Platform-admin recovery: resets the earliest admin of an org and returns a
// one-time temporary password. Use to recover access to a tenant you manage.
router.post("/organizations/:id/reset-admin", requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const u = await pool.query(
      "SELECT id, email, full_name FROM users WHERE org_id = $1 AND role = 'admin' ORDER BY created_at ASC LIMIT 1",
      [req.params.id]
    );
    if (u.rows.length === 0) {
      return res.status(404).json({ error: "This organization has no admin user to reset." });
    }
    const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "");
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, u.rows[0].id]);
    await revokeUserSessions(u.rows[0].id);
    res.json({
      email: u.rows[0].email,
      fullName: u.rows[0].full_name,
      temporaryPassword: tempPassword,
      note: "Share this with the org admin through a secure channel. They should change it after logging in.",
    });
  } catch (err) {
    console.error("[radah-pm] reset org admin error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
