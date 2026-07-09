-- ============================================================
-- RADAH PM PLATFORM — Migration: BILLING PDF FILING
-- ============================================================
-- Additive, idempotent. Links a pay application to the Documents record of
-- its most recently generated PDF, so re-exporting replaces (soft-deletes)
-- the stale filed copy instead of piling up duplicates in the Documents tab.
-- ============================================================

ALTER TABLE pay_applications
  ADD COLUMN IF NOT EXISTS pdf_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;
