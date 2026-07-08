// src/components/ScheduleImportModal.jsx
//
// Import a schedule into the project as read-only activities.
//
// MS Project XML is parsed directly (DOMParser — no dependency). Spreadsheets
// (.xlsx/.csv) go through the same column-mapping step as the estimate import.
// Everything is parsed in the browser; the file is never uploaded.
//
// Importing REPLACES the existing activity set — a schedule update is a
// re-baseline, not an append. The confirmation says so plainly.

import { useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { readWorkbook, sheetToRows, parseDateToISO, daysBetween, parseNumber, parseMsProjectXml } from "../lib/sheetjs.js";

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.7rem", fontSize: "0.85rem" };
const labelStyle = { display: "block", fontSize: "0.74rem", color: "var(--steel)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.03em" };

const FIELDS = [
  { key: "wbs", label: "WBS / ID" },
  { key: "name", label: "Activity Name", required: true },
  { key: "start", label: "Start", required: true },
  { key: "finish", label: "Finish", required: true },
  { key: "percent", label: "% Complete" },
  { key: "predecessors", label: "Predecessors" },
];

const GUESS = {
  wbs: /(wbs|activity\s*id|^id$|task\s*id)/i,
  name: /(activity\s*name|task\s*name|name|description)/i,
  start: /^(start|begin|early\s*start)/i,
  finish: /^(finish|end|early\s*finish|completion)/i,
  percent: /(%|percent|complete|progress)/i,
  predecessors: /(predecessor|depends)/i,
};

export default function ScheduleImportModal({ projectId, existingCount, onClose, onImported }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // XML path: activities straight away. Spreadsheet path: grid + mapping.
  const [xmlActivities, setXmlActivities] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [grid, setGrid] = useState([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState({});
  const wbRef = useRef(null);

  function autoMap(cells) {
    const m = {};
    cells.forEach((c, i) => {
      const t = String(c || "").trim();
      if (!t) return;
      for (const [k, re] of Object.entries(GUESS)) {
        if (m[k] === undefined && re.test(t)) { m[k] = i; break; }
      }
    });
    return m;
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setBusy(true); setResult(null);
    setXmlActivities(null); setGrid([]); setSheets([]);
    try {
      setFileName(file.name);
      if (/\.xml$/i.test(file.name)) {
        setXmlActivities(await parseMsProjectXml(file));
      } else {
        const { XLSX, workbook } = await readWorkbook(file, { cellDates: true });
        wbRef.current = { XLSX, workbook };
        setSheets(workbook.SheetNames);
        setActiveSheet(0);
        loadSheet(XLSX, workbook, 0);
      }
    } catch (err) {
      setError(err.message || "Could not read that file.");
      setFileName("");
    } finally {
      setBusy(false);
    }
  }

  function loadSheet(XLSX, workbook, i) {
    const rows = sheetToRows(XLSX, workbook.Sheets[workbook.SheetNames[i]]);
    setGrid(rows);
    setHeaderRow(0);
    setMapping(autoMap(rows[0] || []));
  }
  function switchSheet(i) {
    if (!wbRef.current) return;
    setActiveSheet(i);
    loadSheet(wbRef.current.XLSX, wbRef.current.workbook, i);
  }
  function onHeaderRowChange(n) {
    setHeaderRow(n);
    setMapping(autoMap(grid[n] || []));
  }

  const headerCells = grid[headerRow] || [];
  const colOptions = headerCells.map((c, i) => ({ i, label: String(c || "").trim() || `Column ${i + 1}` }));

  // Spreadsheet -> activities
  const sheetParsed = useMemo(() => {
    if (!grid.length || mapping.name === undefined) return { activities: [], skipped: [] };
    const activities = [];
    const skipped = [];
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const cell = (k) => (mapping[k] === undefined ? "" : row[mapping[k]]);
      const name = String(cell("name") || "").trim();
      if (!name) continue;
      const startDate = parseDateToISO(cell("start"));
      const finishDate = parseDateToISO(cell("finish"));
      if (!startDate || !finishDate) { skipped.push({ row: r + 1, why: "missing or unreadable start/finish date" }); continue; }
      const pct = parseNumber(cell("percent"));
      activities.push({
        externalId: null,
        wbs: String(cell("wbs") || "").trim() || null,
        name,
        startDate,
        finishDate,
        durationDays: daysBetween(startDate, finishDate),
        percentComplete: pct === null ? 0 : Math.max(0, Math.min(100, Math.round(pct <= 1 && pct > 0 ? pct * 100 : pct))),
        isMilestone: startDate === finishDate,
        isSummary: false,
        outlineLevel: null,
        predecessors: String(cell("predecessors") || "").trim() || null,
      });
    }
    return { activities, skipped };
  }, [grid, headerRow, mapping]);

  const activities = xmlActivities || sheetParsed.activities;
  const skipped = xmlActivities ? [] : sheetParsed.skipped;
  const summaries = activities.filter((a) => a.isSummary).length;
  const milestones = activities.filter((a) => a.isMilestone).length;
  const canImport = activities.length > 0 && !busy;

  async function doImport() {
    if (existingCount > 0 && !confirm(
      `This replaces the ${existingCount} activit${existingCount === 1 ? "y" : "ies"} currently imported for this project with ${activities.length} new one${activities.length === 1 ? "" : "s"}.\n\nThe uploaded schedule FILES and their revision history are not affected. Continue?`
    )) return;

    setBusy(true); setError("");
    try {
      const d = await api.post(`/projects/${projectId}/schedule-activities/import`, { activities });
      setResult(d);
      onImported && onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860, width: "94vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>Import Schedule</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {result ? (
          <>
            <div className="success-msg">{result.message}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-gold" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: "1rem" }}>
              <input ref={fileRef} type="file" accept=".xml,.xlsx,.xlsm,.xls,.csv" style={{ display: "none" }} onChange={pickFile} />
              <button className="btn btn-outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? "Reading…" : fileName ? "Choose a different file" : "Choose schedule file"}
              </button>
              {fileName && <span className="text-sm text-steel" style={{ marginLeft: "0.7rem" }}>{fileName}</span>}
              {!fileName && (
                <p className="text-sm text-steel" style={{ marginTop: "0.5rem" }}>
                  <strong>MS Project:</strong> File → Save As → XML (.xml) — parsed automatically.<br />
                  <strong>Primavera P6 or anything else:</strong> export a spreadsheet (.xlsx / .csv) and map the columns.<br />
                  Read in your browser; the file isn't uploaded.
                </p>
              )}
            </div>

            {/* spreadsheet mapping */}
            {grid.length > 0 && (
              <>
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
                      {grid.slice(0, 15).map((_, i) => <option key={i} value={i}>Row {i + 1}{i === 0 ? " (first row)" : ""}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--gold, #C9A227)", fontWeight: 700, marginBottom: "0.5rem" }}>Map columns</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.7rem" }}>
                    {FIELDS.map((f) => (
                      <div key={f.key}>
                        <label style={labelStyle}>{f.label}{f.required && <span style={{ color: "var(--red)" }}> *</span>}</label>
                        <select
                          value={mapping[f.key] === undefined ? "" : mapping[f.key]}
                          onChange={(e) => setMapping((m) => {
                            const next = { ...m };
                            if (e.target.value === "") delete next[f.key]; else next[f.key] = Number(e.target.value);
                            return next;
                          })}
                          style={inputStyle}
                        >
                          <option value="">— not mapped —</option>
                          {colOptions.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* preview */}
            {activities.length > 0 && (
              <>
                <div className="flex-between" style={{ marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.4rem" }}>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--gold, #C9A227)", fontWeight: 700 }}>Preview</div>
                  <div className="text-sm">
                    <strong>{activities.length}</strong> activities
                    {summaries > 0 && <span className="text-steel"> · {summaries} summary</span>}
                    {milestones > 0 && <span className="text-steel"> · {milestones} milestone{milestones === 1 ? "" : "s"}</span>}
                    {skipped.length > 0 && <span className="text-steel"> · {skipped.length} skipped</span>}
                  </div>
                </div>

                <div style={{ maxHeight: "34vh", overflow: "auto", border: "1px solid var(--line)", borderRadius: 6, marginBottom: "0.6rem" }}>
                  <table className="data-table" style={{ fontSize: "0.8rem" }}>
                    <thead><tr><th>WBS</th><th>Activity</th><th>Start</th><th>Finish</th><th>Days</th><th>%</th></tr></thead>
                    <tbody>
                      {activities.slice(0, 12).map((a, i) => (
                        <tr key={i}>
                          <td>{a.wbs || "—"}</td>
                          <td style={{ paddingLeft: a.outlineLevel ? (a.outlineLevel - 1) * 12 : 0, fontWeight: a.isSummary ? 700 : 400 }}>
                            {a.isMilestone ? "◆ " : ""}{a.name}
                          </td>
                          <td>{a.startDate || "—"}</td>
                          <td>{a.finishDate || "—"}</td>
                          <td>{a.durationDays ?? "—"}</td>
                          <td>{a.percentComplete}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activities.length > 12 && <p className="text-sm text-steel" style={{ fontSize: "0.74rem" }}>Showing the first 12 of {activities.length}.</p>}

                {skipped.length > 0 && (
                  <details style={{ marginBottom: "0.7rem" }}>
                    <summary className="text-sm text-steel" style={{ cursor: "pointer" }}>{skipped.length} row(s) skipped — see why</summary>
                    <div className="text-sm text-steel" style={{ marginTop: "0.4rem", maxHeight: 120, overflow: "auto" }}>
                      {skipped.slice(0, 40).map((s, i) => <div key={i}>Row {s.row}: {s.why}</div>)}
                    </div>
                  </details>
                )}

                <div className="error-msg" style={{ marginBottom: "0.8rem" }}>
                  Importing <strong>replaces</strong> any activities already imported for this project. Uploaded schedule
                  files and their revision history are untouched.
                </div>
              </>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn btn-gold" disabled={!canImport} onClick={doImport}>
                {busy ? "Importing…" : `Import ${activities.length || ""} activit${activities.length === 1 ? "y" : "ies"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
