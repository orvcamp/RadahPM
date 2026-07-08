// src/components/DocumentViewerModal.jsx
//
// Shared in-app document previewer. Used by the Documents tab and the project
// Schedule card. Renders images, PDFs, and text inline via a short-lived
// presigned URL; falls back to a download prompt for other file types.

import { useEffect, useState, useRef } from "react";
import { api } from "../api/client";

const SHEET_EXT = /\.(xlsx|xlsm|xlsb|xls|csv|ods)$/;
const SHEET_CT = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
];

export function canPreview(contentType, fileName) {
  const ct = (contentType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  // Spreadsheets first: a .csv is also text/*, and the grid view is better.
  if (SHEET_EXT.test(name) || SHEET_CT.includes(ct)) return "sheet";
  if (ct.startsWith("image/")) return "image";
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("text/") || ct === "application/json") return "text";
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return "image";
  if (/\.(txt|md|log|json)$/.test(name)) return "text";
  return null;
}

// SheetJS is loaded from its official CDN at runtime, on first use.
//
// Why not an npm dependency? The `xlsx` package on the public npm registry is
// stale (0.18.5); SheetJS distributes current builds from cdn.sheetjs.com. This
// keeps the build free of a vendored tarball and means no local Node toolchain
// is required to ship. The version is pinned in the URL, and the module is
// cached by the browser after the first spreadsheet is opened.
const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
let sheetJsPromise = null;
function loadSheetJS() {
  if (!sheetJsPromise) {
    // @vite-ignore keeps the bundler from trying to resolve this at build time.
    sheetJsPromise = import(/* @vite-ignore */ SHEETJS_URL).catch((e) => {
      sheetJsPromise = null; // allow a retry on the next attempt
      throw new Error("Could not load the spreadsheet viewer. Check your connection and try again.");
    });
  }
  return sheetJsPromise;
}

// Guard rails so a 50,000-row workbook doesn't hang the browser.
const MAX_ROWS = 300;
const MAX_COLS = 40;

// Renders a spreadsheet as a read-only grid. SheetJS is imported lazily so it
// never lands in the main bundle for people who only look at PDFs.
function SheetPreview({ url, fileName }) {
  const [state, setState] = useState({ loading: true, error: "", sheets: [], rows: [], truncated: false });
  const [active, setActive] = useState(0);
  const wbRef = useRef(null);

  function renderSheet(XLSX, wb, index) {
    const ws = wb.Sheets[wb.SheetNames[index]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
    const truncated = aoa.length > MAX_ROWS || aoa.some((r) => r.length > MAX_COLS);
    const rows = aoa.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));
    return { rows, truncated };
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Could not download the file for preview.");
        const buf = await res.arrayBuffer();
        const XLSX = await loadSheetJS();
        const wb = XLSX.read(buf, { type: "array" });
        if (!alive) return;
        wbRef.current = { XLSX, wb };
        const { rows, truncated } = renderSheet(XLSX, wb, 0);
        setState({ loading: false, error: "", sheets: wb.SheetNames, rows, truncated });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message || "Preview failed.", sheets: [], rows: [], truncated: false });
      }
    })();
    return () => { alive = false; };
  }, [url]);

  function pickSheet(i) {
    if (!wbRef.current) return;
    setActive(i);
    const { XLSX, wb } = wbRef.current;
    const { rows, truncated } = renderSheet(XLSX, wb, i);
    setState((s) => ({ ...s, rows, truncated }));
  }

  if (state.loading) return <div className="loading-spinner" />;
  if (state.error) return <div className="error-msg">{state.error}</div>;

  return (
    <div>
      {state.sheets.length > 1 && (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
          {state.sheets.map((name, i) => (
            <button
              key={name}
              className={`btn btn-sm ${i === active ? "btn-gold" : "btn-outline"}`}
              onClick={() => pickSheet(i)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div style={{ maxHeight: "62vh", overflow: "auto", border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}>
        <table className="data-table" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
          <tbody>
            {state.rows.map((row, r) => (
              <tr key={r}>
                <td style={{ background: "var(--paper, #f7f6f2)", color: "var(--steel)", fontSize: "0.7rem", position: "sticky", left: 0 }}>{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} style={{ fontWeight: r === 0 ? 700 : 400 }}>{String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.truncated && (
        <p className="text-sm text-steel" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
          Showing the first {MAX_ROWS} rows and {MAX_COLS} columns. Download “{fileName}” to see the full sheet.
        </p>
      )}
    </div>
  );
}

export default function DocumentViewerModal({ doc, onClose, onDownload }) {
  const [state, setState] = useState({ loading: true, url: null, contentType: null, error: "" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get(`/documents/${doc.id}/view-url`);
        if (active) setState({ loading: false, url: d.viewUrl, contentType: d.contentType, error: "" });
      } catch (err) {
        if (active) setState({ loading: false, url: null, contentType: null, error: err.message });
      }
    })();
    return () => { active = false; };
  }, [doc.id]);

  const kind = canPreview(state.contentType || doc.contentType, doc.fileName);

  async function handleDownload() {
    if (onDownload) return onDownload(doc);
    try {
      const { downloadUrl } = await api.get(`/documents/${doc.id}/download-url`);
      window.open(downloadUrl, "_blank");
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "92vw" }}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1rem", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.fileName}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {state.loading && <div className="loading-spinner" />}
        {state.error && <div className="error-msg">{state.error}</div>}

        {!state.loading && !state.error && (
          <div style={{ marginBottom: "1rem" }}>
            {kind === "image" && (
              <img src={state.url} alt={doc.fileName} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto", borderRadius: 6 }} />
            )}
            {kind === "sheet" && <SheetPreview url={state.url} fileName={doc.fileName} />}
            {(kind === "pdf" || kind === "text") && (
              <iframe title={doc.fileName} src={state.url} style={{ width: "100%", height: "70vh", border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }} />
            )}
            {!kind && (
              <div className="empty-state" style={{ padding: "2rem 1rem" }}>
                <h3>Preview not available</h3>
                <p className="text-sm">This file type can't be previewed in the browser. You can download it instead.</p>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
          {state.url && <a className="btn btn-outline btn-sm" href={state.url} target="_blank" rel="noreferrer">Open in New Tab</a>}
          <button className="btn btn-outline btn-sm" onClick={handleDownload}>Download</button>
          <button className="btn btn-gold btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
