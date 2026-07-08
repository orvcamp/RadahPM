-- ============================================================
-- RADAH PM PLATFORM — Migration: NOTIFICATIONS (in-app bell)
-- ============================================================
-- Additive, idempotent. One row per recipient per event. Actor and project
-- names are denormalized so the bell renders without joins and survives the
-- underlying record being deleted.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  project_name TEXT,
  type TEXT NOT NULL,          -- e.g. rfi.raised, changeorder.approved
  title TEXT NOT NULL,
  body TEXT,
  tab TEXT,                    -- which project tab to open
  actor_name TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC);
