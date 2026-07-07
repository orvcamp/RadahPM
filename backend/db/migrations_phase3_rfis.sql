-- ============================================================
-- RADAH PM PLATFORM — Migration: RFIs (Requests For Information)
-- ============================================================
-- Additive, idempotent. Workflow: open -> answered -> closed (reopen allowed).
-- Attachments reuse the documents table via rfi_documents.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE rfi_status AS ENUM ('open', 'answered', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rfis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfi_number INTEGER NOT NULL,                 -- sequential per project
  subject TEXT NOT NULL,
  question TEXT,
  status rfi_status NOT NULL DEFAULT 'open',
  due_date DATE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,   -- who should answer
  answer TEXT,
  answered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, rfi_number)
);

CREATE INDEX IF NOT EXISTS idx_rfis_project ON rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_rfis_status ON rfis(status);

CREATE TABLE IF NOT EXISTS rfi_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfi_id UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rfi_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_rfi_documents_rfi ON rfi_documents(rfi_id);

DROP TRIGGER IF EXISTS trg_rfis_updated_at ON rfis;
CREATE TRIGGER trg_rfis_updated_at BEFORE UPDATE ON rfis
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
