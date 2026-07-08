// src/components/EstimateImportModal.jsx
//
// Import an estimate spreadsheet into the project budget.
//
// The file is parsed in the browser (SheetJS, loaded from CDN), so nothing is
// uploaded and no backend parser is needed. The operator picks the worksheet,
// the header row, and maps columns. A live preview shows exactly what will be
// created — including which rows are being skipped and why — before anything
// touches the database.
//
// The import APPENDS. It never replaces or deletes existing budget lines.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { readWorkbook, sheetToRows, parseMoneyToCents, parseNumber } from "../lib/sheetjs.js";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.7rem", fontSize: "0.85rem" };
const labelStyle = { display: "block", fontSize: "0.74rem", color: "var(--steel)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.03em" };

const money = (cents) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Columns we can map. `required` blocks the import until mapped.
const FIELDS = [
  { key: "category", label: "Category", hint: "Groups lines. Falls back to the default below." },
  { key: "costCode", label: "Cost Code", hint: "e.g. 03 30 00" },
  { key: "description", label: "Description", required: true },
  { key: "quantity", label: "Quantity" },
  { key: "unit", label: "Unit", hint: "EA, SF, CY…" },
  { key: "unitCost", label: "Unit Cost" },
  { key: "total", label: "Total / Amount", hint: "If blank, Qty × Unit Cost is used." },
];

// Guess a mapping from the header text.
const GUESS = {
  category: /^(category|division|section|group|phase)/i,
  costCode: /(cost\s*code|code|csi)/i,
  description: /(description|item|scope|work)/i,
  quantity: /^(qty|quantity)/i,
  unit: /^(unit|uom|u\/m)$/i,
  unitCost: /(unit\s*(cost|price)|rate|\$\/unit)/i,
  total: /(total|amount|extended|ext\.?\s*cost|subtotal|cost)$/i,
};

