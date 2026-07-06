# RADAH PM — Phase 3 (Multi-tenancy) Stage A1: Organization Foundation

## What this is
The tenant seam. Introduces organizations so the platform can be sold to multiple
companies whose data never mixes. **All reads and project/user management are now
strictly org-scoped.** RADAH becomes organization #1 and also the platform owner.

## New + changed files
**New:**
- `backend/db/migrations_phase3_orgs.sql` — organizations table + org_id/backfill
- `backend/routes/platform.js` — platform-admin org provisioning
- `frontend/src/pages/PlatformAdminPage.jsx` — the "Organizations" page (platform admin only)

**Changed:**
- `backend/db/migrate.js`, `backend/db/seed.js` — run the migration; seed admin into an org
- `backend/middleware/auth.js` — org-aware JWT helpers + guards
- `backend/routes/auth.js` — JWT carries orgId + isPlatformAdmin; self-register disabled
- `backend/routes/projects.js` — `userCanAccessProject` and all project routes org-scoped
- `backend/routes/users.js` — all user-management routes org-scoped
- `backend/server.js` — mounts platform routes
- `frontend/src/App.jsx`, `DashboardLayout.jsx` — Organizations route + nav (platform admin)
- `frontend/src/pages/LoginPage.jsx`, `RegisterPage.jsx` — self-register removed (invite-only)

## Deploy
1. Copy files in, then:
   ```
   git add .
   git commit -m "Phase 3 A1: multi-tenancy foundation (organizations)"
   git push
   ```
2. Railway redeploys. Logs should show
   `Phase 3 migration (organizations / multi-tenancy) complete`.
   No new env vars.

## ⚠ CRITICAL: log out and back in after deploy
The JWT changed. Your existing browser session has an old token with no organization,
so right after deploy the app will tell you to re-login (or show 401/403). **Log out
and log back in once** to get a fresh org-aware token. Your account is auto-migrated
into the "RADAH Project Management" org and made a platform admin, so everything you
had is intact after re-login.

## How to test (two parts)

**Part 1 — nothing broke (functional):**
- Re-login. Confirm all existing data loads: projects, budgets, change orders, daily
  logs, documents/folders.
- Confirm you now see an **Organizations** item in the sidebar (platform-admin only).
- Visit /register — it should show an invitation-required message, not a signup form.

**Part 2 — isolation actually works (the point of A1):**
- Go to **Organizations** → Create Organization → make "Test Org B" with a new admin
  email + password.
- Log out; log in as that Test Org B admin.
- Confirm Org B sees **zero** of RADAH's projects and **zero** of RADAH's users — a
  clean, empty tenant. That's tenant isolation working.
- Log back in as your RADAH admin; your data is all still there.

## Honest scope boundary (why A2 comes next)
A1 makes every **read** and all **project/user management** org-safe. It does NOT yet
put org checks on the child-module **write-by-id** routes (e.g. PATCH a budget line,
transition a change order, edit a daily log, create/rename a folder). Those still trust
"admin/staff" without checking the target's org, so a **second real customer must not be
onboarded until Stage A2 closes those.** For your own controlled testing with a test org,
this is fine. A2 will add a single shared org-check helper across budgets, change orders,
daily logs, documents, and folders.

## After A2
Then the email foundation (provider + DNS) and the "email daily log" feature — now safe
to build because recipients come from org-scoped project teams.
