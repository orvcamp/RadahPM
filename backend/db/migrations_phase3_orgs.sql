-- ============================================================
-- RADAH PM PLATFORM — Phase 3 (Multi-tenancy) Migration: ORGANIZATIONS
-- Stage A1: the tenant seam.
-- ============================================================
-- Additive and idempotent. Introduces organizations and stamps org_id
-- onto the two "root" tables (users, projects). Every other table hangs
-- off a project, so it inherits its org through project_id.
--
-- Backfill: all existing users/projects are assigned to a single default
-- "RADAH Project Management" organization, and existing admins are
-- promoted to platform (super) admins — they are RADAH's own founders.
-- Going forward, org membership is explicit and platform-admin is NOT
-- granted automatically.
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Root-table columns (nullable at first so we can backfill, then made NOT NULL).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- ---- Backfill (all idempotent) ----

-- 1. Create a single default organization if none exists yet.
INSERT INTO organizations (name)
SELECT 'RADAH Project Management'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- 2. Assign any org-less users to the default (oldest) organization.
UPDATE users
   SET org_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
 WHERE org_id IS NULL;

-- 3. Assign any org-less projects likewise.
UPDATE projects
   SET org_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
 WHERE org_id IS NULL;

-- 4. Promote existing admins to platform admins (one-time: they are RADAH's own).
UPDATE users
   SET is_platform_admin = TRUE
 WHERE role = 'admin' AND is_platform_admin = FALSE;

-- ---- Enforce the invariant now that every row has an org ----
ALTER TABLE users   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
