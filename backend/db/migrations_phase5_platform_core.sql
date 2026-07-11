-- ============================================================
-- RADAH PM PLATFORM — Phase 5 Migration: MULTI-VERTICAL CORE
-- ============================================================
-- Additive and idempotent. Generalizes three pieces of the platform that
-- were hardcoded to the Construction vertical, so the Projects and
-- Facilities verticals (see MangoDoe Enterprise design doc) can be added
-- later as configuration, not a rewrite:
--
--   1. organizations.vertical — which product an org belongs to.
--   2. folder_templates — the Documents folder tree becomes per-org/
--      per-vertical config instead of a hardcoded JS array.
--   3. workflow_statuses — reserved for the future Tasks & Boards module
--      (MangoDoe Projects, build-sequence Phase 3). No route reads this
--      yet; the table exists now so that module doesn't need its own
--      migration later.
--
-- Zero behavior change for existing (Construction) orgs: every existing
-- org defaults to vertical='construction', and the seeded folder_templates
-- row reproduces the exact FOLDER_TEMPLATE array documents.js already used.
-- ============================================================

-- ---- 1. organizations.vertical ----
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'construction';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_vertical_check'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_vertical_check
      CHECK (vertical IN ('construction', 'projects', 'facilities'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_vertical ON organizations(vertical);

-- ---- 2. folder_templates ----
-- org_id IS NULL rows are built-in defaults for a vertical (the platform's
-- own template). org_id set rows are one org's customization, which take
-- priority over the vertical default when resolving which template to
-- apply. is_default marks which row wins when more than one could match.
CREATE TABLE IF NOT EXISTS folder_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  vertical TEXT NOT NULL CHECK (vertical IN ('construction', 'projects', 'facilities')),
  name TEXT NOT NULL DEFAULT 'Standard',
  template JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folder_templates_org ON folder_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_folder_templates_vertical ON folder_templates(vertical);

-- Only one built-in default per vertical (org_id IS NULL), and only one
-- default per org.
CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_templates_vertical_default
  ON folder_templates(vertical) WHERE org_id IS NULL AND is_default;
CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_templates_org_default
  ON folder_templates(org_id) WHERE org_id IS NOT NULL AND is_default;

DROP TRIGGER IF EXISTS trg_folder_templates_updated_at ON folder_templates;
CREATE TRIGGER trg_folder_templates_updated_at BEFORE UPDATE ON folder_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Seed the built-in Construction default — the exact structure documents.js
-- has applied via "Apply Standard Template" all along. This is what every
-- Construction org resolves to until/unless they customize their own.
INSERT INTO folder_templates (org_id, vertical, name, template, is_default)
SELECT NULL, 'construction', 'Standard', $json$
[
  { "name": "00 - Project Management", "children": ["Contacts & Directory", "Meeting Minutes", "Correspondence", "Schedules"] },
  { "name": "01 - Preconstruction & Contracts", "children": ["Contracts & Agreements", "Bonds & Insurance", "Permits & Approvals", "Permit Log", "Proposals & Estimates"] },
  { "name": "02 - Subcontractors", "children": ["Prequalification", "Subcontracts", "Certificates of Insurance", "W-9s & Compliance", "Scopes of Work", "Subcontractor Directory"] },
  { "name": "03 - Procurement", "children": ["Procurement Log", "Long Lead Item Log", "Purchase Orders", "Vendor Quotes", "Material Deliveries"] },
  { "name": "04 - Drawings & Specifications", "children": ["Contract Drawings (For Construction)", "Shop Drawings", "As-Builts", "Specifications", "Superseded"] },
  { "name": "05 - Submittals", "children": [] },
  { "name": "06 - RFIs", "children": [] },
  { "name": "07 - Change Management", "children": ["Change Orders", "Potential Change Orders (PCOs)", "Construction Change Directives", "Change Log"] },
  { "name": "08 - Cost & Billing", "children": ["Budget", "Pay Applications", "Invoices", "Lien Waivers"] },
  { "name": "09 - Field & Logs", "children": ["Daily Logs", "Site Photos", "Delivery Logs", "Visitor Logs", "Equipment Logs", "Weather Logs"] },
  { "name": "10 - Safety", "children": ["Safety Plans", "Incident Reports", "Toolbox Talks & JHAs", "Safety Inspections"] },
  { "name": "11 - Quality (QA-QC)", "children": ["Inspection Reports", "Inspection Log", "Test Reports", "Punch Lists", "Punch List Log", "Deficiency Logs"] },
  { "name": "12 - Logs & Registers", "children": ["Action Log", "Risk Register", "Issue Log", "Decision Log", "Assumption Log", "Constraint Log", "Opportunity Log", "Open Items Log", "Lessons Learned Log", "Stakeholder Log", "Meeting Log", "Correspondence Log"] },
  { "name": "13 - Closeout", "children": ["Warranties", "Warranty Log", "Asset Log", "O&M Manuals", "As-Built Record Set", "Final Certificates & Permits", "Training"] }
]
$json$::jsonb, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM folder_templates WHERE org_id IS NULL AND vertical = 'construction' AND is_default
);

-- ---- 3. workflow_statuses (reserved — no route uses this yet) ----
-- owner_type/owner_id is a polymorphic reference (e.g. owner_type='project',
-- owner_id=<project id>), so this can back board columns for whichever
-- module ends up needing customizable statuses first (Tasks & Boards in
-- MangoDoe Projects is the intended first consumer).
CREATE TABLE IF NOT EXISTS workflow_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL,
  owner_id UUID,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_statuses_owner ON workflow_statuses(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_workflow_statuses_org ON workflow_statuses(org_id);

DROP TRIGGER IF EXISTS trg_workflow_statuses_updated_at ON workflow_statuses;
CREATE TRIGGER trg_workflow_statuses_updated_at BEFORE UPDATE ON workflow_statuses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
