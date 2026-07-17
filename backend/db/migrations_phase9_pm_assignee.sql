-- backend/db/migrations_phase9_pm_assignee.sql
--
-- Adds a default assignee (internal user OR vendor, never both — mirrors
-- work_orders' existing pattern) to pm_schedules, so a recurring PM task
-- can carry forward "who normally does this" onto each generated work
-- order, without requiring manual assignment every time.

ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS default_assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS default_assigned_to_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;