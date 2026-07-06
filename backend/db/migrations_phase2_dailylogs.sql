-- ============================================================
-- RADAH PM PLATFORM — Phase 2 (Tier 2) Migration: DAILY LOGS
-- ============================================================
-- Additive and safe to re-run (IF NOT EXISTS + DROP/CREATE trigger).
--
-- Daily field reports. Multiple entries per project per day are allowed
-- (e.g. different trades each file their own). Photos are stored in the
-- existing documents table (R2-backed) and linked here via
-- daily_log_photos, so a log photo is also a normal project document.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  weather TEXT,
  temperature TEXT,               -- free text, e.g. "72°F" or "60–75°F"
  work_performed TEXT,
  crew_count INTEGER,             -- manpower on site
  equipment TEXT,                 -- equipment on site
  delays TEXT,                    -- delays / issues
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_project ON daily_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_author ON daily_logs(created_by);

-- Links a daily log to a document (photo) in the documents table.
-- Deleting a log removes the link but leaves the document in the project
-- library. Deleting the document removes the link too.
CREATE TABLE IF NOT EXISTS daily_log_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(daily_log_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_log_photos_log ON daily_log_photos(daily_log_id);

DROP TRIGGER IF EXISTS trg_daily_logs_updated_at ON daily_logs;
CREATE TRIGGER trg_daily_logs_updated_at BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
