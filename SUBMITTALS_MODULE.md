# Submittals Module

Workflow: Draft → Submitted → Under Review → Returned (with a disposition:
Approved / Approved as Noted / Revise & Resubmit / Rejected). A returned
submittal can spawn a Revision (same number, revision+1, linked to the prior
round). Tracks spec section, due date (with overdue flag), ball-in-court,
review notes. Attachments reuse R2/Documents (attach when creating). Registered
as a toggleable "Submittals" module — appears on the Organizations page.

## Permissions
- Create / edit / submit / revise: admin/staff or trade-partner members.
- Start review / return (disposition) / reopen: admin/staff or client members.
- View: any project member. Delete: admin/staff. (All backend-enforced.)

## New + changed files
New: backend/db/migrations_phase3_submittals.sql, backend/routes/submittals.js,
     frontend/src/components/SubmittalsTab.jsx
Changed: backend/orgModules.js (adds "submittals"), backend/routes/projects.js
         (whitelist), backend/server.js (mount), backend/db/migrate.js (migration),
         frontend/src/pages/ProjectDetailPage.jsx (Submittals tab)

## Deploy
git add . && git commit -m "Submittals module" && git push
Log should show: Migration (Submittals) complete. No env vars.

## Test the full cycle
1. New Submittal (title, spec section, due date, ball-in-court, + attach a file) → Draft.
2. Submit → Submitted. As admin/staff or a client member: Start Review → Under Review.
3. Return → pick "Revise & Resubmit" + notes → it shows Returned with that disposition.
4. Revise → creates "#N Rev 1" as a fresh Draft, linked to the prior round.
5. Submit Rev 1, review, Return "Approved" → done.
Set a past due date on a submitted item to see the red OVERDUE flag.
An "Submittals" toggle now appears per org on the Organizations page.

## Next (last module in this batch)
Billing — the heaviest one; we'll scope it carefully like Budget.
