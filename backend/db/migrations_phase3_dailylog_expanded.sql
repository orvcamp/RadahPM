-- ============================================================
-- RADAH PM PLATFORM — Migration: EXPANDED DAILY LOG
-- ============================================================
-- Additive, idempotent. Expands the daily log into a full field report:
-- site times, richer weather (incl. a weather-delay flag), next-day planned
-- work, deliveries, visitors, inspections, safety, and a toolbox-talk note.
-- Manpower becomes structured rows (company/trade, workers, hours).
-- Attachments already reuse daily_log_photos -> documents (any file type).
-- ============================================================

ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS time_on_site  TIME;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS time_off_site TIME;

ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS temp_high     INTEGER;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS temp_low      INTEGER;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS precipitation TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS wind          TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS weather_delay BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS planned_work        TEXT;  -- next-day look-ahead
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS deliveries          TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS visitors            TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS inspections         TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS safety_incidents    TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS safety_observations TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS toolbox_talk        TEXT;

-- Structured manpower: one row per company/trade on site that day.
CREATE TABLE IF NOT EXISTS daily_log_manpower (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  company TEXT,
  trade TEXT,
  workers INTEGER NOT NULL DEFAULT 0,
  hours NUMERIC(6,2),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_log_manpower_log ON daily_log_manpower(daily_log_id);
