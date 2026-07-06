-- ============================================================
-- RADAH PM PLATFORM — Migration: DOCUMENT FOLDERS (nested)
-- ============================================================
-- Additive, re-runnable. Adds nestable folders to the Documents module.
-- Documents gain an optional folder_id (NULL = project root). Folder
-- deletion is handled in the API by re-parenting contents up one level,
-- so no files are ever lost; the FKs below use CASCADE/SET NULL only as a
-- backstop (e.g. when the whole project is deleted).
-- ============================================================

CREATE TABLE IF NOT EXISTS document_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_folder_id UUID REFERENCES document_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_folders_project ON document_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_folder_id);

-- Add folder_id to documents (NULL = project root).
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES document_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);

DROP TRIGGER IF EXISTS trg_document_folders_updated_at ON document_folders;
CREATE TRIGGER trg_document_folders_updated_at BEFORE UPDATE ON document_folders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
