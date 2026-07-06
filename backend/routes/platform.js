// backend/routes/platform.js
//
// Platform (super) admin endpoints — organization provisioning. This is the
// only place that operates across the tenant boundary, and only to CREATE
// orgs and their first admin. It does NOT expose one org's project/budget/
// document data to another; it just provisions tenants.
//
// Guarded by requirePlatformAdmin (the is_platform_admin flag in the JWT).

const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const { requireAuth, requirePlatformAdmin } = require("../middleware/auth");

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
    res.json({
      organizations: r.rows.map((o) => ({
        id: o.id,
        name: o.name,
        isActive: o.is_active,
        userCount: Number(o.user_count),
        projectCount: Number(o.project_count),
        createdAt: o.created_at,
      })),
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
  const { orgName, adminEmail, adminFullName, adminPassword } = req.body || {};
  if (!orgName || !orgName.trim()) return res.status(400).json({ error: "Organization name is required." });
  if (!adminEmail || !adminFullName) return res.status(400).json({ error: "Admin email and full name are required." });
  if (!adminPassword || adminPassword.length < 8) {
    return res.status(400).json({ error: "Admin password must be at least 8 characters." });
  }

  const client = await pool.connect();
  try {
    const email = adminEmail.toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      client.release();
      return res.status(409).json({ error: "A user with that email already exists." });
    }

    await client.query("BEGIN");
    const orgRes = await client.query(
      "INSERT INTO organizations (name) VALUES ($1) RETURNING id, name",
      [orgName.trim()]
    );
    const orgId = orgRes.rows[0].id;
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, org_id, is_platform_admin)
       VALUES ($1, $2, $3, 'admin', TRUE, $4, FALSE)
       RETURNING id, email, full_name`,
      [email, passwordHash, adminFullName.trim(), orgId]
    );
    await client.query("COMMIT");

    res.status(201).json({
      organization: { id: orgId, name: orgRes.rows[0].name },
      admin: {
        id: userRes.rows[0].id,
        email: userRes.rows[0].email,
        fullName: userRes.rows[0].full_name,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] create organization error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

module.exports = router;
