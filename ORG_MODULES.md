# RADAH PM — Org Modules (capability enablement seam)

## What this is
The "capabilities as products" seam. Each capability module (Documents, Budget,
Change Orders, Daily Logs) can now be enabled/disabled **per organization** from the
platform-admin Organizations page. Core PM (projects, tasks, phases, team) is always on.

Design: a row in `org_modules` exists only to OVERRIDE the default — **absence means
enabled**. So everything is on for everyone today, and future modules are on by default;
disabling is an explicit opt-out. Nothing changes functionally until you toggle something.

## New + changed files
**New:**
- `backend/db/migrations_phase3_modules.sql` — `org_modules` table
- `backend/orgModules.js` — module list, `orgHasModule`, `getOrgModules`, `requireModule`
- `backend/routes/mymodules.js` — `GET /api/my-modules` (current user's enabled modules)

**Changed:**
- `backend/db/migrate.js` — runs the modules migration
- `backend/server.js` — mounts my-modules route
- `backend/routes/platform.js` — org list includes module states; `PATCH .../:id/modules` toggle
- `backend/routes/budget.js`, `changeorders.js`, `dailylogs.js`, `documents.js` — main data
  endpoint now behind `requireModule(...)` (returns 403 if the org has it disabled)
- `frontend/src/pages/PlatformAdminPage.jsx` — per-org module toggle chips
- `frontend/src/pages/ProjectDetailPage.jsx` — hides tabs for disabled modules (via /my-modules)

No re-login needed (JWT unchanged).

## Deploy
1. Copy files in, then:
   ```
   git add .
   git commit -m "Org modules: per-tenant capability enablement seam"
   git push
   ```
2. Railway redeploys; log shows `Phase 3 migration (org modules) complete`. No env vars.

## Test
1. As platform admin → **Organizations**. Each org row now shows module chips
   (✓ Documents, ✓ Budget, ✓ Change Orders, ✓ Daily Logs), all enabled.
2. On your **Test Org B** (not RADAH), click a chip to disable it (e.g. ✕ Budget).
3. Log in as the Test Org B admin, open a project → confirm the Budget tab is gone.
   Re-enable it from the platform page → tab returns. (RADAH keeps everything on.)

## Note on enforcement
The module guard is on each module's main data endpoint + the UI tab. This is a
*packaging* boundary within what an org already owns (not a tenant-isolation boundary —
that's the A1/A2 org scoping, which is separate and complete). Deeper per-endpoint
enforcement can be added if/when you sell strict tiers; for onboarding pilots and shaping
what a tenant sees, this is sufficient.

## Where this leaves the roadmap
- Architecture now supports "capabilities as products" without further restructuring —
  new modules (RFIs, Procurement, Safety, etc.) are additive and auto-appear in the toggle
  list when you register their key in `orgModules.js`.
- Highest-value next move (your call): **get a pilot on what exists.** Recommended pre-pilot
  step with no new code — create a client + a trade_partner test user and walk through their
  roles. Then Stage B (org invite emails, built on mail.js) when you have a specific company
  to onboard.
