# Three fixes

## 1. Auto-generated temp password for new organizations
Creating an organization no longer asks you to type a password. The system
generates a secure temporary password and displays it after creation (share it
securely; the org admin changes it after first login). Same as the reset flow.
Files: backend/routes/platform.js, frontend/src/pages/PlatformAdminPage.jsx

## 2. Tagline updated
The sidebar tagline under "MangoDoe" now reads "Ripe Insights | Real Results"
(was "Project Platform"). Still overridable via VITE_APP_TAGLINE.
File: frontend/src/config.js

## 3. Team "Add to Project" — clearer behavior
The add-member dropdown only lists CLIENT and TRADE-PARTNER users (internal
staff already have access to every project, so they aren't added here). If none
exist yet, you now see a clear message telling you to create them on the Users
page first. The "+ Add to Project" button is also disabled until you select a
user, so it never appears unresponsive.
  → If your button "did nothing," it was because no client/trade-partner users
    existed yet. Create them (Users page) and they'll appear in the dropdown.
File: frontend/src/pages/ProjectDetailPage.jsx

## Deploy
git add . && git commit -m "Fixes: auto temp password, tagline, team add UX" && git push
No migration, no env vars.
