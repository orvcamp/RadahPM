-- ============================================================
-- RADAH PM PLATFORM — Migration: CHANGE ORDER ATTACHMENTS
-- ============================================================
-- Additive, re-runnable. Links change orders to documents (supporting
-- files), reusing the R2-backed documents table. A CO attachment is also
-- a normal project document (visible in the Documents tab).
-- ============================================================

CREATE TABLE IF NOT EXISTS change_order_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  change_order_id UUID NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(change_order_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_change_order_documents_co ON change_order_documents(change_order_id);
