# Platform Name → MangoDoe (configurable)

The app name is now a single configurable value, defaulting to "MangoDoe".
Shown in: sidebar wordmark, login page, browser tab title, and the daily-log
email footer. "RADAH's portfolio" wording changed to generic "your organization."

## To rebrand later (no code change)
- Frontend (Vercel): set env var `VITE_APP_NAME` (and optionally `VITE_APP_TAGLINE`), redeploy.
- Backend email footer (Railway): set env var `APP_NAME`.
Defaults to "MangoDoe" if unset, so nothing to configure now.

## Files
New: frontend/src/config.js
Changed: DashboardLayout.jsx, LoginPage.jsx, DashboardPage.jsx, ProjectsPage.jsx,
index.html, backend/routes/dailylogs.js

## Deploy
git add . && git commit -m "Rebrand to MangoDoe (configurable app name)" && git push
No migration, no required env vars. After deploy, hard-refresh to see the new name.
