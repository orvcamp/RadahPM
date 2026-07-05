// src/components/DocumentsTab.jsx
//
// Per-project document library backed by Cloudflare R2.
// Upload flow: ask backend for a presigned URL, PUT the file straight to
// R2, then tell the backend to record the metadata.

import { useEffect, useState, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsTab({ projectId }) {
  const { user } = useAuth();
  const isInternal = user.role === "admin" || user.role === "staff";
  const fileInputRef = useRef(null);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  function load() {
    setLoading(true);
    setError("");
    api
      .get(`/projects/${projectId}/documents`)
      .then((d) => setDocuments(d.documents))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // reset the input so the same file can be re-selected later
    e.target.value = "";

    setError("");
    setUploading(true);
    try {
      // 1. Ask backend for a presigned upload URL.
      setUploadProgress("Preparing upload…");
      const { uploadUrl, storageKey } = await api.post(
        `/projects/${projectId}/documents/upload-url`,
        { fileName: file.name, contentType: file.type || "application/octet-stream" }
      );

      // 2. PUT the file bytes directly to R2.
      setUploadProgress(`Uploading ${file.name}…`);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error("Upload to storage failed. Please try again.");
      }

      // 3. Confirm — record the metadata row.
      setUploadProgress("Finishing up…");
      const { document } = await api.post(`/projects/${projectId}/documents/confirm`, {
        storageKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      setDocuments((prev) => [document, ...prev]);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  async function handleDownload(doc) {
    try {
      const { downloadUrl } = await api.get(`/documents/${doc.id}/download-url`);
      // Opening the presigned URL triggers the download.
      window.open(downloadUrl, "_blank");
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.fileName}"? This permanently removes the file.`)) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      alert(err.message);
    }
  }

  const canDelete = (doc) => isInternal || doc.uploadedBy === user.id;

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Project Documents</h3>
        <button
          className="btn btn-gold"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "+ Upload Document"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />
      </div>

      {error && <div className="error-msg">{error}</div>}
      {uploadProgress && <div className="success-msg">{uploadProgress}</div>}

      {loading ? (
        <div className="loading-spinner" />
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <h3>No documents yet</h3>
          <p className="text-sm">Upload plans, contracts, photos, or any project file.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Uploaded By</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td><strong>{doc.fileName}</strong></td>
                <td>{formatSize(doc.sizeBytes)}</td>
                <td>{doc.uploadedByName || "—"}</td>
                <td>{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => handleDownload(doc)}>
                      Download
                    </button>
                    {canDelete(doc) && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(doc)}>
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
