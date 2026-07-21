// src/pages/PortalPropertyPage.jsx
//
// The core of the portal. Three tabs map directly to the v1 scope doc:
// Service Requests (doubles as project history and, via each item's
// costCents, the v1 "invoices" stand-in — there's no dedicated invoices
// table for Facilities yet, see routes/portal.js's header note),
// Documents, and Warranties.

import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { portalApi } from "../api/portalClient";

const TABS = [
  { key: "requests", label: "Service Requests" },
  { key: "documents", label: "Documents" },
  { key: "warranties", label: "Warranties" },
];

function formatMoney(cents) {
  return (Number(cents) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default function PortalPropertyPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "requests");
  const [property, setProperty] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    portalApi
      .get(`/properties/${id}`)
      .then((data) => setProperty(data.property))
      .catch((err) => setError(err.message || "Couldn't load this property."));
  }, [id]);

  function changeTab(key) {
    setTab(key);
    setSearchParams({ tab: key });
  }

  if (error) return <div className="error-msg">{error}</div>;
  if (!property) {
    return (
      <div className="center-page">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/portal">Your Properties</Link> / {property.name}
      </div>
      <div className="page-header">
        <h1>{property.name}</h1>
        {property.location && <p>{property.location}</p>}
      </div>

      <div className="tab-row">
        {TABS.map((t) => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => changeTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "requests" && <ServiceRequestsTab propertyId={id} />}
      {tab === "documents" && <DocumentsTab propertyId={id} />}
      {tab === "warranties" && <WarrantiesTab propertyId={id} />}
    </div>
  );
}

// ============================================================
// SERVICE REQUESTS
// ============================================================

function ServiceRequestsTab({ propertyId }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    portalApi
      .get(`/properties/${propertyId}/service-requests`)
      .then((data) => setRequests(data.serviceRequests))
      .catch((err) => setError(err.message || "Couldn't load service requests."));
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="error-msg">{error}</div>;

  return (
    <div>
      <div className="flex-between mb-1" style={{ marginBottom: "1rem" }}>
        <p className="text-steel text-sm">Request service and view your property's service history.</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
          + New Request
        </button>
      </div>

      {showForm && (
        <NewRequestForm
          propertyId={propertyId}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {requests === null ? (
        <div className="loading-spinner" />
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <h3>No service requests yet</h3>
          <p>Submit a request above when you need something addressed at this property.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Completed</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td style={{ textTransform: "capitalize" }}>{r.priority}</td>
                <td>
                  <span className={`badge badge-${r.status}`}>{r.status.replace("_", " ")}</span>
                </td>
                <td>{formatDate(r.createdAt)}</td>
                <td>{formatDate(r.completedAt)}</td>
                <td>{r.costCents ? formatMoney(r.costCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NewRequestForm({ propertyId, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await portalApi.post(`/properties/${propertyId}/service-requests`, { title, description, priority });
      onCreated();
    } catch (err) {
      setError(err.message || "Couldn't submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Service Request</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="title">What do you need addressed?</label>
            <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leaking faucet in unit 3B" />
          </div>
          <div className="field">
            <label htmlFor="description">Details (optional)</label>
            <textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="priority">Priority</label>
            <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// DOCUMENTS
// ============================================================

function DocumentsTab({ propertyId }) {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    portalApi
      .get(`/properties/${propertyId}/documents`)
      .then((data) => setDocuments(data.documents))
      .catch((err) => setError(err.message || "Couldn't load documents."));
  }, [propertyId]);

  if (error) return <div className="error-msg">{error}</div>;
  if (documents === null) return <div className="loading-spinner" />;
  if (documents.length === 0) {
    return (
      <div className="empty-state">
        <h3>No documents yet</h3>
        <p>Documents your property manager shares will appear here.</p>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>File</th>
          <th>Description</th>
          <th>Added</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {documents.map((d) => (
          <tr key={d.id}>
            <td>{d.fileName}</td>
            <td>{d.description || "—"}</td>
            <td>{formatDate(d.createdAt)}</td>
            <td>
              {d.downloadUrl ? (
                <a className="btn btn-outline btn-sm" href={d.downloadUrl} target="_blank" rel="noreferrer">
                  Download
                </a>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// WARRANTIES
// ============================================================

function WarrantiesTab({ propertyId }) {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    portalApi
      .get(`/properties/${propertyId}/warranties`)
      .then((data) => setAssets(data.assets))
      .catch((err) => setError(err.message || "Couldn't load warranty info."));
  }, [propertyId]);

  if (error) return <div className="error-msg">{error}</div>;
  if (assets === null) return <div className="loading-spinner" />;
  if (assets.length === 0) {
    return (
      <div className="empty-state">
        <h3>No warranty records yet</h3>
        <p>Equipment and asset warranty info tracked for this property will appear here.</p>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Asset</th>
          <th>Make / Model</th>
          <th>Installed</th>
          <th>Warranty Expires</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a) => (
          <tr key={a.id}>
            <td>{a.name}</td>
            <td>{[a.make, a.model].filter(Boolean).join(" / ") || "—"}</td>
            <td>{formatDate(a.installDate)}</td>
            <td>{formatDate(a.warrantyExpiresAt)}</td>
            <td>
              <span className={`badge ${a.warrantyStatus === "active" ? "badge-active" : "badge-cancelled"}`}>
                {a.warrantyStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
