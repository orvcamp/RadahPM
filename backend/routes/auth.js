// backend/routes/auth.js

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../db/pool");
const mail = require("../mail");
const { requireAuth, requireRole, revokeUserSessions, invalidateUserCache, JWT_SECRET } = require("../middleware/auth");
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter, resetKey } = require("../middleware/rateLimit");

const APP_URL = (process.env.APP_URL || "https://app.mangodoe.com").replace(/\/+$/, "");
const APP_NAME = process.env.APP_NAME || "MangoDoe";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

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
      tv: user.token_version == null ? 0 : user.token_version,
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
router.post("/login", loginLimiter, async (req, res) => {
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

    // Successful sign-in clears this IP+email's failed-attempt counter.
    resetKey(req);
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
    // Invalidate every existing token for this user, then hand this session a
    // fresh one so the person changing their password isn't logged out.
    await revokeUserSessions(req.user.id);
    const fresh = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const token = signToken(fresh.rows[0]);

    res.json({ message: "Password updated. You've been signed out on other devices.", token });
  } catch (err) {
    console.error("[radah-pm] change-password error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * POST /api/auth/forgot-password  { email }
 * Always responds the same way (no account enumeration). If the email maps to
 * an active user, a single-use, 1-hour reset link is emailed.
 */
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const generic = { message: "If an account exists for that email, a password reset link has been sent." };
  try {
    const email = (req.body && req.body.email ? String(req.body.email) : "").toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Email is required." });

    const userRes = await pool.query(
      "SELECT id, email, full_name, is_active FROM users WHERE email = $1",
      [email]
    );
    const user = userRes.rows[0];
    if (user && user.is_active !== false) {
      // Invalidate any prior unused tokens for this user.
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL", [user.id]);

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [user.id, tokenHash, expiresAt]
      );

      if (mail.isConfigured) {
        const link = `${APP_URL}/reset-password?token=${token}`;
        const esc = mail.escapeHtml;
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;color:#1E3D2B;max-width:520px;margin:0 auto;">
            <h2 style="margin:0 0 12px;">Reset your ${esc(APP_NAME)} password</h2>
            <p style="color:#26241F;line-height:1.5;">Hi ${esc(user.full_name || "there")}, we received a request to reset your password.</p>
            <p style="margin:22px 0;">
              <a href="${link}" style="background:#F28C28;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block;">Set a new password</a>
            </p>
            <p style="color:#6b7280;font-size:13px;line-height:1.5;">This link expires in 1 hour and can be used once. If you didn't request this, you can safely ignore this email — your password won't change.</p>
            <p style="color:#9ca3af;font-size:12px;word-break:break-all;">Or paste this link into your browser:<br>${link}</p>
          </div>`;
        try {
          await mail.send({ to: [user.email], subject: `Reset your ${APP_NAME} password`, html });
        } catch (e) {
          console.error("[radah-pm] reset email send failed:", e.message);
        }
      } else {
        console.error("[radah-pm] forgot-password requested but mail is not configured.");
      }
    }
    return res.json(generic);
  } catch (err) {
    console.error("[radah-pm] forgot-password error:", err);
    // Still respond generically to avoid leaking anything.
    return res.json(generic);
  }
});

/**
 * POST /api/auth/reset-password  { token, newPassword }
 * Verifies a single-use, unexpired token and sets the new password.
 */
router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required." });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  try {
    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const rowRes = await pool.query(
      "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
      [tokenHash]
    );
    const row = rowRes.rows[0];
    if (!row) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }
    const newHash = await bcrypt.hash(String(newPassword), 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, row.user_id]);
    // Any sessions opened before the reset are no longer valid.
    await revokeUserSessions(row.user_id);
    // Consume this token and clear any others for the user.
    await pool.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL", [row.user_id]);
    return res.json({ message: "Your password has been reset. You can now sign in." });
  } catch (err) {
    console.error("[radah-pm] reset-password error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
