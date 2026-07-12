// src/pages/PropertiesPage.jsx
//
// MangoDoe Facilities — Properties list, mirrors ProjectsPage.jsx's pattern
// but talks to /api/properties instead of /api/projects.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_OPTIONS = ["planning", "active", "on_hold", "completed", "cancelled"];
const PROPERTY_TYPES = ["Office", "Retail", "Industrial", "Multifamily", "Healthcare", "Education", "Mixed Use", "Other"];

function NewPropertyModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", description: "", address: "", squareFootage: "", propertyType: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await api.post("/properties", {
        ...form,
        squareFootage: form.squareFootage ? Number(form.squareFootage) : null,
      });
      onCreated(data.property);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Property</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Property Name *</label>
            <input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Riverside Office Park" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={3} value={form.description} onChange={(e) => update("description", e.target.value)} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Property Type</label>
              <select value={form.propertyType} onChange={(e) => update("propertyType", e.target.value)}>
                <option value="">Select...</option>
                {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Square Footage</label>
              <input type="number" min="0" value={form.squareFootage} onChange={(e) => update("squareFootage", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Address</label>
            <input value={form.address} onChange={(e) => update("address", e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Creating..." : "Create Property"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PropertiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isInternal = user.role === "admin" || user.role === "staff";

  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  function loadProperties() {
    setLoading(true);
    api.get("/properties")
      .then((data) => setProperties(data.properties))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadProperties(); }, []);

  const filtered = statusFilter === "all" ? properties : properties.filter((p) => p.status === statusFilter);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Properties</h1>
          <p>{isInternal ? "All properties across your organization." : "Properties you have access to."}</p>
        </div>
        {isInternal && (
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New Property</button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="tab-row">
        <button className={`tab-btn ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>All</button>
        {STATUS_OPTIONS.map((s) => (
          <button key={s} className={`tab-btn ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-spinner" />
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No properties found</h3>
            <p className="text-sm">
              {isInternal ? "Add a property to get started, or adjust your filter above." : "Nothing matches this filter."}
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Type</th>
                <th>Address</th>
                <th>Square Footage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/properties/${p.id}`)}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.propertyType || "—"}</td>
                  <td>{p.address || "—"}</td>
                  <td>{p.squareFootage ? p.squareFootage.toLocaleString() + " sf" : "—"}</td>
                  <td><span className={`badge badge-${p.status}`}>{p.status.replace("_", " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewPropertyModal
          onClose={() => setShowNew(false)}
          onCreated={(property) => {
            setShowNew(false);
            setProperties((prev) => [property, ...prev]);
            navigate(`/properties/${property.id}`);
          }}
        />
      )}
    </div>
  );
}
