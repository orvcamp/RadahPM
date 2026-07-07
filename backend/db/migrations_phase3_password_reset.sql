-- ============================================================
-- RADAH PM PLATFORM — Migration: PASSWORD RESET TOKENS
-- ============================================================
-- Additive, idempotent. Backs the self-service "forgot password" flow.
-- Only a HASH of each token is stored (never the token itself); tokens are
-- single-use and time-limited.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
