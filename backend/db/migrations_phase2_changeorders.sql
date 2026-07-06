-- ============================================================
-- RADAH PM PLATFORM — Phase 2 (Tier 2) Migration: CHANGE ORDERS
-- ============================================================
-- Additive and safe to re-run. Guards: IF NOT EXISTS + idempotent
-- DO block for the enum + DROP/CREATE for the trigger. Never alters
-- or drops earlier tables.
--
-- Workflow: draft -> submitted -> approved / rejected.
-- On approval a CO creates a budget line in its target category (the
-- link is stored in budget_line_id) so the cost impact flows into the
-- Budget rollup. Cost impact may be negative (a credit).
-- ============================================================

DO $$ BEGIN
  CREATE TYPE change_order_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS change_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  co_number INTEGER NOT NULL,                 -- sequential per project (CO #1, #2, ...)
  title TEXT NOT NULL,
  description TEXT,
  cost_impact_cents BIGINT NOT NULL DEFAULT 0, -- may be negative (credit)
  -- Target category for the budget line created on approval. Required by the
  -- API at creation; kept nullable so a deleted category doesn't break the row.
  category_id UUID REFERENCES budget_categories(id) ON DELETE SET NULL,
  status change_order_status NOT NULL DEFAULT 'draft',
  -- The budget line this CO created on approval (kept, not deleted, on revert).
  budget_line_id UUID REFERENCES budget_lines(id) ON DELETE SET NULL,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, co_number)
);

CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_status ON change_orders(status);

DROP TRIGGER IF EXISTS trg_change_orders_updated_at ON change_orders;
CREATE TRIGGER trg_change_orders_updated_at BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
