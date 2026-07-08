-- ============================================================
-- RADAH PM PLATFORM — Migration: ESTIMATE FIELDS ON BUDGET LINES
-- ============================================================
-- Additive, idempotent. Real estimate spreadsheets carry a cost code and a
-- quantity / unit / unit-cost breakdown behind each total. Holding them keeps
-- the import faithful and leaves room for unit-cost reporting later.
-- All nullable: lines created by hand are unaffected.
-- ============================================================

ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS cost_code       TEXT;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS quantity        NUMERIC(16,4);
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS unit            TEXT;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS unit_cost_cents BIGINT;

CREATE INDEX IF NOT EXISTS idx_budget_lines_cost_code ON budget_lines(cost_code);
