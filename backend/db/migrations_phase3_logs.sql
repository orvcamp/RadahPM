-- ============================================================
-- RADAH PM PLATFORM — Migration: PROJECT LOGS (generic registers)
-- ============================================================
-- Additive, idempotent. One table backs nine PM registers that share the same
-- shape: Action, Issue, Decision, Risk, Assumption, Constraint, Opportunity,
-- Open Items, and Lessons Learned. Entries are numbered per project per type.
-- Soft-deleted like the other modules, so they land in Deleted Items.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE project_log_status AS ENUM ('open', 'in_progress', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_log_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS project_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL,                    -- action | issue | decision | risk | ...
  entry_number INTEGER NOT NULL,             -- sequential per project per type
  title TEXT NOT NULL,
  description TEXT,
  status project_log_status NOT NULL DEFAULT 'open',
  priority project_log_priority NOT NULL DEFAULT 'medium',
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  -- Risk / Opportunity only
  likelihood TEXT,
  impact TEXT,
  -- Free-form grouping (e.g. Lessons Learned category, discipline)
  category TEXT,
  -- Outcome: resolution, decision rationale, mitigation
  resolution TEXT,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(project_id, log_type, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_project_logs_project_type ON project_logs(project_id, log_type);
CREATE INDEX IF NOT EXISTS idx_project_logs_status ON project_logs(status);
CREATE INDEX IF NOT EXISTS idx_project_logs_deleted ON project_logs(deleted_at);

DROP TRIGGER IF EXISTS trg_project_logs_updated_at ON project_logs;
CREATE TRIGGER trg_project_logs_updated_at BEFORE UPDATE ON project_logs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
