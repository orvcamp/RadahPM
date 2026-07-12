-- ============================================================
-- RADAH PM PLATFORM — Phase 6 Migration: MANGODOE FACILITIES
-- ============================================================
-- Scaffolds the Facilities vertical's schema, per the MangoDoe Enterprise
-- design doc's Section 1 module list. Additive and idempotent — nothing
-- here changes behavior for existing (Construction) orgs.
--
-- Key architectural decision, confirmed against the existing schema before
-- writing this: `projects` is already generic enough (org-scoped, no
-- construction-specific required fields) to double as the Facilities
-- "Property" root entity. So Budget & Cost Control, Documents, and Reports
-- need ZERO schema changes — they're already keyed off project_id, and a
-- Property is a projects row. property_details below is a thin 1:1
-- extension holding only what's actually Facilities-specific.
--
-- New tables:
--   1. property_details — 1:1 extension of a projects row that's being
--      used as a Property (its presence is what distinguishes a Property
--      from a Construction project).
--   2. assets            — equipment registry, scoped to a property.
--   3. work_orders        — request/assign/schedule/complete, optionally
--      tied to a specific asset.
--   4. pm_schedules        — recurring maintenance definitions; a future
--      scheduler job reads these and spawns work_orders when due (that job
--      itself is out of scope for this migration — see notes below).
--   5. vendors              — org-scoped (a vendor can serve more than one
--      property), not property-scoped.
--   6. vendor_contracts    — a vendor's contract for a specific property.
--   7. inspections + inspection_items — checklist-based inspections.
-- ============================================================

-- ---- 1. property_details (1:1 extension of projects) ----
CREATE TABLE IF NOT EXISTS property_details (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  square_footage INTEGER,
  property_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_property_details_updated_at ON property_details;
CREATE TRIGGER trg_property_details_updated_at BEFORE UPDATE ON property_details
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 2. assets ----
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT,
  name TEXT NOT NULL,
  make TEXT,
  model TEXT,
  serial_number TEXT,
  install_date DATE,
  warranty_expires_at DATE,
  location_detail TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'retired')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_deleted ON assets(deleted_at);
CREATE INDEX IF NOT EXISTS idx_assets_warranty ON assets(warranty_expires_at);

DROP TRIGGER IF EXISTS trg_assets_updated_at ON assets;
CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 3. work_orders ----
CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Assignment is either an internal user OR a vendor, never both — the
  -- application layer enforces that, same pattern as work_orders.asset_id
  -- being an optional link.
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_vendor_id UUID,  -- FK added below, once vendors exists
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  cost_cents BIGINT NOT NULL DEFAULT 0,
  pm_schedule_id UUID,  -- set if this work order was auto-generated from a PM schedule; FK added below
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_orders_project ON work_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset ON work_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_deleted ON work_orders(deleted_at);

DROP TRIGGER IF EXISTS trg_work_orders_updated_at ON work_orders;
CREATE TRIGGER trg_work_orders_updated_at BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 4. pm_schedules ----
CREATE TABLE IF NOT EXISTS pm_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,  -- NULL = applies to the property generally, not one asset
  title TEXT NOT NULL,
  description TEXT,
  frequency_type TEXT NOT NULL DEFAULT 'calendar' CHECK (frequency_type IN ('calendar', 'usage')),
  interval_days INTEGER,        -- for frequency_type = 'calendar'
  next_due_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_project ON pm_schedules(project_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_due ON pm_schedules(next_due_date) WHERE is_active AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_pm_schedules_updated_at ON pm_schedules;
CREATE TRIGGER trg_pm_schedules_updated_at BEFORE UPDATE ON pm_schedules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_pm_schedule
  FOREIGN KEY (pm_schedule_id) REFERENCES pm_schedules(id) ON DELETE SET NULL;

-- ---- 5. vendors (org-scoped, not property-scoped) ----
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trade TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  insurance_expires_at DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id);
CREATE INDEX IF NOT EXISTS idx_vendors_deleted ON vendors(deleted_at);
CREATE INDEX IF NOT EXISTS idx_vendors_insurance ON vendors(insurance_expires_at);

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON vendors;
CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_vendor
  FOREIGN KEY (assigned_to_vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;

-- ---- 6. vendor_contracts (a vendor's contract for one property) ----
CREATE TABLE IF NOT EXISTS vendor_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  value_cents BIGINT,
  renewal_reminder_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_contracts_vendor ON vendor_contracts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_contracts_project ON vendor_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_vendor_contracts_end_date ON vendor_contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_vendor_contracts_deleted ON vendor_contracts(deleted_at);

DROP TRIGGER IF EXISTS trg_vendor_contracts_updated_at ON vendor_contracts;
CREATE TRIGGER trg_vendor_contracts_updated_at BEFORE UPDATE ON vendor_contracts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 7. inspections + inspection_items ----
CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inspections_project ON inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_inspections_deleted ON inspections(deleted_at);

DROP TRIGGER IF EXISTS trg_inspections_updated_at ON inspections;
CREATE TRIGGER trg_inspections_updated_at BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS inspection_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  result TEXT CHECK (result IN ('pass', 'fail', 'na')),
  notes TEXT,
  photo_key TEXT,  -- R2 object key, same pattern as project photos elsewhere
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection ON inspection_items(inspection_id);

DROP TRIGGER IF EXISTS trg_inspection_items_updated_at ON inspection_items;
CREATE TRIGGER trg_inspection_items_updated_at BEFORE UPDATE ON inspection_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 8. Facilities' default folder template ----
-- Seeded the same way Construction's was in Phase 5 — a built-in default
-- (org_id IS NULL) for vertical = 'facilities', per Section 2 of the
-- design doc: Warranties, O&M Manuals, Inspection Reports, Compliance
-- Certificates, Floor Plans, Vendor Contracts.
INSERT INTO folder_templates (org_id, vertical, name, template, is_default)
SELECT NULL, 'facilities', 'Standard', $json$
[
  { "name": "01 - Property Records", "children": ["Floor Plans", "Site Surveys", "Ownership & Lease Documents"] },
  { "name": "02 - Warranties & O&M", "children": ["Warranties", "O&M Manuals", "As-Built Record Set"] },
  { "name": "03 - Compliance", "children": ["Inspection Reports", "Compliance Certificates", "Permits"] },
  { "name": "04 - Vendors & Contracts", "children": ["Vendor Contracts", "Certificates of Insurance", "Vendor Directory"] },
  { "name": "05 - Work Orders & Maintenance", "children": ["Work Order History", "Preventive Maintenance Records"] },
  { "name": "06 - Capital Projects", "children": [] }
]
$json$::jsonb, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM folder_templates WHERE org_id IS NULL AND vertical = 'facilities' AND is_default
);
