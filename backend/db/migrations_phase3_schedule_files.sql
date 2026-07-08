-- ============================================================
-- RADAH PM PLATFORM — Migration: PROJECT SCHEDULE FILES
-- ============================================================
-- Additive, idempotent. Stores the project's schedule as uploaded files with
-- revision history (P6/MS Project exports, PDFs, etc.). The highest revision
-- is the "current" schedule. Files reuse the documents/R2 pipeline.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  notes TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_project_schedules_project ON project_schedules(project_id);
