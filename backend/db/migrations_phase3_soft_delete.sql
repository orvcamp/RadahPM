-- ============================================================
-- RADAH PM PLATFORM — Migration: SOFT DELETE (recoverable records)
-- ============================================================
-- Additive, idempotent. Destructive deletes become recoverable: a record is
-- flagged deleted and hidden from lists, but retained (and for documents, the
-- stored file is retained too). An admin can restore it, or permanently purge
-- it from the project's Deleted Items view.
-- ============================================================

ALTER TABLE documents      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents      ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE daily_logs     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE daily_logs     ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE rfis           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE rfis           ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE submittals     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE submittals     ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE change_orders  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE change_orders  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_deleted     ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_daily_logs_deleted    ON daily_logs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_rfis_deleted          ON rfis(deleted_at);
CREATE INDEX IF NOT EXISTS idx_submittals_deleted    ON submittals(deleted_at);
CREATE INDEX IF NOT EXISTS idx_change_orders_deleted ON change_orders(deleted_at);
