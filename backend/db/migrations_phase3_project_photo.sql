-- ============================================================
-- RADAH PM PLATFORM — Migration: PROJECT PHOTO
-- ============================================================
-- Additive, idempotent. Stores an optional cover photo per project (the R2
-- storage key). Absence = show a generated placeholder in the UI.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS photo_key TEXT;
