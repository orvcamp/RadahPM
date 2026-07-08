# Excel / CSV preview in the document viewer

Spreadsheets now render as a read-only grid inside the platform, alongside the
existing image, PDF, and text previews. Works for .xlsx, .xlsm, .xlsb, .xls,
.csv, and .ods. Multiple worksheets get tabs. Everywhere the viewer is used
(Documents tab, Schedule card) picks this up automatically.

Guard rails: the first 300 rows and 40 columns render, with a note offering the
download for anything larger. SheetJS is loaded with a dynamic import, so it is
NOT in the main bundle — people who only open PDFs never download it.

## ⚠ ONE REQUIRED STEP BEFORE DEPLOY — add the dependency
The `xlsx` package on the public npm registry is STALE (stuck at 0.18.5).
SheetJS distributes current versions from their own CDN. Install from there:

    cd frontend
    npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

That updates package.json AND package-lock.json. Commit both.
Do NOT run `npm install xlsx` — you'd get the outdated registry copy.

Check https://cdn.sheetjs.com/ for a newer version than 0.20.3 and use that if
one exists.

### If the Vercel build fails fetching the tarball
Some CI networks time out against cdn.sheetjs.com. Vendor it instead:

    cd frontend
    curl -O https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
    mkdir -p vendor && mv xlsx-0.20.3.tgz vendor/
    npm i --save file:vendor/xlsx-0.20.3.tgz
    git add vendor/xlsx-0.20.3.tgz package.json package-lock.json

## File
frontend/src/components/DocumentViewerModal.jsx

No backend change, no migration, no env vars.

## Deploy
    cd frontend && npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
    cd ..
    git add .
    git commit -m "Excel/CSV preview in the document viewer"
    git push

## Test
1. Documents → upload an .xlsx with two worksheets → click View.
   The grid renders; sheet tabs switch between worksheets.
2. Upload a .csv → View → it renders as a grid rather than raw text.
3. Upload a very large sheet → the first 300 rows render with a truncation note.

## Note on how it fetches
The preview downloads the file from R2 using the existing presigned view URL via
fetch(). Your R2 bucket CORS policy already allows GET from app.mangodoe.com, so
no CORS change is needed. If a preview ever fails with a CORS error, that policy
is where to look.
