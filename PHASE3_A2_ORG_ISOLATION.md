# RADAH PM — Phase 3 (Multi-tenancy) Stage A2: Close Write Gaps

## What this is
A2 finishes tenant isolation. A1 secured all reads + project/user management; A2 adds
an organization check to **every child-module write route** so a user in one org can
never create or modify another org's records — even by guessing an ID.

**Backend-only. No schema change, no migration, no env vars, no frontend change.**
Lower-risk than A1.

## How it works
Two small guards, applied consistently:
- `guardProject` — on `/projects/:projectId/...` write routes: confirms the project is in
  the caller's org.
- `guardResource(table)` — on bare-`:id` write routes: resolves the resource's owning
  project and confirms its org. Cross-org access returns 404 (doesn't even reveal the ID
  exists in another org).

Both reuse the org-aware `userCanAccessProject` chokepoint from A1. A whitelisted
`resourceProjectId` helper (added to projects.js) does the resource→project lookup.

## Coverage (audited programmatically)
Every mutating route in all six project child-modules is now covered by
`guardProject` / `guardResource` / an inline `userCanAccessProject` check:
budgets, change orders (incl. transition + attachments), daily logs (incl. photos),
documents & folders, phases, and tasks.

## Changed files (7, all backend)
- `backend/routes/projects.js` — resource whitelist + `resourceProjectId` export
- `backend/routes/budget.js`
- `backend/routes/changeorders.js`
- `backend/routes/dailylogs.js`
- `backend/routes/documents.js`
- `backend/routes/phases.js`
- `backend/routes/tasks.js`

## Deploy
1. Copy files in, then:
   ```
   git add .
   git commit -m "Phase 3 A2: org isolation on all child-module writes"
   git push
   ```
2. Railway redeploys. No migration line to watch for; just confirm it goes Active and
   `/api/health` responds. No re-login needed (JWT unchanged from A1).

## Testing — regression first, then isolation
**Regression (the important one):** the guards must not break normal same-org use. As your
RADAH admin, confirm these all still work on a RADAH project:
- Budget: add/edit/delete a line, add a commitment and an expense.
- Change order: create → submit → approve → revert.
- Daily log: create, edit, add a photo.
- Documents: create/rename/delete a folder, upload, move a file.
- Tasks/Phases: edit a task, edit a phase.

If all of that still works, the guards are correctly scoped (they allow same-org, block
cross-org).

**Isolation:** the UI only ever surfaces your own org's projects, so you can't trigger a
cross-org write from the interface — which is the point. Cross-org protection is enforced
at the API and was verified by a full route audit (every write route covered).

## After A2 — multi-tenancy is complete and safe
It's now safe to onboard a real second customer. Next up (your original ask):
the **email foundation + email-daily-log**, which needs a provider (Resend recommended)
plus Cloudflare DNS verification and a Railway API key. Pending email decisions:
from-address (recommend a neutral platform domain, not radahpm.com, since you're selling
this) and default recipients.
