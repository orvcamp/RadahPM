-- ============================================================
-- RADAH PM PLATFORM — Phase 3 Migration: ORG MODULES (capability seam)
-- ============================================================
-- Additive, idempotent. Lets the platform enable/disable capability modules
-- per organization (the "capabilities as products" model).
--
-- Design: a row exists only to OVERRIDE the default. Absence of a row means
-- the module is ENABLED. So new modules are on everywhere by default, and
-- disabling is an explicit opt-out. No backfill needed.
-- ============================================================

CREATE TABLE IF NOT EXISTS org_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_org_modules_org ON org_modules(org_id);

DROP TRIGGER IF EXISTS trg_org_modules_updated_at ON org_modules;
CREATE TRIGGER trg_org_modules_updated_at BEFORE UPDATE ON org_modules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
