// backend/routes/mymodules.js
//
// Lets the frontend know which capability modules are enabled for the
// current user's organization, so it can show/hide the matching project tabs.

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getOrgModules } = require("../orgModules");

const router = express.Router();

// GET /api/my-modules  → { modules: { documents: true, budget: true, ... } }
router.get("/my-modules", requireAuth, async (req, res) => {
  try {
    const modules = await getOrgModules(req.user && req.user.orgId);
    res.json({ modules });
  } catch (err) {
    console.error("[radah-pm] my-modules error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
