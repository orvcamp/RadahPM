-- ============================================================
-- RADAH PM PLATFORM — Phase 8 Migration: DURABLE AUDIT TRAIL
-- ============================================================
-- Additive and safe to re-run. Replaces the "greppable in Railway
-- logs" console.log-only audit trail (see comment in platform.js)
-- with a real, queryable table. Existing console.log AUDIT lines
-- are left in place alongside this — cheap, still useful for
-- real-time log tailing.
--
-- actor_id / target_user_id use ON DELETE SET NULL so the audit
-- record survives even if the user is later removed/deleted.

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_org ON audit_log(target_org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);