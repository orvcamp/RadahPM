// src/components/DocumentViewerModal.jsx
//
// Shared in-app document previewer. Used by the Documents tab and the project
// Schedule card. Renders images, PDFs, and text inline via a short-lived
// presigned URL; falls back to a download prompt for other file types.

import { useEffect, useState } from "react";
import { api } from "../api/client";

export function canPreview(contentType, fileName) {
  const ct = (contentType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("text/") || ct === "application/json") return "text";
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return "image";
  if (/\.(txt|csv|md|log|json)$/.test(name)) return "text";
  return null;
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
