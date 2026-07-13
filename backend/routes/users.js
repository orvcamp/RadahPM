// backend/routes/users.js
// Admin/staff-only user management: list users, create users (invite
// clients/trade partners directly), deactivate users.

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, requireOrg, revokeUserSessions } = require("../middleware/auth");
const { sendInviteEmail } = require("../invites");

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

    // Invite the new user with a "set your password" link (no password emailed).
    const orgRes = await pool.query("SELECT name FROM organizations WHERE id = $1", [req.user.orgId]);
    const invite = await sendInviteEmail({
      userId: result.rows[0].id,
      email: result.rows[0].email,
      fullName: result.rows[0].full_name,
      orgName: orgRes.rows[0] ? orgRes.rows[0].name : null,
      invitedByName: req.user.fullName || null,
    });

    res.status(201).json({
      user: publicUser(result.rows[0]),
      inviteEmailSent: invite.sent,
      inviteEmailError: invite.sent ? null : invite.reason || null,
      temporaryPassword: tempPassword,
      note: invite.sent
        ? "An invite email with a set-password link was sent. The temporary password below is a fallback only."
        : "Email wasn't sent — share this temporary password through a secure channel.",
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

/**
 * POST /api/users/:id/remove
 * Admin only. The primary "clean removal" tool: deactivates the account
 * AND frees up their email address for reuse (e.g. re-inviting a
 * replacement hire at the same email), by renaming the stored email off
 * to the side. Unlike a hard delete, this preserves every historical
 * record the person is attached to (time entries, approval decisions,
 * task comments, "created by" on documents/RFIs/etc.) — those all
 * reference this row via ON DELETE SET NULL or just stay pointed at it,
 * so audit trails keep working. Their name still shows correctly
 * everywhere; only their email and ability to log in change.
 * Cannot remove yourself, and cannot remove the org's last active admin
 * (would orphan the organization with no one able to manage it).
 */
router.post("/:id/remove", requireAuth, requireOrg, requireRole("admin"), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't remove your own account. Have another admin do it." });
  }
  try {
    const target = await pool.query("SELECT * FROM users WHERE id = $1 AND org_id = $2", [req.params.id, req.user.orgId]);
    if (!target.rows[0]) return res.status(404).json({ error: "User not found." });

    if (target.rows[0].role === "admin") {
      const otherAdmins = await pool.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND is_active = TRUE AND id != $2",
        [req.user.orgId, req.params.id]
      );
      if (otherAdmins.rows[0].n === 0) {
        return res.status(409).json({ error: "This is the last active admin on the account. Promote someone else to admin first." });
      }
    }

    const freedEmail = `deleted-${Date.now()}-${target.rows[0].email}`;
    const result = await pool.query(
      "UPDATE users SET is_active = FALSE, email = $1 WHERE id = $2 RETURNING *",
      [freedEmail, req.params.id]
    );
    await revokeUserSessions(req.params.id);
    res.json({
      user: publicUser(result.rows[0]),
      message: `${target.rows[0].full_name} was removed. "${target.rows[0].email}" is now free to use for a new invite.`,
    });
  } catch (err) {
    console.error("[radah-pm] remove user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/users/:id/deletion-preview
 * Admin only. Reports what a permanent delete would actually destroy —
 * the records that CASCADE-delete along with the user (time entries,
 * approval requests they made, task comments, project memberships) —
 * so the confirmation dialog can tell the truth about what's about to
 * happen instead of a generic "are you sure?".
 */
router.get("/:id/deletion-preview", requireAuth, requireOrg, requireRole("admin"), async (req, res) => {
  try {
    const target = await pool.query("SELECT id, full_name, email FROM users WHERE id = $1 AND org_id = $2", [req.params.id, req.user.orgId]);
    if (!target.rows[0]) return res.status(404).json({ error: "User not found." });

    const [timeEntries, approvalsRequested, taskComments, memberships] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n FROM time_entries WHERE user_id = $1", [req.params.id]),
      pool.query("SELECT COUNT(*)::int AS n FROM approval_requests WHERE requested_by = $1", [req.params.id]),
      pool.query("SELECT COUNT(*)::int AS n FROM task_comments WHERE user_id = $1", [req.params.id]),
      pool.query("SELECT COUNT(*)::int AS n FROM project_members WHERE user_id = $1", [req.params.id]),
    ]);

    res.json({
      fullName: target.rows[0].full_name,
      email: target.rows[0].email,
      willPermanentlyDelete: {
        timeEntries: timeEntries.rows[0].n,
        approvalRequestsMade: approvalsRequested.rows[0].n,
        taskComments: taskComments.rows[0].n,
        projectMemberships: memberships.rows[0].n,
      },
    });
  } catch (err) {
    console.error("[radah-pm] user deletion preview error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * DELETE /api/users/:id
 * Admin only, and only after the frontend has shown the deletion preview
 * above. True permanent delete — unlike /:id/remove, this actually
 * destroys the row and anything that CASCADEs from it (see the preview
 * endpoint for exactly what that is). Prefer POST /:id/remove for the
 * common case of someone leaving; this is for cleaning up a mistaken
 * invite or a test account that never should have existed.
 */
router.delete("/:id", requireAuth, requireOrg, requireRole("admin"), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account. Have another admin do it." });
  }
  try {
    const target = await pool.query("SELECT role FROM users WHERE id = $1 AND org_id = $2", [req.params.id, req.user.orgId]);
    if (!target.rows[0]) return res.status(404).json({ error: "User not found." });

    if (target.rows[0].role === "admin") {
      const otherAdmins = await pool.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND is_active = TRUE AND id != $2",
        [req.user.orgId, req.params.id]
      );
      if (otherAdmins.rows[0].n === 0) {
        return res.status(409).json({ error: "This is the last active admin on the account. Promote someone else to admin first." });
      }
    }

    const result = await pool.query("DELETE FROM users WHERE id = $1 AND org_id = $2 RETURNING id", [req.params.id, req.user.orgId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found." });
    res.json({ message: "User permanently deleted." });
  } catch (err) {
    console.error("[radah-pm] delete user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
