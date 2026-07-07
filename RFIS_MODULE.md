# RFIs Module (Requests For Information)

Workflow: Open → Answered → Closed (reopen allowed). Per-project RFI numbers,
due dates with overdue flagging, assignee, answer capture, and file attachments
(reuse R2/Documents). Registered as a toggleable module ("RFIs") — appears as a
chip on the platform Organizations page.

## Permissions
- Raise (create/edit): admin/staff or trade-partner members.
- Answer/close/reopen: admin/staff or client members.
- View: any project member. Delete: admin/staff.
(Trade partners raise but don't answer; clients answer but don't raise. All backend-enforced.)

## New + changed files
New: backend/db/migrations_phase3_rfis.sql, backend/routes/rfis.js,
     frontend/src/components/RfisTab.jsx
Changed: backend/orgModules.js (adds "rfis"), backend/routes/projects.js (whitelist),
         backend/server.js (mount), backend/db/migrate.js (migration),
         frontend/src/pages/ProjectDetailPage.jsx (RFIs tab)

## Deploy
git add . && git commit -m "RFIs module" && git push
Log should show: Migration (RFIs) complete. No env vars.

## Test
Project → RFIs → New RFI (subject, question, due date, assignee) → it appears Open.
As admin/staff or a client member: Answer it → Answered → Close. Set a past due date on
an open RFI to see the red OVERDUE flag. Add a file via the 📎 button.
On the Organizations page, an "RFIs" toggle now appears per org.

## Next in sequence
Submittals (next), then Billing (last, scoped carefully).
