-- ============================================================
-- RADAH PM PLATFORM — Migration: SCHEDULE ACTIVITIES
-- ============================================================
-- Additive, idempotent. Holds activities imported from a scheduling tool
-- (MS Project XML, or a CSV/XLSX export). This is a READ-ONLY MIRROR of the
-- schedule — MangoDoe does not calculate a critical path. Re-importing
-- replaces the activity set, because a schedule update is a re-baseline, not
-- an append.
-- ============================================================

CREATE TABLE IF NOT EXISTS schedule_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id TEXT,                 -- UID/ID from the source tool
  wbs TEXT,
  name TEXT NOT NULL,
  start_date DATE,
  finish_date DATE,
  duration_days NUMERIC(10,2),
  percent_complete INTEGER NOT NULL DEFAULT 0,
  is_milestone BOOLEAN NOT NULL DEFAULT FALSE,
  is_summary BOOLEAN NOT NULL DEFAULT FALSE,
  outline_level INTEGER,
  predecessors TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_activities_project ON schedule_activities(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_activities_dates ON schedule_activities(project_id, start_date, finish_date);
