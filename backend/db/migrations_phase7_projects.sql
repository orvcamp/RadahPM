-- ============================================================
-- RADAH PM PLATFORM — Phase 7 Migration: MANGODOE PROJECTS
-- ============================================================
-- Scaffolds what's actually missing for the Projects vertical, per Section
-- 1 of the MangoDoe Enterprise design doc. Turns out most of "Tasks &
-- Boards" already existed before this migration: tasks, task_dependencies,
-- and task_comments were already built (originally for Construction's
-- Gantt/schedule view), are fully generic (project-scoped, no
-- construction-specific fields), and were never gated behind a module flag
-- — they're core PM, always-on for every org. task_dependencies existed
-- with zero REST routes exposing it; that's fixed in routes/tasks.js
-- alongside this migration, not here.
--
-- What's genuinely new:
--   1. time_entries    — logged hours per task/user/project, billable flag.
--   2. approval_requests — a generic request/approve/reject/comment object,
--      explicitly modeled on the same state-machine shape as Change
--      Orders (design doc: "approval_requests is structurally the same
--      object as a Change Order... the state-machine and rollup code you
--      already have for those doesn't need to be reinvented" — this
--      migration reuses that shape, not that code, since Change Orders'
--      logic is construction-specific (budget impact); Approvals here is
--      deliberately generic and does not touch Budget & Cost Control.
--   3. Projects vertical's default folder template — same seeding pattern
--      as Construction (Phase 5) and Facilities (Phase 6).
--
-- Additive and idempotent. Zero behavior change for existing orgs.
-- ============================================================

-- ---- 1. time_entries ----
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  billable BOOLEAN NOT NULL DEFAULT TRUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_deleted ON time_entries(deleted_at);

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries;
CREATE TRIGGER trg_time_entries_updated_at BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 2. approval_requests ----
-- linked_object_type/linked_object_id is a polymorphic reference (e.g. a
-- task, a document, a budget line) — this table doesn't know or care what
-- it's approving, same as it doesn't touch Budget & Cost Control directly.
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  linked_object_type TEXT,
  linked_object_id UUID,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_project ON approval_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_approver ON approval_requests(approver_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_linked ON approval_requests(linked_object_type, linked_object_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_deleted ON approval_requests(deleted_at);

DROP TRIGGER IF EXISTS trg_approval_requests_updated_at ON approval_requests;
CREATE TRIGGER trg_approval_requests_updated_at BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- 3. Projects vertical's default folder template ----
-- Per design doc Section 1: Planning, Contracts, Deliverables, Meeting
-- Notes, Reports, Archive.
INSERT INTO folder_templates (org_id, vertical, name, template, is_default)
SELECT NULL, 'projects', 'Standard', $json$
[
  { "name": "01 - Planning", "children": ["Project Brief", "Scope & Requirements", "Timeline"] },
  { "name": "02 - Contracts", "children": ["Signed Agreements", "SOWs", "Amendments"] },
  { "name": "03 - Deliverables", "children": ["Drafts", "Final Deliverables", "Client Feedback"] },
  { "name": "04 - Meeting Notes", "children": [] },
  { "name": "05 - Reports", "children": ["Status Reports", "Time & Utilization"] },
  { "name": "06 - Archive", "children": [] }
]
$json$::jsonb, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM folder_templates WHERE org_id IS NULL AND vertical = 'projects' AND is_default
);
