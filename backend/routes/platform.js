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
const { requireAuth, requirePlatformAdmin, revokeUserSessions, revokeOrgSessions } = require("../middleware/auth");
const { getOrgModules, MODULES, MODULE_KEYS } = require("../orgModules");
const { sendInviteEmail } = require("../invites");
const { signToken } = require("./auth");

const router = express.Router();

const VERTICALS = ["construction", "projects", "facilities"];

// GET /api/platform/organizations — list all orgs with basic counts, plus a
// cross-vertical breakdown for the dashboard. Org count is real, computed
// from actual rows. MRR and pilot-decision tracking are NOT included here —
// that data isn't tracked anywhere in the schema yet (no billing-subscription
// or pilot-status table exists), so this deliberately doesn't fake it with
// placeholder numbers. Adding real MRR/pilot tracking is future work.
router.get("/organizations", requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.id, o.name, o.vertical, o.is_active, o.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS user_count,
              (SELECT COUNT(*) FROM projects p WHERE p.org_id = o.id) AS project_count
         FROM organizations o
         ORDER BY o.created_at ASC`
    );
    const organizations = [];
    const verticalCounts = { construction: 0, projects: 0, facilities: 0 };
    let activeCount = 0;
    for (const o of r.rows) {
      const vertical = o.vertical || "construction";
      verticalCounts[vertical] = (verticalCounts[vertical] || 0) + 1;
      if (o.is_active) activeCount++;
      organizations.push({
        id: o.id,
        name: o.name,
        vertical,
        isActive: o.is_active,
        userCount: Number(o.user_count),
        projectCount: Number(o.project_count),
        createdAt: o.created_at,
        modules: await getOrgModules(o.id),
      });
    }
    res.json({
      organizations,
      availableModules: MODULES,
      summary: {
        totalOrgs: organizations.length,
        activeOrgs: activeCount,
        suspendedOrgs: organizations.length - activeCount,
        verticalCounts,
      },
    });
  } catch (err) {
    console.error("[radah-pm] list organizations error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/platform/organizations — create an org + its first admin.
// Body: { orgName, adminEmail, adminFullName, adminPassword }
// The created admin is a TENANT admin (role='admin'), not a platform admin.
router.post("/organizations", requireAuth, requirePlatformAdmin, async (req, res) => {
  const { orgName, adminEmail, adminFullName, vertical } = req.body || {};
  if (!orgName || !orgName.trim()) return res.status(400).json({ error: "Organization name is required." });
  if (!adminEmail || !adminFullName) return res.status(400).json({ error: "Admin email and full name are required." });
  const orgVertical = vertical || "construction";
  if (!VERTICALS.includes(orgVertical)) {
    return res.status(400).json({ error: `vertical must be one of: ${VERTICALS.join(", ")}` });
  }

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
      "INSERT INTO organizations (name, vertical) VALUES ($1, $2) RETURNING id, name, vertical",
      [orgName.trim(), orgVertical]
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
      organization: { id: orgId, name: orgRes.rows[0].name, vertical: orgRes.rows[0].vertical },
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

// PATCH /api/platform/organizations/:id/status
// Body: { isActive: boolean } — suspend or reactivate an org.
// Suspending blocks new logins immediately (see the org_is_active check in
// POST /auth/login) AND revokes every session already in progress for that
// org's users right now, via revokeOrgSessions — otherwise "suspended"
// would only be true for people who haven't logged in yet today.
router.patch("/organizations/:id/status", requireAuth, requirePlatformAdmin, async (req, res) => {
  const { isActive } = req.body || {};
  if (typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive must be true or false." });
  }
  try {
    const r = await pool.query(
      "UPDATE organizations SET is_active = $1 WHERE id = $2 RETURNING id, name, is_active",
      [isActive, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Organization not found." });
    if (!isActive) {
      await revokeOrgSessions(req.params.id);
    }
    console.log(`[radah-pm] AUDIT: platform admin ${req.user.email} set org ${r.rows[0].name} (${req.params.id}) isActive=${isActive}`);
    res.json({ id: r.rows[0].id, name: r.rows[0].name, isActive: r.rows[0].is_active });
  } catch (err) {
    console.error("[radah-pm] update org status error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/platform/organizations/:id/impersonate
// Issues a real, normal session token for that org's earliest admin user —
// the platform admin's browser then uses it exactly like a regular login.
// This deliberately does NOT create any special "merged" or cross-vertical
// view: the token carries that org's actual role/orgId, so the frontend
// renders precisely what that org's admin would see, nothing more (see
// Section 5 of the design doc — impersonation stays single-vertical, always).
// A structured audit line is logged; there's no dedicated audit table yet,
// so this is a lightweight (greppable in Railway logs), not a durable,
// audit trail — a real audit_log table is worth adding before this feature
// sees heavy use.
router.post("/organizations/:id/impersonate", requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const org = await pool.query("SELECT id, name, vertical, is_active FROM organizations WHERE id = $1", [req.params.id]);
    if (!org.rows[0]) return res.status(404).json({ error: "Organization not found." });
    if (!org.rows[0].is_active) {
      return res.status(409).json({ error: "This organization is suspended. Reactivate it before impersonating." });
    }
    const u = await pool.query(
      "SELECT * FROM users WHERE org_id = $1 AND role = 'admin' AND is_active = TRUE ORDER BY created_at ASC LIMIT 1",
      [req.params.id]
    );
    if (!u.rows[0]) {
      return res.status(404).json({ error: "This organization has no active admin user to impersonate." });
    }
    const target = u.rows[0];
    const token = signToken(target);
    console.log(`[radah-pm] AUDIT: platform admin ${req.user.email} impersonated ${target.email} (org ${org.rows[0].name}, ${req.params.id})`);
    res.json({
      token,
      user: {
        id: target.id,
        email: target.email,
        fullName: target.full_name,
        role: target.role,
        companyName: target.company_name,
        phone: target.phone,
        orgId: target.org_id,
        orgVertical: org.rows[0].vertical,
        isPlatformAdmin: false,
      },
      orgName: org.rows[0].name,
    });
  } catch (err) {
    console.error("[radah-pm] impersonate error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
