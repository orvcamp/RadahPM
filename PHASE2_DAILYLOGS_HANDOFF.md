# RADAH PM — Phase 2 (Tier 2): Daily Logs (deploy note)

## What's in this drop (new + changed only)
**New:**
- `backend/db/migrations_phase2_dailylogs.sql` — daily_logs + daily_log_photos tables
- `backend/routes/dailylogs.js` — daily logs API + photo endpoints (reuse R2)
- `frontend/src/components/DailyLogsTab.jsx` — the Daily Logs tab UI

**Changed:**
- `backend/db/migrate.js` — runs the daily-logs migration
- `backend/server.js` — mounts the daily-logs routes
- `frontend/src/pages/ProjectDetailPage.jsx` — adds the Daily Logs tab (visible to all members)

## What it does
Dated field reports (multiple per day allowed): weather/temp, work performed, crew count,
equipment, delays/issues, notes, author, and photos.

**Permissions (backend-enforced):**
- admin/staff: create, edit, delete any log.
- **trade_partner: create logs; edit/delete only their OWN.** (First trade-partner-writable module.)
- client: view only.
- The Daily Logs tab is visible to every project member (including trade partners), unlike
  Budget / Change Orders.

**Photos** upload through the same presigned-R2 flow as Documents — a log photo becomes a
normal project document (visible in the Documents tab too) and is linked to the log. Needs
the R2 env vars already set (they are). Text-only logs work even without R2.

## Deploy steps
1. Copy files in, then:
   ```
   git add .
   git commit -m "Phase 2 (Tier 2): Daily Logs"
   git push
   ```
2. Railway redeploys; look for `Phase 2 migration (daily logs) complete`. No new env vars.
3. Test: project → **Daily Logs** → New → fill fields, add a photo → Create. Confirm the card
   shows with the photo thumbnail, and that the photo also appears in the **Documents** tab.

## This completes Tier 2 (Change Orders + Daily Logs).
Remaining Phase 2:
- Tier 3: RFIs & submittals, Notifications/email (built last — spans modules).
Still pending: add real client + trade_partner test users. This is now the highest-value
next step — Tier 2 introduced client-writable (CO approve/reject) and trade-partner-writable
(daily logs) actions that are best verified with real non-admin accounts.
