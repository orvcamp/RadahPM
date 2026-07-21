-- ============================================================
-- RADAH PM PLATFORM — Phase 10 Migration: PROPERTY OWNER PORTAL ACCOUNTS
-- ============================================================
-- Additive and idempotent. Scaffolds a standalone identity for the
-- Property Owner Portal — one login, not tied to a single org.
--
-- Key architectural decision, confirmed against the existing schema
-- before writing this: users.email is already GLOBALLY unique (not
-- per-org), and users.org_id is NOT NULL — so one person cannot hold
-- two `users` rows for two different orgs today. That's exactly the
-- constraint that made a portal owner's "one login across multiple
-- orgs" impossible to build on top of `users` directly. So portal
-- identity gets its own table instead of reusing `users`.
--
-- portal_accounts is the one canonical login (its own email/password,
-- separate namespace from users.email — a portal owner does not need
-- an existing `users`/client row at all). portal_account_access is the
-- join table that grants one portal_accounts row visibility into
-- however many properties (projects rows) across however many orgs.
--
-- v1 scope: grants are property-level (project_id), not routed through
-- an existing client `users`/project_members row — simpler, and doesn't
-- require an owner to have ever logged into the main app before. Staff
-- grant portal access explicitly (added_by), same spirit as how
-- project_members already works for internal users.
--
-- Data shown in the portal for v1 is Facilities-only (per the MangoDoe
-- build-sequence scoping doc) — this migration doesn't enforce that; it's
-- an application-layer decision, since Property Owner Portal Access
-- happens to already only make sense for `projects` rows that are
-- Properties (i.e. have a property_details row), which the API layer
-- should check.
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Session revocation, same pattern as users.token_version (Phase 3).
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_accounts_email ON portal_accounts(email);

DROP TRIGGER IF EXISTS trg_portal_accounts_updated_at ON portal_accounts;
CREATE TRIGGER trg_portal_accounts_updated_at BEFORE UPDATE ON portal_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- portal_account_access ----
-- One row = this portal login can see this property (projects row),
-- which belongs to org_id. org_id is stored redundantly (also reachable
-- via projects.org_id) purely so access-scoped queries don't need a join
-- to projects just to filter by org — same denormalization tradeoff
-- vendor_contracts already makes with project_id alongside vendor_id.
CREATE TABLE IF NOT EXISTS portal_account_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  portal_account_id UUID NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portal_account_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_account_access_account ON portal_account_access(portal_account_id);
CREATE INDEX IF NOT EXISTS idx_portal_account_access_project ON portal_account_access(project_id);
CREATE INDEX IF NOT EXISTS idx_portal_account_access_org ON portal_account_access(org_id);
