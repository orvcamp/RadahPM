// backend/folderTemplates.js
//
// The Documents folder tree used to be a single hardcoded JS array
// (FOLDER_TEMPLATE in routes/documents.js), specific to Construction.
// This generalizes it into per-vertical defaults plus optional per-org
// customization, stored in the folder_templates table — so the Projects
// and Facilities verticals can ship their own default trees later without
// touching this resolution logic, and any org can customize its own tree
// today without a code change.
//
// Resolution order for "what folder tree does this org get":
//   1. This org's own customized template (folder_templates.org_id = org).
//   2. The built-in default for the org's vertical (org_id IS NULL).
//   3. A hardcoded in-code fallback (belt-and-suspenders — only reachable
//      if the Phase 5 migration hasn't run yet against this database).

const pool = require("./db/pool");

// Last-resort fallback, identical to the Construction seed in
// migrations_phase5_platform_core.sql. Only used if that row is somehow
// missing (e.g. a fresh DB the migration hasn't been run against yet).
const FALLBACK_CONSTRUCTION_TEMPLATE = [
  { name: "00 - Project Management", children: ["Contacts & Directory", "Meeting Minutes", "Correspondence", "Schedules"] },
  { name: "01 - Preconstruction & Contracts", children: ["Contracts & Agreements", "Bonds & Insurance", "Permits & Approvals", "Permit Log", "Proposals & Estimates"] },
  { name: "02 - Subcontractors", children: ["Prequalification", "Subcontracts", "Certificates of Insurance", "W-9s & Compliance", "Scopes of Work", "Subcontractor Directory"] },
  { name: "03 - Procurement", children: ["Procurement Log", "Long Lead Item Log", "Purchase Orders", "Vendor Quotes", "Material Deliveries"] },
  { name: "04 - Drawings & Specifications", children: ["Contract Drawings (For Construction)", "Shop Drawings", "As-Builts", "Specifications", "Superseded"] },
  { name: "05 - Submittals", children: [] },
  { name: "06 - RFIs", children: [] },
  { name: "07 - Change Management", children: ["Change Orders", "Potential Change Orders (PCOs)", "Construction Change Directives", "Change Log"] },
  { name: "08 - Cost & Billing", children: ["Budget", "Pay Applications", "Invoices", "Lien Waivers"] },
  { name: "09 - Field & Logs", children: ["Daily Logs", "Site Photos", "Delivery Logs", "Visitor Logs", "Equipment Logs", "Weather Logs"] },
  { name: "10 - Safety", children: ["Safety Plans", "Incident Reports", "Toolbox Talks & JHAs", "Safety Inspections"] },
  { name: "11 - Quality (QA-QC)", children: ["Inspection Reports", "Inspection Log", "Test Reports", "Punch Lists", "Punch List Log", "Deficiency Logs"] },
  { name: "12 - Logs & Registers", children: ["Action Log", "Risk Register", "Issue Log", "Decision Log", "Assumption Log", "Constraint Log", "Opportunity Log", "Open Items Log", "Lessons Learned Log", "Stakeholder Log", "Meeting Log", "Correspondence Log"] },
  { name: "13 - Closeout", children: ["Warranties", "Warranty Log", "Asset Log", "O&M Manuals", "As-Built Record Set", "Final Certificates & Permits", "Training"] },
];

const FALLBACK_BY_VERTICAL = {
  construction: FALLBACK_CONSTRUCTION_TEMPLATE,
  // projects / facilities verticals will add their own default templates
  // (as a seeded folder_templates row, same pattern as Construction's)
  // when those verticals are built. Until then, an org on one of those
  // verticals falls back to the Construction tree rather than erroring.
};

// Returns { template, source, name } where source is "org" | "vertical" | "fallback".
async function resolveFolderTemplate(orgId) {
  const orgRes = await pool.query("SELECT vertical FROM organizations WHERE id = $1", [orgId]);
  const vertical = orgRes.rows[0] ? orgRes.rows[0].vertical : "construction";

  const orgRow = await pool.query(
    "SELECT name, template FROM folder_templates WHERE org_id = $1 AND is_default LIMIT 1",
    [orgId]
  );
  if (orgRow.rows[0]) {
    return { template: orgRow.rows[0].template, source: "org", name: orgRow.rows[0].name };
  }

  const verticalRow = await pool.query(
    "SELECT name, template FROM folder_templates WHERE org_id IS NULL AND vertical = $1 AND is_default LIMIT 1",
    [vertical]
  );
  if (verticalRow.rows[0]) {
    return { template: verticalRow.rows[0].template, source: "vertical", name: verticalRow.rows[0].name };
  }

  return { template: FALLBACK_BY_VERTICAL[vertical] || FALLBACK_CONSTRUCTION_TEMPLATE, source: "fallback", name: "Standard" };
}

// Fetch this org's own customized template row, if any (null if the org
// just uses its vertical's default).
async function getOrgTemplateRow(orgId) {
  const r = await pool.query(
    "SELECT id, name, template, updated_at FROM folder_templates WHERE org_id = $1 AND is_default LIMIT 1",
    [orgId]
  );
  return r.rows[0] || null;
}

// Create or replace this org's customized template (admin-only at the
// route level). Validates minimal shape: an array of { name, children[] }.
async function upsertOrgTemplate(orgId, userId, { name, template }) {
  if (!Array.isArray(template) || template.length === 0) {
    throw Object.assign(new Error("Template must be a non-empty list of folders."), { status: 400 });
  }
  for (const folder of template) {
    if (!folder || typeof folder.name !== "string" || !folder.name.trim()) {
      throw Object.assign(new Error("Every top-level folder needs a name."), { status: 400 });
    }
    if (folder.children !== undefined && !Array.isArray(folder.children)) {
      throw Object.assign(new Error("A folder's children must be a list."), { status: 400 });
    }
    for (const child of folder.children || []) {
      if (typeof child !== "string" || !child.trim()) {
        throw Object.assign(new Error("Every child folder name must be non-empty text."), { status: 400 });
      }
    }
  }

  const orgRes = await pool.query("SELECT vertical FROM organizations WHERE id = $1", [orgId]);
  if (!orgRes.rows[0]) throw Object.assign(new Error("Organization not found."), { status: 404 });
  const vertical = orgRes.rows[0].vertical;

  const existing = await pool.query("SELECT id FROM folder_templates WHERE org_id = $1 AND is_default LIMIT 1", [orgId]);
  if (existing.rows[0]) {
    const r = await pool.query(
      "UPDATE folder_templates SET name = $1, template = $2 WHERE id = $3 RETURNING id, name, template, updated_at",
      [name && name.trim() ? name.trim() : "Custom", JSON.stringify(template), existing.rows[0].id]
    );
    return r.rows[0];
  }
  const r = await pool.query(
    `INSERT INTO folder_templates (org_id, vertical, name, template, is_default, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id, name, template, updated_at`,
    [orgId, vertical, name && name.trim() ? name.trim() : "Custom", JSON.stringify(template), userId]
  );
  return r.rows[0];
}

// Reset an org back to its vertical's built-in default (deletes the org's
// customization row, if any).
async function resetOrgTemplate(orgId) {
  await pool.query("DELETE FROM folder_templates WHERE org_id = $1 AND is_default", [orgId]);
}

module.exports = { resolveFolderTemplate, getOrgTemplateRow, upsertOrgTemplate, resetOrgTemplate };
