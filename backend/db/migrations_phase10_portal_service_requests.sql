-- ============================================================
-- RADAH PM PLATFORM — Phase 10 Migration: PORTAL SERVICE REQUESTS
-- ============================================================
-- Additive and idempotent. A property owner submitting a service request
-- through the portal creates a normal work_orders row (no new entity —
-- same reasoning as Phase 6's decision to reuse `projects` as Property).
-- This just adds a nullable trace column so a work order can record it
-- came from a portal login rather than an internal user, mirroring how
-- assigned_to_vendor_id sits alongside assigned_to_user_id.
-- ============================================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS requested_by_portal_account_id UUID REFERENCES portal_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_requested_by_portal
  ON work_orders(requested_by_portal_account_id);
