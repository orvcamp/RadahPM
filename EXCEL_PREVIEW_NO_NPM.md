# Excel / CSV preview — REVISED, no npm install required

## Why this replaces the earlier drop
The earlier version imported `xlsx` as an npm dependency. That needs Node/npm on
your machine to add it to package.json + package-lock.json. You don't have npm
installed, so the dependency was never added — and pushing that file would have
FAILED the Vercel build ("Failed to resolve import 'xlsx'").

This version loads SheetJS from its official CDN at runtime instead. Nothing to
install, no package.json change, no lockfile. Your normal git workflow works.

## What it does (unchanged)
.xlsx / .xlsm / .xlsb / .xls / .csv / .ods render as a read-only grid in the
document viewer, with tabs for multiple worksheets. First 300 rows and 40 columns,
with a note offering the download for anything larger. Works everywhere the viewer
is used (Documents tab, Schedule card).

## How the loader works
    const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
    const XLSX = await import(/* @vite-ignore */ SHEETJS_URL);

- Loaded on first spreadsheet opened, then cached by the browser.
- The version is pinned in the URL.
- `@vite-ignore` stops the bundler resolving it at build time.

## Honest tradeoffs
- The preview needs cdn.sheetjs.com reachable. If it isn't, the preview shows a
  clear error and the rest of the app is unaffected. Nothing else depends on it.
- No build-time integrity pin (no SRI hash).
- If you later install Node locally and prefer a real dependency, run:
      cd frontend
      npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  then change the loader back to `await import("xlsx")`.

## File (replace the one you staged)
frontend/src/components/DocumentViewerModal.jsx

## Deploy
Copy the file in (Replace), then:

    git status        # should show ONLY DocumentViewerModal.jsx modified
    git add .
    git commit -m "Excel/CSV preview in the document viewer"
    git push

No npm, no migration, no env vars.

## Test
1. Documents → upload an .xlsx with two worksheets → View. Grid renders; the
   sheet tabs switch worksheets. (First open takes a second while SheetJS loads.)
2. Upload a .csv → View → renders as a grid, not raw text.

## Housekeeping
EXCEL_PREVIEW.md is untracked in your repo. Either delete it or commit it — it's
just the old deploy note and harmless either way.
