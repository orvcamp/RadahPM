# Logs & Registers module

Nine PM-owned registers, one table, one UI — because Action, Issue, Decision,
Risk, Assumption, Constraint, Opportunity, Open Items, and Lessons Learned all
share the same shape: a numbered entry with a title, owner, priority, status,
due date, and an outcome.

  Action Log · Issue Log · Decision Log · Risk Register · Assumption Log ·
  Constraint Log · Opportunity Log · Open Items Log · Lessons Learned Log

## How it works
- A new **Logs** tab (Overview group), gated by a new "Logs & Registers" module
  toggle on the Organizations page.
- Pick a register from the row of buttons; each shows its count of open items.
- Entries are numbered per project PER REGISTER (Action #1, Risk #1, ...).
- Filter: "Open items" (default) or "All items".
- Overdue open entries are flagged in red.
- **Risk Register and Opportunity Log** add Likelihood / Impact columns.
  The other seven registers hide those fields entirely.
- Workflow: Open → Start (In Progress) → Close (with a Resolution / Outcome).
  Closed entries can be reopened.

## Permissions
admin/staff create, edit, and close entries (these are PM-owned registers).
Every project member can view. Delete is **admin-only and soft** — entries land
in Deleted Items and can be restored.

## Notifications
Assigning an owner notifies that person directly ("Action #7 assigned to you"),
including the due date. Nobody else is notified — a busy Action Log would
otherwise bury the bell. You are never notified of your own assignment.

## New + changed files
New: backend/db/migrations_phase3_logs.sql
     backend/routes/logs.js
     frontend/src/components/LogsTab.jsx
Changed: backend/db/migrate.js, backend/notify.js (adds notifyUser),
         backend/orgModules.js (registers "logs"), backend/server.js (mount),
         backend/routes/projects.js (resource whitelist),
         backend/routes/trash.js (log entries restorable),
         frontend/src/config.js (Logs tab + stage relevance),
         frontend/src/pages/ProjectDetailPage.jsx (wires the tab)

No env vars.

## Deploy
git add . && git commit -m "Logs & Registers module" && git push
Log should show: Migration (project logs) complete.

## Test
1. Open a project → new **Logs** tab → Action Log is selected.
2. + New Action → title, owner (pick a teammate), due date in the past → Create.
   The row shows a red OVERDUE flag; the register button shows "(1)".
3. Log in as that teammate → their bell shows "Action #1 assigned to you".
4. Switch to the **Risk Register** → + New Risk → Likelihood / Impact fields appear.
   They do not appear on the Action Log.
5. Close an entry, add a Resolution, then flip the filter to "All items" to see it.
6. Delete an entry as admin → find it under **Deleted Items** → Restore.
7. Organizations page → a "Logs & Registers" toggle now appears per org.
