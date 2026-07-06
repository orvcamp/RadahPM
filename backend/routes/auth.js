// backend/routes/auth.js

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { requireAuth, requireRole, JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

const TOKEN_EXPIRY = "7d";

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      orgId: user.org_id,
      isPlatformAdmin: user.is_platform_admin === true,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    companyName: user.company_name,
    phone: user.phone,
    orgId: user.org_id,
    isPlatformAdmin: user.is_platform_admin === true,
  };
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND is_active = TRUE",
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("[radah-pm] login error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/auth/register
 * DISABLED under multi-tenancy. New users are created inside an organization
 * by an org admin (see POST /api/users). Open self-registration would create
 * users with no tenant, which isn't allowed. A self-serve "create your own
 * organization" signup can be added later as a deliberate feature.
 */
router.post("/register", async (req, res) => {
  return res.status(403).json({
    error:
      "Self-registration is disabled. Please ask your organization's administrator to create an account for you.",
  });
});

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile.
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("[radah-pm] me error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/auth/change-password
 * Body: { currentPassword, newPassword }
 */
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = result.rows[0];

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      newHash,
      req.user.id,
    ]);

    res.json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("[radah-pm] change-password error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
