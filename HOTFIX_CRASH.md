# Hotfix — backend crash on boot after soft-delete deploy

## What happened
`ReferenceError: requireRole is not defined` at routes/dailylogs.js:281.

When I made daily-log deletion admin-only I added `requireRole("admin")` to that
route, but `dailylogs.js` never imported `requireRole` from middleware/auth. The
crash happens at require-time, so the server never started.

Your DATABASE IS FINE — the deploy log shows every migration (including
"soft delete / recycle bin") completed before the crash. Nothing to roll back.

## The fix (one line, one file)
backend/routes/dailylogs.js
  - const { requireAuth, isInternal } = require("../middleware/auth");
  + const { requireAuth, requireRole, isInternal } = require("../middleware/auth");

Verified: audited every route file for auth symbols (and other cross-module
helpers) that are used but not imported. dailylogs.js was the only one.

## Deploy
Copy the file in (Replace), then:
git add . && git commit -m "Hotfix: import requireRole in dailylogs" && git push

Railway should redeploy and come up Active. Then confirm:
  - GET https://api.mangodoe.com/api/health responds
  - the app loads and the Deleted Items tab appears (admin only)
