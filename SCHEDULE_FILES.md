# Project Schedule — issued file + revision history

## What this is (and deliberately isn't)
The Schedule tab now holds the project's ISSUED SCHEDULE as an uploaded file,
with automatic revision history. It is NOT a scheduling engine — schedules are
built in Primavera P6 / MS Project. This makes sure the whole team knows which
revision is current and can open it in one click.

## Behavior
- Admin/staff click **Upload Schedule** (optionally with a revision note).
  Each upload becomes the next revision; the newest is marked **Current**.
- Any project member can **View** (in-app preview) or **Download** any revision.
- Older revisions collapse into a "Show revision history" list.
- Admin/staff can delete a revision.
- Schedule files reuse the documents/R2 pipeline, so they also appear in the
  Documents library.

## Phases clarified
Phases remain lightweight buckets for grouping tasks on the timeline. The tab now
says so explicitly, so nobody expects CPM behavior from them.

## Also in this drop
The document preview modal was extracted into a shared component
(`DocumentViewerModal.jsx`) so the Documents tab and the Schedule card use the
same viewer. Behavior is unchanged.

## New + changed files
New: backend/db/migrations_phase3_schedule_files.sql
     backend/routes/schedules.js
     frontend/src/components/ProjectScheduleCard.jsx
     frontend/src/components/DocumentViewerModal.jsx
Changed: backend/db/migrate.js, backend/server.js (mount),
         frontend/src/components/DocumentsTab.jsx (uses shared viewer),
         frontend/src/pages/ProjectDetailPage.jsx (schedule card in Schedule tab)

## Deploy
git add . && git commit -m "Project schedule files with revision history" && git push
Log should show: Migration (schedule files) complete. No env vars.
Uploads go straight to R2 — the CORS policy already allows app.mangodoe.com.

## Test
Project → Schedule tab → Upload Schedule (a PDF works well) → it appears as
"Current · Rev 1". Upload again → becomes Rev 2, and Rev 1 moves into revision
history. Click **View** to preview it in-app.

## Backlogged (Tier 1)
MS Project XML / CSV import → activities on a read-only Gantt + a 3-week
lookahead view. Full CPM (critical path, float, baselines) is not planned.
