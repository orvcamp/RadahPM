# RADAH PM — Enhancements: Document Folders + Change Order Attachments

## What's in this drop (new + changed only)
**New:**
- `backend/db/migrations_phase2_folders.sql` — document_folders + documents.folder_id
- `backend/db/migrations_phase2_co_attachments.sql` — change_order_documents link table

**Changed:**
- `backend/db/migrate.js` — runs both new migrations
- `backend/routes/documents.js` — folder CRUD, move-document, upload-into-folder
- `backend/routes/changeorders.js` — CO attachment upload/confirm/delete + list includes attachments
- `frontend/src/components/DocumentsTab.jsx` — nested folder navigation UI
- `frontend/src/components/ChangeOrdersTab.jsx` — per-CO attachments modal

(No server.js or ProjectDetailPage changes — routes/tabs already mounted.)

## 1) Document Folders (nested)
- admin/staff create / rename / delete / move folders; any member can move their own uploads.
- Uploads go into the folder you're currently viewing.
- Breadcrumb navigation; folders shown above files.
- **Deleting a folder never deletes files** — its subfolders and documents move up one level.
- Can't move a folder into itself or a descendant (blocked server-side).

## 2) Change Order Attachments
- Open a CO's **📎 Files** button to view/download attachments.
- **admin/staff and project-member clients** can add files (so a client can attach a
  supporting doc when approving/rejecting). Trade partners have no CO access at all.
- Attachments are also normal project documents (visible in the Documents tab).
- Remove an attachment: its uploader or admin/staff.

## Deploy
1. Copy files in, then:
   ```
   git add .
   git commit -m "Enhancements: document folders + CO attachments"
   git push
   ```
2. Railway redeploys; logs should show:
   `Migration (document folders) complete` and `Migration (change order attachments) complete`.
   No new env vars (reuses R2).
3. Test folders: Documents → New Folder → open it → upload a file into it → move a file between
   folders → delete a non-empty folder and confirm contents moved up (nothing lost).
4. Test CO attachments: a change order → 📎 Files → Add File → download it → confirm it also
   shows in the Documents tab.

## After this
- Remaining Phase 2: email foundation + email-daily-log (needs provider + DNS — your setup),
  then Tier 3 (RFIs & submittals).
- Still pending: real client + trade_partner test users (now especially worth doing — folders
  touch member upload/move permissions and CO attachments add a client-writable path).
