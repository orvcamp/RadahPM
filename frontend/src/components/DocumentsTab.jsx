// src/components/DocumentsTab.jsx
//
// Per-project document library with nested folders, backed by Cloudflare R2.
// Upload flow: ask backend for a presigned URL, PUT the file straight to R2,
// then record metadata (into the current folder). Folder management
// (create/rename/delete/move) is admin/staff; deleting a folder moves its
// contents up one level. Any member can move their own uploads.

import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import DocumentViewerModal from "./DocumentViewerModal.jsx";

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Flatten folders into an indented list for select menus.
function buildFolderOptions(folders, parentId = null, depth = 0, acc = []) {
  folders
    .filter((f) => (f.parentFolderId || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f) => {
      acc.push({ id: f.id, label: `${"— ".repeat(depth)}${f.name}` });
      buildFolderOptions(folders, f.id, depth + 1, acc);
    });
  return acc;
}

// ---------- move-document modal ----------
function MoveModal({ doc, folders, onClose, onMoved }) {
  const [target, setTarget] = useState(doc.folderId || "");
  const [saving, setSaving] = useState(false);
  const options = buildFolderOptions(folders);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/documents/${doc.id}`, { folderId: target || null });
      onMoved();
    } catch (err) {
      alert(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.05rem", textTransform: "uppercase" }}>Move “{doc.fileName}”</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <label style={{ display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase" }}>Destination folder</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem", marginBottom: "1.2rem" }}>
          <option value="">📁 Project root</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" disabled={saving} onClick={save}>{saving ? "Moving…" : "Move"}</button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsTab({ projectId }) {
  const { user } = useAuth();
  const isInternal = user.role === "admin" || user.role === "staff";
  const fileInputRef = useRef(null);

  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [moveDoc, setMoveDoc] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
  const [applying, setApplying] = useState(false);

  async function applyTemplate() {
    if (!confirm("Add the standard construction folder structure to this project? Folders that already exist are left as-is.")) return;
    setApplying(true);
    try {
      const r = await api.post(`/projects/${projectId}/folders/apply-template`, {});
      await load();
      alert(r.message);
    } catch (err) {
      alert(err.message);
    } finally {
      setApplying(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [f, d] = await Promise.all([
        api.get(`/projects/${projectId}/folders`),
        api.get(`/projects/${projectId}/documents`),
      ]);
      setFolders(f.folders);
      setDocuments(d.documents);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function folderById(id) { return folders.find((f) => f.id === id); }

  // Breadcrumb path from root to current folder.
  const breadcrumb = [];
  {
    let f = currentFolderId ? folderById(currentFolderId) : null;
    const chain = [];
    while (f) { chain.unshift(f); f = f.parentFolderId ? folderById(f.parentFolderId) : null; }
    breadcrumb.push(...chain);
  }

  const subFolders = folders
    .filter((f) => (f.parentFolderId || null) === currentFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const folderDocs = documents.filter((d) => (d.folderId || null) === currentFolderId);

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setError("");
    setUploading(true);
    try {
      setUploadProgress("Preparing upload…");
      const { uploadUrl, storageKey } = await api.post(
        `/projects/${projectId}/documents/upload-url`,
        { fileName: file.name, contentType: file.type || "application/octet-stream" }
      );
      setUploadProgress(`Uploading ${file.name}…`);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed. Please try again.");
      setUploadProgress("Finishing up…");
      const { document } = await api.post(`/projects/${projectId}/documents/confirm`, {
        storageKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        folderId: currentFolderId,
      });
      setDocuments((prev) => [document, ...prev]);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  async function createFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api.post(`/projects/${projectId}/folders`, { name: newFolderName.trim(), parentFolderId: currentFolderId });
      setNewFolderName("");
      setShowNewFolder(false);
      await load();
    } catch (err) { alert(err.message); }
  }

  async function renameFolder(folder) {
    const name = prompt("Rename folder:", folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    try { await api.patch(`/folders/${folder.id}`, { name: name.trim() }); await load(); }
    catch (err) { alert(err.message); }
  }

  async function deleteFolder(folder) {
    if (!confirm(`Delete folder "${folder.name}"? Its contents move up one level (nothing is deleted).`)) return;
    try { await api.delete(`/folders/${folder.id}`); await load(); }
    catch (err) { alert(err.message); }
  }

  async function handleDownload(doc) {
    try {
      const { downloadUrl } = await api.get(`/documents/${doc.id}/download-url`);
      window.open(downloadUrl, "_blank");
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.fileName}"? This permanently removes the file.`)) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) { alert(err.message); }
  }

  const canModifyDoc = (doc) => isInternal || doc.uploadedBy === user.id;

  if (loading) return <div className="loading-spinner" />;

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Project Documents</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {isInternal && (
            <button className="btn btn-outline btn-sm" onClick={applyTemplate} disabled={applying || uploading}>
              {applying ? "Setting up…" : "Set Up Standard Folders"}
            </button>
          )}
          {isInternal && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowNewFolder((s) => !s)} disabled={uploading}>+ New Folder</button>
          )}
          <button className="btn btn-gold" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "+ Upload Document"}
          </button>
          <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileSelected} />
        </div>
      </div>

      {/* Navigation: back up one level + breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
        <button
          className="btn btn-outline btn-sm"
          disabled={currentFolderId === null}
          onClick={() => {
            const cur = currentFolderId ? folderById(currentFolderId) : null;
            setCurrentFolderId(cur && cur.parentFolderId ? cur.parentFolderId : null);
          }}
          title={currentFolderId === null ? "You're at the project root" : "Up one level"}
        >
          ← Back
        </button>
        <div className="text-sm" style={{ color: "var(--steel)" }}>
          <span style={{ cursor: "pointer", fontWeight: currentFolderId === null ? 700 : 400 }} onClick={() => setCurrentFolderId(null)}>📁 Project root</span>
          {breadcrumb.map((f) => (
            <span key={f.id}>
              {" / "}
              <span style={{ cursor: "pointer", fontWeight: f.id === currentFolderId ? 700 : 400 }} onClick={() => setCurrentFolderId(f.id)}>{f.name}</span>
            </span>
          ))}
        </div>
      </div>

      {isInternal && showNewFolder && (
        <form onSubmit={createFolder} style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem" }}>
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="New folder name" style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem" }} />
          <button className="btn btn-outline btn-sm">Create</button>
        </form>
      )}

      {error && <div className="error-msg">{error}</div>}
      {uploadProgress && <div className="success-msg">{uploadProgress}</div>}

      {subFolders.length === 0 && folderDocs.length === 0 ? (
        <div className="empty-state">
          <h3>This folder is empty</h3>
          <p className="text-sm">Upload a file{isInternal ? " or create a subfolder" : ""} to get started.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Uploaded By</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {subFolders.map((folder) => (
              <tr key={folder.id} className="clickable">
                <td onClick={() => setCurrentFolderId(folder.id)}><strong>📁 {folder.name}</strong></td>
                <td onClick={() => setCurrentFolderId(folder.id)}>—</td>
                <td onClick={() => setCurrentFolderId(folder.id)}>—</td>
                <td onClick={() => setCurrentFolderId(folder.id)}>—</td>
                <td>
                  {isInternal && (
                    <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => renameFolder(folder)}>Rename</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteFolder(folder)}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {folderDocs.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <strong className="clickable" style={{ cursor: "pointer" }} onClick={() => setViewDoc(doc)} title="Preview">{doc.fileName}</strong>
                </td>
                <td>{formatSize(doc.sizeBytes)}</td>
                <td>{doc.uploadedByName || "—"}</td>
                <td>{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                    <button className="btn btn-gold btn-sm" onClick={() => setViewDoc(doc)}>View</button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleDownload(doc)}>Download</button>
                    {canModifyDoc(doc) && <button className="btn btn-outline btn-sm" onClick={() => setMoveDoc(doc)}>Move</button>}
                    {canModifyDoc(doc) && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(doc)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {moveDoc && (
        <MoveModal
          doc={moveDoc}
          folders={folders}
          onClose={() => setMoveDoc(null)}
          onMoved={() => { setMoveDoc(null); load(); }}
        />
      )}

      {viewDoc && (
        <DocumentViewerModal
          doc={viewDoc}
          onClose={() => setViewDoc(null)}
          onDownload={(d) => handleDownload(d)}
        />
      )}
    </div>
  );
}
