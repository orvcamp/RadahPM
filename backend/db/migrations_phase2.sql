-- ============================================================
-- RADAH PM PLATFORM — Phase 2 Migration: DOCUMENTS
-- ============================================================
-- This file is additive. It is safe to run repeatedly: every
-- statement uses IF NOT EXISTS so re-running on an already-migrated
-- database does nothing. It never alters or drops Phase 1 tables.
--
-- Files themselves live in Cloudflare R2 (object storage). This table
-- only stores metadata + the R2 object key, never the file bytes.
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The key (path) of the object inside the R2 bucket, e.g.
  -- "projects/<projectId>/<uuid>-original-filename.pdf"
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,           -- original filename as uploaded
  content_type TEXT,                 -- MIME type, e.g. application/pdf
  size_bytes BIGINT,                 -- file size
  description TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
