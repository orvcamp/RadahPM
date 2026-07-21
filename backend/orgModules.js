// backend/orgModules.js
//
// Per-organization capability modules ("capabilities as products").
// A row in org_modules exists only to override the default; absence = enabled.
// So new modules are on everywhere until explicitly disabled for an org.
//
// Each module also carries a `verticals` tag — which of the platform's
// products (construction | projects | facilities, per the MangoDoe
// Enterprise design doc) it applies to. A module can list more than one
// vertical if it's a shared engine (Documents, Budget, Reports — see
// Section 0 of the design doc). getOrgModules() below filters to only the
// modules tagged for an org's vertical — a vertical with zero tagged
// modules (there isn't one anymore as of Phase 7, but there was between
// Phase 5 and Phase 7) must resolve to an empty map, not "everything on";
// see the fail-open bug documented in the design doc, Section 7, and the
// corresponding fix in modOn() on the frontend.

const pool = require("./db/pool");

// The toggleable capability modules (core PM — projects/tasks/phases/team —
// is always on and not listed here; Tasks specifically is core PM too,
// not a toggleable module, since it predates the module system and was
// never gated — see the Phase 7 migration notes).
const MODULES = [
  // Shared engines — apply to more than one vertical now that Facilities
  // (Phase 6) and Projects (Phase 7) both exist. Billing/Change
  // Orders/RFIs/Submittals/Daily Logs stay construction-only: Facilities'
  // "Capital Projects" module deliberately reuses those outright rather
  // than needing its own tag — that's an explicit reuse decision, not an
  // automatic one.
  { key: "documents", label: "Documents", verticals: ["construction", "facilities", "projects"] },
  { key: "budget", label: "Budget & Cost", verticals: ["construction", "facilities", "projects"] },
  { key: "reports", label: "Reports", verticals: ["construction", "facilities", "projects"] },
  // Construction-only
  { key: "changeorders", label: "Change Orders", verticals: ["construction", "facilities"] },
  { key: "dailylogs", label: "Daily Logs", verticals: ["construction"] },
  { key: "rfis", label: "RFIs", verticals: ["construction"] },
  { key: "submittals", label: "Submittals", verticals: ["construction"] },
  { key: "logs", label: "Logs & Registers", verticals: ["construction"] },
  { key: "billing", label: "Billing", verticals: ["construction", "facilities"] },
  // Facilities-only (Phase 6)
  { key: "assets", label: "Assets", verticals: ["facilities"] },
  { key: "workorders", label: "Work Orders", verticals: ["facilities"] },
  { key: "pm_scheduling", label: "Preventive Maintenance", verticals: ["facilities"] },
  { key: "vendors", label: "Vendors & Contracts", verticals: ["facilities"] },
  { key: "inspections", label: "Inspections & Compliance", verticals: ["facilities"] },
  { key: "owner_portal", label: "Property Owner Portal", verticals: ["facilities"] },
  { key: "protect", label: "Radah Protect", verticals: ["facilities"] },
  // Projects-only (Phase 7)
  { key: "approvals", label: "Approvals", verticals: ["projects"] },
  { key: "time_tracking", label: "Time Tracking", verticals: ["projects"] },
];
const MODULE_KEYS = MODULES.map((m) => m.key);

// Modules applicable to a given vertical (used to filter what a
// vertical's own admin settings page — or the Platform Console — shows,
// so a future Facilities org never sees Construction-only toggles).
function modulesForVertical(vertical) {
  return MODULES.filter((m) => m.verticals.includes(vertical));
}

// Returns a map { key: boolean } of enabled state for an org (default-on),
// scoped to modules relevant to that org's vertical.
async function getOrgModules(orgId) {
  const applicable = orgId ? await modulesForOrg(orgId) : MODULES;
  const map = {};
  for (const m of applicable) map[m.key] = true; // default enabled
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

// Internal: which of the MODULES entries apply to this org's vertical.
async function modulesForOrg(orgId) {
  const r = await pool.query("SELECT vertical FROM organizations WHERE id = $1", [orgId]);
  const vertical = r.rows[0] ? r.rows[0].vertical : "construction";
  return modulesForVertical(vertical);
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

module.exports = { MODULES, MODULE_KEYS, modulesForVertical, getOrgModules, orgHasModule, requireModule };
