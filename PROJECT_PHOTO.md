# Project Photos on the Projects List

Each project now shows a photo beside it on the Projects tab. If no photo is set,
a generated placeholder (colored tile with the project's initials) is shown, so
the list always looks complete. Admin/staff can set/change/remove a photo.

## How it works
- Photos are uploaded to secure cloud storage (R2), like documents.
- The Projects list shows a thumbnail per project; admin/staff click a project's
  thumbnail to upload, change, or remove its photo.
- Others just see the photo or placeholder (no edit control).

## New + changed files
New: backend/db/migrations_phase3_project_photo.sql
Changed: backend/db/migrate.js (migration), backend/routes/projects.js
         (photo_key + upload/confirm/remove endpoints + photo URLs in the list),
         frontend/src/pages/ProjectsPage.jsx (thumbnail, placeholder, photo modal)

## Deploy
git add . && git commit -m "Project photos on the projects list" && git push
Log should show: Migration (project photo) complete. Uses existing R2 config.

## Note: R2 CORS already covers this
Photo uploads go straight to R2 from the browser (same as document uploads), so
they rely on the R2 bucket CORS policy you already updated to include
https://app.mangodoe.com. No further CORS change needed.

## Test
Projects tab → click a project's thumbnail (as admin/staff) → Upload Photo →
pick an image → it appears beside the project. Projects without a photo show a
colored initials tile.
