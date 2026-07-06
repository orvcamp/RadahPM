-- ============================================================
-- RADAH PM PLATFORM — Phase 2 Migration: BUDGETS & COST TRACKING
-- ============================================================
-- Additive and safe to re-run. Every statement is guarded with
-- IF NOT EXISTS (or an idempotent DO block for the enum / triggers),
-- so running this repeatedly on an already-migrated database does
-- nothing and never alters or drops Phase 1 / Documents tables.
--
-- Cost model (standard construction cost-control layout):
--   budget_categories  — per-project cost categories (Labor, Materials, ...)
--   budget_lines       — the PLAN: a budgeted amount per line, in a category
--   budget_commitments — POs / subcontracts: money obligated (committed)
--   budget_expenses    — ACTUALS: costs incurred, each tied to a line
--
-- Rollup per line = Budgeted / Committed (open) / Actual / Remaining,
--   Remaining = budgeted - committed - actual.
--
-- All money is stored as INTEGER CENTS (BIGINT) to avoid floating-point
-- rounding errors; the UI converts to/from dollars.
-- ============================================================

-- ---------- Enum: commitment status ----------
DO $$ BEGIN
  CREATE TYPE commitment_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Categories ----------
CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_budget_categories_project ON budget_categories(project_id);

-- ---------- Budget lines (the plan) ----------
CREATE TABLE IF NOT EXISTS budget_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- If a category is deleted the line is kept but becomes uncategorized.
  -- (The API additionally blocks deleting a category that still has lines.)
  category_id UUID REFERENCES budget_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  budgeted_amount_cents BIGINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_project ON budget_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_category ON budget_lines(category_id);

-- ---------- Commitments (POs / subcontracts) ----------
CREATE TABLE IF NOT EXISTS budget_commitments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Deleting a line keeps its commitments (they become line-less), so no
  -- cost history is lost when the plan is reorganized.
  budget_line_id UUID REFERENCES budget_lines(id) ON DELETE SET NULL,
  vendor_name TEXT,
  description TEXT,
  committed_amount_cents BIGINT NOT NULL DEFAULT 0,
  status commitment_status NOT NULL DEFAULT 'open',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_commitments_project ON budget_commitments(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_commitments_line ON budget_commitments(budget_line_id);

-- ---------- Expenses (actuals) ----------
CREATE TABLE IF NOT EXISTS budget_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Required at creation time (enforced in the API). Kept (set null) if the
  -- line is later deleted, preserving cost history.
  budget_line_id UUID REFERENCES budget_lines(id) ON DELETE SET NULL,
  -- Optional link to a commitment this expense draws down (e.g. invoice vs PO).
  commitment_id UUID REFERENCES budget_commitments(id) ON DELETE SET NULL,
  vendor_name TEXT,
  description TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  expense_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_expenses_project ON budget_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_line ON budget_expenses(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_commitment ON budget_expenses(commitment_id);

-- ---------- updated_at auto-touch triggers ----------
-- Reuses the touch_updated_at() function defined in schema.sql.
-- DROP + CREATE keeps this idempotent on re-run.
DROP TRIGGER IF EXISTS trg_budget_lines_updated_at ON budget_lines;
CREATE TRIGGER trg_budget_lines_updated_at BEFORE UPDATE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_commitments_updated_at ON budget_commitments;
CREATE TRIGGER trg_budget_commitments_updated_at BEFORE UPDATE ON budget_commitments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_expenses_updated_at ON budget_expenses;
CREATE TRIGGER trg_budget_expenses_updated_at BEFORE UPDATE ON budget_expenses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
