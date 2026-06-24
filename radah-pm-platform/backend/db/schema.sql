-- ============================================================
-- RADAH PM PLATFORM — Database Schema (Phase 1)
-- PostgreSQL
--
-- Phase 1 scope: auth, organizations, projects, phases,
-- tasks/milestones, project membership (multi-role access).
--
-- Designed to extend cleanly into Phase 2/3:
--   budgets/costs, RFIs/submittals, daily logs, documents,
--   change orders — each will be a new table referencing
--   projects(id), following the same pattern as tasks.
-- ============================================================

-- ---------- Extensions ----------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- Enums ----------
CREATE TYPE user_role AS ENUM ('admin', 'staff', 'client', 'trade_partner');
CREATE TYPE project_status AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE task_status AS ENUM ('not_started', 'in_progress', 'blocked', 'completed');
CREATE TYPE membership_role AS ENUM ('owner_contact', 'project_manager', 'trade_partner', 'viewer');

-- ============================================================
-- USERS
-- One login table for all tenant types (admin/staff/client/trade_partner).
-- `role` is the platform-wide role; project-level access is further
-- scoped by project_members below (a client only sees projects they're
-- a member of; an admin/staff sees everything).
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'client',
  company_name TEXT,                 -- for client/trade_partner: their org name
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  client_org_name TEXT,              -- display name of the owning client org
  status project_status NOT NULL DEFAULT 'planning',
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  location TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_status ON projects(status);

-- ============================================================
-- PROJECT MEMBERS
-- Controls who can see/act on a given project. Admin/staff bypass
-- this check entirely (see backend authorization middleware) and
-- can see all projects; clients and trade partners are restricted
-- to projects where they have a membership row.
-- ============================================================
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_role membership_role NOT NULL DEFAULT 'viewer',
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);

-- ============================================================
-- PHASES
-- Logical groupings of tasks within a project (e.g. "Design",
-- "Permitting", "Construction", "Closeout"). Drives the Gantt
-- timeline grouping in the UI.
-- ============================================================
CREATE TABLE phases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_phases_project ON phases(project_id);

-- ============================================================
-- TASKS / MILESTONES
-- is_milestone=true tasks render as diamond markers on the
-- timeline rather than bars (zero or near-zero duration).
-- ============================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES phases(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE, -- optional subtasks
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'not_started',
  is_milestone BOOLEAN NOT NULL DEFAULT FALSE,
  start_date DATE,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_phase ON tasks(phase_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================================
-- TASK DEPENDENCIES (for Gantt "finish-to-start" links)
-- ============================================================
CREATE TABLE task_dependencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

-- ============================================================
-- TASK COMMENTS (lightweight collaboration — Phase 1 minimal)
-- ============================================================
CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id);

-- ============================================================
-- updated_at auto-touch trigger (applied to a few key tables)
-- ============================================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- SEED: first admin user
-- Password below is a placeholder bcrypt hash for "ChangeMe123!" —
-- the backend's seed script (db/seed.js) generates this properly
-- at setup time. Do not rely on this literal hash in production;
-- run the seed script instead, then change the password immediately.
-- ============================================================
-- (Seeding is handled by backend/db/seed.js, not inline SQL,
--  so the password hash is generated correctly with bcrypt at runtime.)
