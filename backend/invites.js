// backend/invites.js
//
// Welcome / invite emails for newly created accounts.
//
// Deliberately does NOT email a password. Instead it issues a single-use,
// 7-day "set your password" token (the same hashed-token machinery the
// forgot-password flow uses) and emails a link. Nothing sensitive travels by
// email, and the recipient chooses their own password.
//
// Degrades gracefully: if email isn't configured, or the send fails, account
// creation still succeeds — the caller falls back to showing the temporary
// password on screen.

const crypto = require("crypto");
const pool = require("./db/pool");
const mail = require("./mail");

const APP_URL = (process.env.APP_URL || "https://app.mangodoe.com").replace(/\/+$/, "");
const APP_NAME = process.env.APP_NAME || "MangoDoe";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Create a single-use set-password token for a user and return the link.
 * Clears any of that user's unused tokens first.
 */
async function createInviteLink(userId) {
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL", [userId]);
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await pool.query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt]
  );
  return `${APP_URL}/reset-password?token=${token}&invite=1`;
}

function inviteHtml({ fullName, link, orgName, invitedByName, isOrgAdmin }) {
  const esc = mail.escapeHtml;
  const intro = isOrgAdmin
    ? `An account has been created for you as the administrator of <strong>${esc(orgName || "your organization")}</strong> on ${esc(APP_NAME)}.`
    : `${invitedByName ? esc(invitedByName) + " has invited you" : "You've been invited"} to join <strong>${esc(orgName || "your organization")}</strong> on ${esc(APP_NAME)}.`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1E3D2B;max-width:540px;margin:0 auto;">
      <h2 style="margin:0 0 12px;">Welcome to ${esc(APP_NAME)}</h2>
      <p style="color:#26241F;line-height:1.55;">Hi ${esc(fullName || "there")},</p>
      <p style="color:#26241F;line-height:1.55;">${intro}</p>
      <p style="color:#26241F;line-height:1.55;">Click below to choose your password and sign in. For your security, we never send passwords by email.</p>
      <p style="margin:24px 0;">
        <a href="${link}" style="background:#F28C28;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;display:inline-block;">Set your password</a>
      </p>
      <p style="color:#6b7280;font-size:13px;line-height:1.5;">This link is valid for 7 days and can be used once. If it expires, use “Forgot password?” on the sign-in page to get a new one.</p>
      <p style="color:#9ca3af;font-size:12px;word-break:break-all;">Or paste this into your browser:<br>${link}</p>
      <hr style="border:none;border-top:1px solid #E2E1DA;margin:22px 0;">
      <p style="font-size:12px;color:#9ca3af;">${esc(APP_NAME)} — construction project management.</p>
    </div>`;
}

/**
 * Send a welcome/invite email. Never throws — returns whether it was sent so
 * the caller can tell the operator to fall back to the temporary password.
 *
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendInviteEmail({ userId, email, fullName, orgName, invitedByName, isOrgAdmin = false }) {
  if (!mail.isConfigured) return { sent: false, reason: "Email is not configured on the server." };
  try {
    const link = await createInviteLink(userId);
    await mail.send({
      to: [email],
      subject: `You've been added to ${APP_NAME}`,
      html: inviteHtml({ fullName, link, orgName, invitedByName, isOrgAdmin }),
    });
    return { sent: true };
  } catch (err) {
    console.error("[radah-pm] invite email failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendInviteEmail, createInviteLink };