export default function EstimateImportModal({ projectId, categories, onClose, onImported }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");

  const [sheets, setSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [grid, setGrid] = useState([]);            // array of arrays for the active sheet
  const wbRef = useRef(null);

  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState({});      // field key -> column index
  const [defaultCategory, setDefaultCategory] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!defaultCategory && categories && categories.length > 0) setDefaultCategory(categories[0].name);
  }, [categories, defaultCategory]);

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setParsing(true); setResult(null);
    try {
      const { XLSX, workbook } = await readWorkbook(file);
      wbRef.current = { XLSX, workbook };
      setFileName(file.name);
      setSheets(workbook.SheetNames);
      loadSheet(XLSX, workbook, 0);
      setActiveSheet(0);
    } catch (err) {
      setError(err.message || "Could not read that file.");
    } finally {
      setParsing(false);
    }
  }

  function loadSheet(XLSX, workbook, index) {
    const rows = sheetToRows(XLSX, workbook.Sheets[workbook.SheetNames[index]]);
    setGrid(rows);
    setHeaderRow(0);
    setMapping(autoMap(rows[0] || []));
  }

  function switchSheet(i) {
    if (!wbRef.current) return;
    setActiveSheet(i);
    loadSheet(wbRef.current.XLSX, wbRef.current.workbook, i);
  }

  function autoMap(headerCells) {
    const m = {};
    headerCells.forEach((cell, idx) => {
      const text = String(cell || "").trim();
      if (!text) return;
      for (const [key, re] of Object.entries(GUESS)) {
        if (m[key] === undefined && re.test(text)) { m[key] = idx; break; }
      }
    });
    return m;
  }

  function onHeaderRowChange(n) {
    setHeaderRow(n);
    setMapping(autoMap(grid[n] || []));
  }

  const headerCells = grid[headerRow] || [];
  const colOptions = headerCells.map((c, i) => ({ i, label: String(c || "").trim() || `Column ${i + 1}` }));

  // Build the rows we'd send, plus a record of what's being skipped.
  const parsed = useMemo(() => {
    if (!grid.length || mapping.description === undefined) return { rows: [], skipped: [], totalCents: 0, mismatches: 0 };
    const rows = [];
    const skipped = [];
    let totalCents = 0;
    let mismatches = 0;

    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const cell = (key) => (mapping[key] === undefined ? "" : row[mapping[key]]);

      const description = String(cell("description") || "").trim();
      const qty = parseNumber(cell("quantity"));
      const unitCents = parseMoneyToCents(cell("unitCost"));
      const totalCents_ = parseMoneyToCents(cell("total"));

      const computed = qty !== null && unitCents !== null ? Math.round(qty * unitCents) : null;
      const amount = totalCents_ !== null ? totalCents_ : computed;

      if (!description && amount === null) continue;             // blank spacer row — silently ignored
      if (!description) { skipped.push({ row: r + 1, why: "no description" }); continue; }
      if (amount === null) { skipped.push({ row: r + 1, why: "no usable amount" }); continue; }
      if (totalCents_ !== null && computed !== null && Math.abs(totalCents_ - computed) > 1) mismatches++;

      const category = String(cell("category") || "").trim() || null;
      rows.push({
        category,
        costCode: String(cell("costCode") || "").trim() || null,
        description,
        quantity: qty,
        unit: String(cell("unit") || "").trim() || null,
        unitCostCents: unitCents,
        budgetedCents: amount,
      });
      totalCents += amount;
    }
    return { rows, skipped, totalCents, mismatches };
  }, [grid, headerRow, mapping]);

  const needsDefaultCategory = parsed.rows.some((r) => !r.category);
  const canImport =
    parsed.rows.length > 0 &&
    mapping.description !== undefined &&
    (!needsDefaultCategory || defaultCategory.trim().length > 0);

  async function doImport() {
    setImporting(true); setError("");
    try {
      const d = await api.post(`/projects/${projectId}/budget/import`, {
        rows: parsed.rows,
        defaultCategory: defaultCategory.trim() || null,
      });
      setResult(d);
      onImported && onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "94vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>Import Estimate</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {result ? (
          <>
            <div className="success-msg">
              {result.message} {result.categoriesCreated > 0 && `Created ${result.categoriesCreated} new categor${result.categoriesCreated === 1 ? "y" : "ies"}.`}
              {" "}Total added: <strong>{money(result.totalCents)}</strong>.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-gold" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            {/* Step 1 — file */}
            <div style={{ marginBottom: "1rem" }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xlsb,.xls,.csv,.ods" style={{ display: "none" }} onChange={pickFile} />
              <button className="btn btn-outline" disabled={parsing} onClick={() => fileRef.current?.click()}>
                {parsing ? "Reading…" : fileName ? "Choose a different file" : "Choose estimate file"}
              </button>
              {fileName && <span className="text-sm text-steel" style={{ marginLeft: "0.7rem" }}>{fileName}</span>}
              {!fileName && (
                <p className="text-sm text-steel" style={{ marginTop: "0.5rem" }}>
                  .xlsx, .xls, .csv, or .ods. The file is read in your browser — it isn't uploaded.
                </p>
              )}
            </div>

            {grid.length > 0 && (
              <>
                {/* Step 2 — sheet + header row */}
                <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                  {sheets.length > 1 && (
                    <div style={{ minWidth: 190 }}>
                      <label style={labelStyle}>Worksheet</label>
                      <select value={activeSheet} onChange={(e) => switchSheet(Number(e.target.value))} style={inputStyle}>
                        {sheets.map((n, i) => <option key={n} value={i}>{n}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ minWidth: 190 }}>
                    <label style={labelStyle}>Header row</label>
                    <select value={headerRow} onChange={(e) => onHeaderRowChange(Number(e.target.value))} style={inputStyle}>
                      {grid.slice(0, 15).map((_, i) => (
                        <option key={i} value={i}>Row {i + 1}{i === 0 ? " (first row)" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={labelStyle}>Default category {needsDefaultCategory && <span style={{ color: "var(--red)" }}>· required</span>}</label>
                    <input
                      list="existing-categories"
                      value={defaultCategory}
                      onChange={(e) => setDefaultCategory(e.target.value)}
                      style={inputStyle}
                      placeholder="Used for rows with no category"
                    />
                    <datalist id="existing-categories">
                      {(categories || []).map((c) => <option key={c.id} value={c.name} />)}
                    </datalist>
                  </div>
                </div>

                {/* Step 3 — column mapping */}
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--gold, #C9A227)", fontWeight: 700, marginBottom: "0.5rem" }}>
                    Map columns
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.7rem" }}>
                    {FIELDS.map((f) => (
                      <div key={f.key}>
                        <label style={labelStyle}>
                          {f.label}{f.required && <span style={{ color: "var(--red)" }}> *</span>}
                        </label>
                        <select
                          value={mapping[f.key] === undefined ? "" : mapping[f.key]}
                          onChange={(e) => setMapping((m) => {
                            const next = { ...m };
                            if (e.target.value === "") delete next[f.key];
                            else next[f.key] = Number(e.target.value);
                            return next;
                          })}
                          style={inputStyle}
                        >
                          <option value="">— not mapped —</option>
                          {colOptions.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
                        </select>
                        {f.hint && <div className="text-steel" style={{ fontSize: "0.68rem", marginTop: 2 }}>{f.hint}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 4 — preview */}
                {mapping.description === undefined ? (
                  <div className="error-msg">Map a <strong>Description</strong> column to continue.</div>
                ) : (
                  <>
                    <div className="flex-between" style={{ marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--gold, #C9A227)", fontWeight: 700 }}>
                        Preview
                      </div>
                      <div className="text-sm">
                        <strong>{parsed.rows.length}</strong> line{parsed.rows.length === 1 ? "" : "s"} ·{" "}
                        total <strong>{money(parsed.totalCents)}</strong>
                        {parsed.skipped.length > 0 && <span className="text-steel"> · {parsed.skipped.length} skipped</span>}
                      </div>
                    </div>

                    {parsed.mismatches > 0 && (
                      <div className="error-msg">
                        {parsed.mismatches} row{parsed.mismatches === 1 ? "" : "s"} have a Total that doesn't match Qty × Unit Cost.
                        The Total column wins. Check those rows before importing.
                      </div>
                    )}

                    <div style={{ maxHeight: "34vh", overflow: "auto", border: "1px solid var(--line)", borderRadius: 6, marginBottom: "0.6rem" }}>
                      <table className="data-table" style={{ fontSize: "0.8rem" }}>
                        <thead>
                          <tr><th>Category</th><th>Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Cost</th><th style={{ textAlign: "right" }}>Amount</th></tr>
                        </thead>
                        <tbody>
                          {parsed.rows.slice(0, 12).map((r, i) => (
                            <tr key={i}>
                              <td>{r.category || <span className="text-steel">{defaultCategory || "—"}</span>}</td>
                              <td>{r.costCode || "—"}</td>
                              <td>{r.description}</td>
                              <td>{r.quantity ?? "—"}</td>
                              <td>{r.unit || "—"}</td>
                              <td>{r.unitCostCents === null ? "—" : money(r.unitCostCents)}</td>
                              <td style={{ textAlign: "right" }}>{money(r.budgetedCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {parsed.rows.length > 12 && (
                      <p className="text-sm text-steel" style={{ fontSize: "0.74rem" }}>Showing the first 12 of {parsed.rows.length} rows.</p>
                    )}

                    {parsed.skipped.length > 0 && (
                      <details style={{ marginBottom: "0.8rem" }}>
                        <summary className="text-sm text-steel" style={{ cursor: "pointer" }}>
                          {parsed.skipped.length} row{parsed.skipped.length === 1 ? "" : "s"} will be skipped — see why
                        </summary>
                        <div className="text-sm text-steel" style={{ marginTop: "0.4rem", maxHeight: 120, overflow: "auto" }}>
                          {parsed.skipped.slice(0, 40).map((s, i) => (
                            <div key={i}>Spreadsheet row {s.row}: {s.why}</div>
                          ))}
                          {parsed.skipped.length > 40 && <div>…and {parsed.skipped.length - 40} more.</div>}
                        </div>
                      </details>
                    )}

                    <p className="text-sm text-steel" style={{ fontSize: "0.74rem", marginBottom: "0.8rem" }}>
                      This <strong>adds</strong> lines to the existing budget. Nothing is replaced or deleted.
                    </p>
                  </>
                )}
              </>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn btn-gold" disabled={!canImport || importing} onClick={doImport}>
                {importing ? "Importing…" : `Import ${parsed.rows.length || ""} line${parsed.rows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
