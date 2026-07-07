-- ============================================================
-- RADAH PM PLATFORM — Migration: PROJECT STAGE (lifecycle tracker)
-- ============================================================
-- Additive, idempotent. A single current lifecycle stage per project,
-- separate from the simple project status. Advanced like a stepper.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'lead';
