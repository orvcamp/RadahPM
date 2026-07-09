-- ============================================================
-- RADAH PM PLATFORM — Migration: BILLING (Pay Applications)
-- ============================================================
-- Additive, idempotent. AIA G702/G703-style pay applications.
--
-- Design: the "Schedule of Values" is not a separate table — each pay
-- application item snapshots its scheduled value from an existing
-- budget_line at creation time (budget lines already include approved
-- change order impact, per the Budget/Change Orders integration). Snapshot,
-- not a live reference, because a contract sum line shouldn't drift on a
-- historical pay app if the budget is edited later.
--
-- Workflow: draft -> submitted -> approved / rejected. approved -> paid.
-- approved -> submitted (revert) to correct a mistake before payment.
--
-- Carry-forward: a new pay app's item.previous_completed_cents is seeded
-- from the most recent APPROVED or PAID app's matching item total
-- (previous + this period + stored), standard G703 practice.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE pay_app_status AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lien_waiver_type AS ENUM (
    'conditional_progress', 'unconditional_progress',
    'conditional_final', 'unconditional_final'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lien_waiver_status AS ENUM ('pending', 'received');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS pay_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  application_number INTEGER NOT NULL,          -- sequential per project (Pay App #1, #2, ...)
  period_start DATE,
  period_end DATE,
  retention_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,  -- applied uniformly across this app's items
  status pay_app_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(project_id, application_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_applications_project ON pay_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_pay_applications_status ON pay_applications(status);
CREATE INDEX IF NOT EXISTS idx_pay_applications_deleted ON pay_applications(deleted_at);

CREATE TABLE IF NOT EXISTS pay_application_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pay_application_id UUID NOT NULL REFERENCES pay_applications(id) ON DELETE CASCADE,
  -- Kept (set null) if the budget line is later deleted, preserving billing history.
  budget_line_id UUID REFERENCES budget_lines(id) ON DELETE SET NULL,
  description TEXT NOT NULL,                    -- snapshot of the line's description at creation
  scheduled_value_cents BIGINT NOT NULL DEFAULT 0,  -- snapshot of the budget line's budgeted amount
  previous_completed_cents BIGINT NOT NULL DEFAULT 0,  -- carried forward from the prior approved/paid app
  this_period_cents BIGINT NOT NULL DEFAULT 0,
  materials_stored_cents BIGINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_app_items_app ON pay_application_items(pay_application_id);
CREATE INDEX IF NOT EXISTS idx_pay_app_items_line ON pay_application_items(budget_line_id);

CREATE TABLE IF NOT EXISTS lien_waivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pay_application_id UUID NOT NULL REFERENCES pay_applications(id) ON DELETE CASCADE,
  waiver_type lien_waiver_type NOT NULL,
  vendor_name TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  status lien_waiver_status NOT NULL DEFAULT 'pending',
  -- One signed document per waiver. Kept (set null) if the document is deleted.
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lien_waivers_app ON lien_waivers(pay_application_id);

-- ---------- updated_at auto-touch triggers ----------
DROP TRIGGER IF EXISTS trg_pay_applications_updated_at ON pay_applications;
CREATE TRIGGER trg_pay_applications_updated_at BEFORE UPDATE ON pay_applications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_pay_application_items_updated_at ON pay_application_items;
CREATE TRIGGER trg_pay_application_items_updated_at BEFORE UPDATE ON pay_application_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_lien_waivers_updated_at ON lien_waivers;
CREATE TRIGGER trg_lien_waivers_updated_at BEFORE UPDATE ON lien_waivers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
