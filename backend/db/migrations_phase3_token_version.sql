-- ============================================================
-- RADAH PM PLATFORM — Migration: TOKEN VERSION (session revocation)
-- ============================================================
-- Additive, idempotent. Lets us invalidate a user's existing JWTs without
-- waiting for them to expire. Bumping token_version immediately logs the
-- user out everywhere (used on password change, password reset, and
-- account deactivation).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
