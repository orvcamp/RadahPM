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

/** Read a File into a SheetJS workbook. */
export async function readWorkbook(file) {
  const XLSX = await loadSheetJS();
  const buf = await file.arrayBuffer();
  return { XLSX, workbook: XLSX.read(buf, { type: "array" }) };
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
