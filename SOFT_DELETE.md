# Soft Delete + Deleted Items (recoverable deletes)

## The problem this fixes
Deleting a document used to be PERMANENT: one browser confirm, and the file was
removed from R2 storage and the database with no undo. For construction records
(contract drawings, signed agreements, permits) that's an unacceptable risk.

## What changed
Deleting a **document, daily log, RFI, submittal, or change order** now performs a
SOFT delete: the record is flagged and hidden from lists, but retained — and for
documents the stored file is retained too. An admin can restore it.

- New **Deleted Items** tab on each project (Overview group) — **admin only**.
  Lists everything soft-deleted, who deleted it and when.
  • **Restore** puts the record back.
  • **Delete Forever** permanently purges it (the only irreversible action; for
    documents it also removes the stored file). Guarded by a clear confirmation.

## Deletion is now ADMIN-ONLY
Previously: documents could be deleted by admin/staff **or the uploader**; RFIs,
submittals, and change orders by admin/staff; daily logs by their author.
Now every one of those deletes requires the **admin** role — enforced on the
backend, and the Delete buttons are hidden from everyone else.

Note: folder deletion was already safe (contents move up one level) and is
unchanged — still admin/staff.

## New + changed files
New: backend/db/migrations_phase3_soft_delete.sql, backend/routes/trash.js,
     frontend/src/components/TrashTab.jsx
Changed: backend/db/migrate.js, backend/server.js (mount trash routes),
         backend/routes/{documents,dailylogs,rfis,submittals,changeorders}.js
         (lists filter deleted rows; deletes are soft + admin-only),
         frontend/src/config.js (Deleted Items tab),
         frontend/src/pages/ProjectDetailPage.jsx (tab wiring, admin-gated),
         frontend/src/components/{DocumentsTab,RfisTab,SubmittalsTab,
         DailyLogsTab,ChangeOrdersTab}.jsx (Delete buttons admin-only)

## Deploy
git add . && git commit -m "Soft delete with admin restore (Deleted Items)" && git push
Log should show: Migration (soft delete / recycle bin) complete. No env vars.

## Test
1. As admin, delete a document → the prompt now says it can be restored.
2. Open the project's **Deleted Items** tab → the document is listed with who
   deleted it and when → click **Restore** → it reappears in its folder.
3. Delete it again, then **Delete Forever** → it's gone for good (confirm dialog
   warns this can't be undone).
4. Log in as staff → confirm no Delete buttons appear, and no Deleted Items tab.

## Known scope note
Soft-deleting a change order does NOT reverse a budget line it created — use
Revert on the change order for that (existing behavior, unchanged).
