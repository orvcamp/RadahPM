// src/lib/sheetjs.js
//
// Loads SheetJS from its official CDN on first use, then caches the module.
//
// Why not an npm dependency? The `xlsx` package on the public npm registry is
// stale (0.18.5); SheetJS distributes current builds from cdn.sheetjs.com. This
// keeps the build free of a vendored tarball and means no local Node toolchain
// is required to ship. The version is pinned in the URL.
//
// Shared by the document viewer (spreadsheet preview) and the estimate importer.

const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

let sheetJsPromise = null;

export function loadSheetJS() {
  if (!sheetJsPromise) {
    // @vite-ignore keeps the bundler from trying to resolve this at build time.
    sheetJsPromise = import(/* @vite-ignore */ SHEETJS_URL).catch(() => {
      sheetJsPromise = null; // allow a retry on the next attempt
      throw new Error("Could not load the spreadsheet reader. Check your connection and try again.");
    });
  }
  return sheetJsPromise;
}

/**
 * Read a File into a SheetJS workbook.
 * Pass { cellDates: true } when the sheet has date columns you want as Dates
 * rather than Excel serial numbers.
 */
export async function readWorkbook(file, opts = {}) {
  const XLSX = await loadSheetJS();
  const buf = await file.arrayBuffer();
  return { XLSX, workbook: XLSX.read(buf, { type: "array", cellDates: !!opts.cellDates }) };
}

/** Worksheet -> array of arrays, blank rows dropped. */
export function sheetToRows(XLSX, worksheet) {
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: "" });
}

/**
 * Parse a spreadsheet cell into integer cents.
 * Handles 1234.5, "$1,234.56", "(500)" as negative, "" as null.
 * Returns null when there is no usable number.
 */
export function parseMoneyToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  let s = String(value).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }   // (500) => -500
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return null;

  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Parse a plain number (quantity). Returns null when unusable. */
export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/[,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}


/**
 * Parse a spreadsheet cell into a YYYY-MM-DD string, or null.
 * Accepts a Date (from cellDates), an ISO string, or common US formats.
 */
export function parseDateToISO(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !isNaN(value)) return toISODate(value);
  const s = String(value).trim();
  if (!s) return null;
  // 2026-07-08 or 2026-07-08T08:00:00
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 7/8/2026 or 07-08-2026
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : toISODate(d);
}

function toISODate(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

/** Whole calendar days from start to finish, inclusive. */
export function daysBetween(startISO, finishISO) {
  if (!startISO || !finishISO) return null;
  const a = new Date(`${startISO}T00:00:00`);
  const b = new Date(`${finishISO}T00:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Parse an MS Project XML export (File -> Save As -> XML) into activities.
 * Uses the browser's built-in DOMParser — no dependency.
 */
export async function parseMsProjectXml(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("That doesn't look like a valid XML file.");

  const taskNodes = doc.getElementsByTagNameNS("*", "Task");
  if (taskNodes.length === 0) {
    throw new Error("No <Task> elements found. Export from MS Project with File \u2192 Save As \u2192 XML.");
  }

  const get = (node, tag) => {
    const el = node.getElementsByTagNameNS("*", tag)[0];
    return el && el.parentNode === node ? (el.textContent || "").trim() : "";
  };

  const activities = [];
  for (let i = 0; i < taskNodes.length; i++) {
    const t = taskNodes[i];
    const name = get(t, "Name");
    if (!name) continue; // MSP emits a nameless root task

    const startISO = parseDateToISO(get(t, "Start"));
    const finishISO = parseDateToISO(get(t, "Finish"));

    // Predecessor UIDs, if the export includes links.
    const links = t.getElementsByTagNameNS("*", "PredecessorLink");
    const preds = [];
    for (let j = 0; j < links.length; j++) {
      const uid = links[j].getElementsByTagNameNS("*", "PredecessorUID")[0];
      if (uid) preds.push((uid.textContent || "").trim());
    }

    activities.push({
      externalId: get(t, "UID") || get(t, "ID") || null,
      wbs: get(t, "WBS") || null,
      name,
      startDate: startISO,
      finishDate: finishISO,
      durationDays: daysBetween(startISO, finishISO),
      percentComplete: Number(get(t, "PercentComplete") || 0) || 0,
      isMilestone: get(t, "Milestone") === "1",
      isSummary: get(t, "Summary") === "1",
      outlineLevel: Number(get(t, "OutlineLevel") || 0) || null,
      predecessors: preds.length ? preds.join(", ") : null,
    });
  }
  if (activities.length === 0) throw new Error("No named tasks found in that file.");
  return activities;
}
