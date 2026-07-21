// backend/routes/portalAuth.js
//
// Property Owner Portal — authentication.
// Deliberately separate from routes/auth.js: portal_accounts is its own
// identity table, not a users row (see Phase 10 migration notes for why).
// Self-registration is disabled here too, same reasoning as auth.js's
// /register — a portal account is created by staff granting access to a
// property (see routes/portalAccess.js), not by the owner signing up cold.

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const {
  requirePortalAuth,
  revokePortalAccountSessions,
  JWT_SECRET,
} = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const TOKEN_EXPIRY = "7d";

function signPortalToken(account) {
  return jwt.sign(
    {
      id: account.id,
      email: account.email,
      fullName: account.full_name,
      typ: "portal",
      tv: account.token_version == null ? 0 : account.token_version,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function publicPortalAccount(account) {
  return {
    id: account.id,
    email: account.email,
    fullName: account.full_name,
    phone: account.phone,
  };
}

/**
 * POST /api/portal/login
 * Body: { email, password }
 */
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM portal_accounts WHERE email = $1 AND is_active = TRUE",
      [email.toLowerCase().trim()]
    );
    const account = result.rows[0];

    if (!account) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signPortalToken(account);
    res.json({ token, account: publicPortalAccount(account) });
  } catch (err) {
    console.error("[radah-pm] portal login error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/portal/me
 */
router.get("/me", requirePortalAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM portal_accounts WHERE id = $1", [req.portalAccount.id]);
    const account = result.rows[0];
    if (!account) {
      return res.status(404).json({ error: "Account not found." });
    }
    res.json({ account: publicPortalAccount(account) });
  } catch (err) {
    console.error("[radah-pm] portal me error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/portal/change-password
 * Body: { currentPassword, newPassword }
 */
router.post("/change-password", requirePortalAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  try {
    const result = await pool.query("SELECT * FROM portal_accounts WHERE id = $1", [req.portalAccount.id]);
    const account = result.rows[0];

    const valid = await bcrypt.compare(currentPassword, account.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE portal_accounts SET password_hash = $1 WHERE id = $2", [newHash, req.portalAccount.id]);
    await revokePortalAccountSessions(req.portalAccount.id);
    const fresh = await pool.query("SELECT * FROM portal_accounts WHERE id = $1", [req.portalAccount.id]);
    const token = signPortalToken(fresh.rows[0]);

    res.json({ message: "Password updated. You've been signed out on other devices.", token });
  } catch (err) {
    console.error("[radah-pm] portal change-password error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// NOTE (follow-up, not in this pass): forgot-password / reset-password for
// portal accounts. auth.js's flow (crypto token + password_reset_tokens +
// mail.js) is directly reusable — it would need its own
// portal_password_reset_tokens table (token FKs to portal_accounts, not
// users) mirroring password_reset_tokens exactly. Left out here to keep
// this pass scoped; staff can reset a portal account's password manually
// via routes/portalAccess.js in the meantime. Worth adding before any real
// owner onboarding, since there'd otherwise be no self-serve recovery path.

module.exports = router;
module.exports.signPortalToken = signPortalToken;
