-- ============================================================
-- RADAH PM PLATFORM — Migration: SUBMITTALS
-- ============================================================
-- Additive, idempotent. Workflow: draft -> submitted -> under_review ->
-- returned (with a disposition). Revisions reuse the submittal number with
-- an incremented revision and link to the prior round. Attachments reuse the
-- documents table via submittal_documents.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE submittal_status AS ENUM ('draft', 'submitted', 'under_review', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE submittal_disposition AS ENUM ('approved', 'approved_as_noted', 'revise_resubmit', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS submittals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submittal_number INTEGER NOT NULL,           -- per-project package number
  revision INTEGER NOT NULL DEFAULT 0,         -- 0, 1, 2 ... resubmission round
  previous_submittal_id UUID REFERENCES submittals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  spec_section TEXT,
  description TEXT,
  status submittal_status NOT NULL DEFAULT 'draft',
  disposition submittal_disposition,           -- set when returned
  due_date DATE,
  ball_in_court UUID REFERENCES users(id) ON DELETE SET NULL,  -- who it's with now
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, submittal_number, revision)
);

CREATE INDEX IF NOT EXISTS idx_submittals_project ON submittals(project_id);
CREATE INDEX IF NOT EXISTS idx_submittals_status ON submittals(status);

CREATE TABLE IF NOT EXISTS submittal_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submittal_id UUID NOT NULL REFERENCES submittals(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(submittal_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_submittal_documents_sub ON submittal_documents(submittal_id);

DROP TRIGGER IF EXISTS trg_submittals_updated_at ON submittals;
CREATE TRIGGER trg_submittals_updated_at BEFORE UPDATE ON submittals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
