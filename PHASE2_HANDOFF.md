# RADAH PM — Phase 2 Handoff Note

## Current live state
- **Website:** radahpm.com (Cloudflare)
- **PM Platform frontend:** app.radahpm.com + radah-pm.vercel.app (Vercel)
- **PM Platform backend:** radahpm-production.up.railway.app (Railway + Postgres)
- **GitHub repo:** github.com/orvcamp/RadahPM (branch: main)
- **Local push folder (Windows):** C:\Users\orvca\OneDrive\Desktop\radah-pm-platform
- Phase 1 fully working. CORS_ORIGIN on Railway = https://app.radahpm.com,https://radah-pm.vercel.app

## What's in this zip (Phase 2 — Documents module, code complete, NOT yet deployed)
New/changed files since the last deployed version:
- `backend/package.json` — added @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
- `backend/db/r2.js` — NEW: Cloudflare R2 (S3-compatible) client + presigned URL helpers
- `backend/db/migrations_phase2.sql` — NEW: `documents` table (additive, safe to re-run)
- `backend/db/migrate.js` — updated to run both schema.sql and migrations_phase2.sql
- `backend/routes/documents.js` — NEW: per-project document upload/list/download/delete
- `backend/server.js` — mounts the documents routes
- `frontend/src/components/DocumentsTab.jsx` — NEW: Documents tab UI (upload/download/delete)
- `frontend/src/pages/ProjectDetailPage.jsx` — adds the Documents tab

Design: files live in Cloudflare R2; the `documents` table stores only metadata + the
R2 object key. Uploads/downloads go browser <-> R2 directly via presigned URLs (the
backend never handles file bytes). Per-project access follows existing role rules.
If R2 env vars are absent, the documents feature disables gracefully (503) rather than
crashing the server.

## Remaining steps to finish Phase 2 Documents
1. Push this code to GitHub (from the Windows folder):
   git add .
   git commit -m "Phase 2: Documents module (Cloudflare R2)"
   git push
2. Add 4 env vars to Railway (RadahPM service -> Variables) — enter values directly,
   do NOT paste the secret into chat:
   - R2_ACCOUNT_ID         = 769a6ad0ef21130bb8e3aafb2782... (full Cloudflare account ID)
   - R2_ACCESS_KEY_ID      = (from the R2 API token created in Cloudflare)
   - R2_SECRET_ACCESS_KEY  = (the one-time secret from that token)
   - R2_BUCKET             = radah-pm-documents
3. Railway auto-redeploys. Confirm it goes Active and /api/health still works.
4. IMPORTANT — CORS on the R2 bucket: browser PUT uploads will be blocked until the
   bucket has a CORS policy allowing the frontend origins. In Cloudflare R2 -> the
   bucket -> Settings -> CORS Policy, add a policy allowing:
     AllowedOrigins: https://app.radahpm.com and https://radah-pm.vercel.app
     AllowedMethods: GET, PUT
     AllowedHeaders: *
   (This step is easy to forget and will cause "upload failed" errors if skipped.)
5. Test: open a project -> Documents tab -> upload a file -> confirm it lists,
   downloads, and deletes.

## Still pending from Phase 1 (not blocking)
- Change admin password from the temporary one (Settings page) — admin is
  orvcamp@gmail.com. Treat the temp password as compromised (it appeared in logs).
- Add real client + trade_partner test users and verify role permissions live.

## Phase 2 still to come after Documents (agreed tier order)
- Tier 1: Documents (this), Budgets & cost tracking
- Tier 2: Change orders, Daily logs
- Tier 3: RFIs & submittals, Notifications/email (built last so it spans all modules)
