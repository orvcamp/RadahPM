-- ============================================================
-- RADAH PM PLATFORM — Phase 10 Migration: RADAH PROTECT MEMBERSHIPS
-- ============================================================
-- Additive and idempotent. Scaffolds Radah Protect (REOS's recurring-
-- revenue membership program), scoped per decisions made this session:
--
--   - A membership is either PROPERTY-scoped (the default/typical case)
--     or ACCOUNT-scoped (org-wide, for commercial owners leveraging
--     volume across multiple properties under one org). scope_type +
--     scope_id carries this, mirroring the same scoping pattern used by
--     portal_account_access above rather than inventing a new one.
--   - v1 billing_model is 'discount' only: a tier-based discount applied
--     at the point existing billing already calculates charges (i.e.
--     work_orders.cost_cents — there is no separate Facilities invoices
--     table today, so "the discount" is applied against work order cost,
--     not a generated invoice document. Flagging this: if a real
--     invoices/billing-document entity gets built later, the discount
--     application point moves there instead).
--   - billing_model exists as a column (not hardcoded) specifically so
--     real subscription billing can be added later as a second
--     implementation behind the same membership record, per the explicit
--     requirement that the framework support it without restructuring
--     this table.
--   - PM schedules are NOT touched by this migration or by membership at
--     all — decided this session that PM schedules stay set per property
--     regardless of membership scope. Protect is a billing-side concern
--     only.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE protect_scope_type AS ENUM ('property', 'account');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE protect_billing_model AS ENUM ('discount', 'subscription');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE protect_membership_status AS ENUM ('active', 'paused', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- protect_tiers ----
-- Tier definitions are org-scoped (each org sets its own Protect tiers/
-- pricing), not global — matches how vendors and other org-owned
-- catalogs work elsewhere in the platform.
CREATE TABLE IF NOT EXISTS protect_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_protect_tiers_org ON protect_tiers(org_id);
CREATE INDEX IF NOT EXISTS idx_protect_tiers_deleted ON protect_tiers(deleted_at);

DROP TRIGGER IF EXISTS trg_protect_tiers_updated_at ON protect_tiers;
CREATE TRIGGER trg_protect_tiers_updated_at BEFORE UPDATE ON protect_tiers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- protect_memberships ----
-- scope_type = 'property'  -> scope_id references projects(id) (the Property).
-- scope_type = 'account'   -> scope_id references organizations(id).
-- No DB-level FK on scope_id since it points at two different tables
-- depending on scope_type (same reason work_orders.pm_schedule_id was
-- added via a separate ALTER rather than an inline FK to two targets) —
-- application layer enforces the reference matches scope_type.
CREATE TABLE IF NOT EXISTS protect_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type protect_scope_type NOT NULL DEFAULT 'property',
  scope_id UUID NOT NULL,
  tier_id UUID REFERENCES protect_tiers(id) ON DELETE SET NULL,
  billing_model protect_billing_model NOT NULL DEFAULT 'discount',
  status protect_membership_status NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_protect_memberships_org ON protect_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_protect_memberships_scope ON protect_memberships(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_protect_memberships_status ON protect_memberships(status);
CREATE INDEX IF NOT EXISTS idx_protect_memberships_deleted ON protect_memberships(deleted_at);

DROP TRIGGER IF EXISTS trg_protect_memberships_updated_at ON protect_memberships;
CREATE TRIGGER trg_protect_memberships_updated_at BEFORE UPDATE ON protect_memberships
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
