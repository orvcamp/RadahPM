# Document Viewer + Folder Back Navigation

## 1. View documents in the platform
Previously every file was force-downloaded (the presigned URL used
`Content-Disposition: attachment`). Now there's a separate INLINE url and an
in-app viewer.

- New **View** button on each file (and the filename itself is clickable).
- Opens a preview modal:
    • Images (png/jpg/gif/webp/svg) render directly
    • PDFs render in an embedded viewer
    • Text/CSV/JSON/MD render inline
    • Anything else shows a clean "Preview not available — download instead"
- The modal also offers **Open in New Tab** and **Download**.

Access control is unchanged: the view URL runs through the same project-access
check as downloads, and links are short-lived (10 min).

## 2. Folder navigation
Added an **← Back** button beside the breadcrumb in the Documents tab (styled
like the project stage bar's Back). It moves up one folder level and is disabled
at the project root. The breadcrumb still works for jumping to any level.

## Files
backend/db/r2.js                      (new getViewUrl — inline disposition)
backend/routes/documents.js           (new GET /documents/:id/view-url)
frontend/src/components/DocumentsTab.jsx (viewer modal, View button, Back button)

## Deploy
git add . && git commit -m "Document viewer + folder back navigation" && git push
No migration, no env vars. R2 CORS already allows GET, so no CORS change needed.

## Test
Documents tab → open a folder → click a file's **View** (or its name).
- Upload a PDF and an image; both should render in the modal.
- Click **← Back** to go up a level; it's greyed out at Project root.
