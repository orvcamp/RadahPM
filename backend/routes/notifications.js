// backend/routes/notifications.js
//
// The in-app bell. A user only ever sees their own notifications, and rows are
// created with the recipient's user_id, so no org filtering is needed beyond
// the ownership check.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_LIMIT = 50;

// GET /api/notifications?limit=20&unreadOnly=true
router.get("/notifications", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_LIMIT);
  const unreadOnly = req.query.unreadOnly === "true";
  try {
    const rows = await pool.query(
      `SELECT id, project_id, project_name, type, title, body, tab, actor_name, read_at, created_at
         FROM notifications
        WHERE user_id = $1
          ${unreadOnly ? "AND read_at IS NULL" : ""}
        ORDER BY created_at DESC
        LIMIT $2`,
      [req.user.id, limit]
    );
    const unread = await pool.query(
      "SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [req.user.id]
    );
    res.json({
      unreadCount: unread.rows[0].c,
      notifications: rows.rows.map((n) => ({
        id: n.id,
        projectId: n.project_id,
        projectName: n.project_name,
        type: n.type,
        title: n.title,
        body: n.body,
        tab: n.tab,
        actorName: n.actor_name,
        read: n.read_at !== null,
        createdAt: n.created_at,
      })),
    });
  } catch (err) {
    console.error("[radah-pm] list notifications error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// GET /api/notifications/unread-count  — cheap poll target
router.get("/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [req.user.id]
    );
    res.json({ unreadCount: r.rows[0].c });
  } catch (err) {
    console.error("[radah-pm] unread count error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/notifications/:id/read
router.post("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id",
      [req.params.id, req.user.id]
    );
    if (r.rows.length === 0) return res.json({ message: "Already read." });
    res.json({ message: "Marked read." });
  } catch (err) {
    console.error("[radah-pm] mark read error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// POST /api/notifications/read-all
router.post("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
    res.json({ message: "All notifications marked read." });
  } catch (err) {
    console.error("[radah-pm] read-all error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
