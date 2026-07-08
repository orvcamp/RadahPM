# Expanded Daily Log

The daily log becomes a full construction field report.

## What's new
**Day**       — date, author (already captured), TIME ON SITE / TIME OFF SITE
**Weather**   — conditions, temp high/low, precipitation, wind, and a
                WEATHER DELAY flag (shown as a red badge on the log)
**Manpower**  — structured rows: company, trade, # workers, hours (+ auto total).
                The old single "crew count" is kept as an optional total.
**Work**      — work performed today, plus PLANNED WORK / LOOK-AHEAD (next day),
                and equipment on site
**Site**      — deliveries received, visitors on site, inspections
**Safety**    — safety incidents, safety observations, toolbox talk / JHA
**Issues**    — delays/issues, notes
**Attachments** — ANY file type, not just photos. Images render as thumbnails;
                other files show a document icon and open on click.

The "email this daily log" feature now includes every new field, plus a
manpower summary.

## Backwards compatible
Existing logs keep their data; new fields are simply empty. The API still
returns `photos` alongside the new `attachments` array.

## New + changed files
New: backend/db/migrations_phase3_dailylog_expanded.sql
Changed: backend/db/migrate.js, backend/routes/dailylogs.js,
         frontend/src/components/DailyLogsTab.jsx

## Deploy
git add . && git commit -m "Expanded daily log (times, weather, manpower, look-ahead, safety, attachments)" && git push
Log should show: Migration (expanded daily log) complete. No env vars.

## Test
1. Daily Logs → + New Daily Log. The form is now sectioned:
   Day / Weather / Manpower / Work / Site Activity / Safety / Issues / Attachments.
2. Add two manpower rows (company, trade, workers, hours) — the total updates.
3. Tick "Weather delay" → the saved log shows a red Weather Delay badge.
4. Attach a photo AND a PDF → the photo shows as a thumbnail, the PDF as a file tile.
5. Click Email on the log → the email now includes look-ahead, times, safety,
   and the manpower summary.
