-- ============================================================
-- RADAH PM PLATFORM — Phase 10 Migration: SERVICE REQUEST ATTACHMENTS
-- ============================================================
-- Additive and idempotent. Lets a work order (which is what a portal
-- service request actually is under the hood) have photo/document
-- attachments — reuses the existing R2-backed `documents` table and
-- mirrors the change_order_documents join-table pattern exactly (a work
-- order attachment is also a normal project document, visible in the
-- property's own Documents tab, same as a CO attachment is also a normal
-- project document).
--
-- documents.uploaded_by_portal_account_id is nullable, same shape as
-- documents.uploaded_by (nullable FK to users) — an owner uploading
-- through the portal isn't a `users` row, so this records who uploaded it
-- without touching the existing uploaded_by column's meaning.
-- ============================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS uploaded_by_portal_account_id UUID REFERENCES portal_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS work_order_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_order_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_work_order_documents_wo ON work_order_documents(work_order_id);
