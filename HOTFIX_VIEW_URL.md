# Hotfix — document "View" returned "Not found."

## What was wrong
The new `GET /api/documents/:id/view-url` route was accidentally defined INSIDE
the download-url handler's try block. That's still valid JavaScript (so the
syntax check passed), but Express never registers the route when the server
boots — so every View request 404'd with "Not found."

## The fix
The route is now defined at the top level of the router, alongside the others.
Verified structurally: all 12 route registrations in this file are top-level.

## File (one changed file — replace it)
backend/routes/documents.js

Nothing else changed. `backend/db/r2.js` and `frontend/src/components/DocumentsTab.jsx`
from the previous drop are correct and already deployed — leave them as they are.

## Deploy
git add . && git commit -m "Hotfix: register document view-url route at top level" && git push
No migration, no env vars.

## Test
Documents tab → click **View** on the PDF. It should render in the modal instead
of showing "Not found." Try an image too.
