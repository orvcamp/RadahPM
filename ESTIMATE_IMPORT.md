# Estimate spreadsheet import

Budget tab → **Import Estimate** (admin/staff). Pick a spreadsheet, map the
columns, check the preview, import. Lines are APPENDED to the existing budget —
nothing is ever replaced or deleted.

## Flow
1. Choose file (.xlsx / .xlsm / .xlsb / .xls / .csv / .ods).
   It is parsed IN YOUR BROWSER. The file is never uploaded.
2. Pick the worksheet and the header row (needed — estimates rarely start on row 1).
3. Map columns. The mapping is auto-guessed from the header text and you can
   correct it: Category · Cost Code · Description* · Qty · Unit · Unit Cost · Total.
   (* Description is the only required mapping.)
4. Live preview shows what will be created, the grand total, and exactly which
   rows are being skipped and why.
5. Import. Everything happens in one transaction — if any row fails, nothing is written.

## Amount rules
- If **Total** is mapped and parses, it wins.
- Otherwise **Qty × Unit Cost** is computed.
- If both exist and disagree by more than a cent, the preview warns you and the
  Total is used.
- Money parsing handles `1234.5`, `$1,234.56`, and `(500)` as negative.
- Blank spacer rows are ignored silently. Rows with a description but no usable
  amount (subtotal rows, notes) are listed in the "skipped" panel — nothing
  vanishes without telling you.

## Categories
A mapped Category column is used per row. Any category that doesn't exist yet is
created. Rows with no category fall back to the **Default category** you choose
(free text, with your existing categories as suggestions).

## Schema change
`budget_lines` gains four nullable columns so the import stays faithful to what
estimators actually produce:
    cost_code · quantity · unit · unit_cost_cents
The Budget tab now shows the cost code before the description, and a
"120 SF @ $12.50" detail line where those values exist. Hand-created lines are
unaffected.

## Also in this drop
The SheetJS loader was extracted to `frontend/src/lib/sheetjs.js` so the document
viewer and the importer share one copy (plus money/number parsing helpers).
DocumentViewerModal.jsx now imports from it. Behavior unchanged.

## New + changed files
New: backend/db/migrations_phase3_budget_estimate.sql
     frontend/src/lib/sheetjs.js
     frontend/src/components/EstimateImportModal.jsx
Changed: backend/db/migrate.js, backend/routes/budget.js (estimate fields + import),
         frontend/src/components/BudgetTab.jsx (button + cost-code display),
         frontend/src/components/DocumentViewerModal.jsx (uses shared loader)

No npm install. No env vars.

## Deploy
git add . && git commit -m "Estimate spreadsheet import with column mapping" && git push
Log should show: Migration (estimate fields on budget lines) complete.

## Test
1. Budget tab → Import Estimate → pick a real estimate .xlsx.
2. Set the header row until the column dropdowns show real names.
3. Confirm the auto-guess mapped Description and Total. Fix anything it missed.
4. Read the skipped panel — subtotal rows should appear there, not in the import.
5. Import → the rollup total increases by exactly the preview total.
6. Lines show "03 30 00 — Concrete" with "120 CY @ $145.00" underneath.
7. Import the same file again → it appends a second copy (by design). Delete the
   extra lines, or import into a scratch project first if you're experimenting.
