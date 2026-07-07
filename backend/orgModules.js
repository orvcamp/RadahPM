// backend/orgModules.js
//
// Per-organization capability modules ("capabilities as products").
// A row in org_modules exists only to override the default; absence = enabled.
// So new modules are on everywhere until explicitly disabled for an org.

const pool = require("./db/pool");

// The toggleable capability modules (core PM — projects/tasks/phases/team —
// is always on and not listed here).
const MODULES = [
  { key: "documents", label: "Documents" },
  { key: "budget", label: "Budget & Cost" },
  { key: "changeorders", label: "Change Orders" },
  { key: "dailylogs", label: "Daily Logs" },
];
const MODULE_KEYS = MODULES.map((m) => m.key);

// Returns a map { key: boolean } of enabled state for an org (default-on).
async function getOrgModules(orgId) {
  const map = {};
  for (const k of MODULE_KEYS) map[k] = true; // default enabled
  if (!orgId) return map;
  const r = await pool.query(
    "SELECT module_key, enabled FROM org_modules WHERE org_id = $1",
    [orgId]
  );
  for (const row of r.rows) {
    if (Object.prototype.hasOwnProperty.call(map, row.module_key)) {
      map[row.module_key] = row.enabled;
    }
  }
  return map;
}

// True unless an explicit row disables the module for the org.
async function orgHasModule(orgId, key) {
  if (!orgId) return false;
  const r = await pool.query(
    "SELECT enabled FROM org_modules WHERE org_id = $1 AND module_key = $2",
    [orgId, key]
  );
  if (r.rows.length === 0) return true; // default-on
  return r.rows[0].enabled === true;
}

// Express guard: blocks a route if the caller's org has the module disabled.
function requireModule(key) {
  return async (req, res, next) => {
    try {
      if (await orgHasModule(req.user && req.user.orgId, key)) return next();
      return res.status(403).json({ error: "This feature isn't enabled for your organization." });
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { MODULES, MODULE_KEYS, getOrgModules, orgHasModule, requireModule };
