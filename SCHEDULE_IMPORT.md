# Schedule import + 3-week lookahead

Schedule tab → **Import Schedule** (admin/staff). Activities appear below the
issued-schedule file card, with a read-only Gantt and a lookahead view.

## What it accepts
- **MS Project XML** (File → Save As → XML). Parsed automatically with the
  browser's built-in DOMParser — no dependency. Picks up WBS, outline level,
  summary/milestone flags, % complete, and predecessor links.
- **Spreadsheet** (.xlsx / .csv) — for Primavera P6 or anything else. Same
  column-mapping step as the estimate import: WBS · Name* · Start* · Finish* ·
  % Complete · Predecessors.

Parsed in your browser. The file is never uploaded.

## Two views
- **3-Week Lookahead** (default) — every activity in flight or starting within
  the next 21 days. This is the weekly view superintendents actually use.
- **Full Schedule** — everything, indented by WBS outline level.

"Hide summary rows" is on by default so the lookahead shows real work, not
rolled-up parents. Bars fill by % complete (gold in progress, green at 100%);
milestones render as ◆.

## Import REPLACES (unlike the estimate import)
A schedule update is a re-baseline, not an append. Re-importing swaps the whole
activity set, and you're asked to confirm with the counts shown. **Uploaded
schedule FILES and their revision history are untouched** — those two features
are independent.

## What this is NOT
A scheduling engine. No critical path, no float, no baselines, no resource
levelling. Schedules are built in P6 / MS Project and mirrored here so the team
can see them. That boundary is deliberate — see the backlog.

## New + changed files
New: backend/db/migrations_phase3_schedule_activities.sql
     frontend/src/components/ScheduleImportModal.jsx
     frontend/src/components/ScheduleActivitiesCard.jsx
Changed: backend/db/migrate.js, backend/routes/schedules.js (activity endpoints),
         frontend/src/lib/sheetjs.js (MS Project XML parser + date helpers),
         frontend/src/pages/ProjectDetailPage.jsx (activities card)

No npm install. No env vars.

## Deploy
git add . && git commit -m "Schedule import (MS Project XML / CSV) + 3-week lookahead" && git push
Log should show: Migration (schedule activities) complete.

## Test
1. In MS Project: File → Save As → choose "XML Format (*.xml)".
2. Schedule tab → Import Schedule → pick the .xml. Activities parse immediately;
   the preview shows summary and milestone counts.
3. Import → the Lookahead view opens with only the next three weeks.
4. Toggle Full Schedule → activities indent by outline level.
5. Untick "Hide summary rows" → the rolled-up parents appear in bold.
6. Re-import → you're warned it replaces the existing set; confirm the counts.
7. No MS Project handy? Export any schedule as .csv with Name/Start/Finish
   columns and map them.
